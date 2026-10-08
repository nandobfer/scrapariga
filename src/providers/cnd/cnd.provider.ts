/**
 * cnd.provider.ts — Certidão Negativa de Débitos (Receita Federal).
 *
 * URL: https://servicos.receitafederal.gov.br/servico/certidoes/#/home/cnpj
 *
 * WHY THE "ASSISTED" FLOW
 *   The service is protected by an invisible hCaptcha validated on the Receita
 *   backend. A browser launched by Playwright (headless or headed, Chromium or
 *   real Chrome, even with a human solving the challenge) is fingerprinted as
 *   automated and the captcha token is rejected with `023 / CaptchaFalhaValidacao`.
 *   The user's own Windows Chrome passes.
 *
 *   So, on WSL, this provider drives the **real Windows Chrome** over the DevTools
 *   Protocol: it fills the CNPJ and clicks "Consultar Certidão"; the user only
 *   solves the captcha if it appears; then the provider captures the "Segunda via"
 *   PDF automatically and saves it under documents/certidao-negativa-debitos/.
 *
 *   On non-WSL environments (or if Windows Chrome is unavailable) it degrades to
 *   the previous ManualResult behaviour (copy CNPJ + show the link).
 *
 * The Windows-side CDP work lives in scripts/cnd-helper.mjs (Windows Node, zero
 * deps) — copied to a Windows temp dir and executed with the Windows node.exe.
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Logger } from 'pino';
import { BaseScraper, type BrowserService } from '../base-scraper.js';
import type { EnvCredential, ManualResult, ProgressCallback, ScraperResult } from '../interfaces.js';

const execFileAsync = promisify(execFile);

const CND_URL = 'https://servicos.receitafederal.gov.br/servico/certidoes/#/home/cnpj';
const DOC_NAME = 'certidao-negativa-debitos';

const WINDOWS_CHROME_PATHS = [
  '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe',
  '/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe',
];

const WINDOWS_NODE_PATHS = [
  '/mnt/c/Program Files/nodejs/node.exe',
  '/mnt/c/Program Files (x86)/nodejs/node.exe',
];

const DEFAULT_CAPTCHA_TIMEOUT_MS = 300_000;

interface ClipboardCommand {
  bin: string;
  args: string[];
}

interface ClipboardResult {
  copied: boolean;
  method?: string;
}

interface HelperResult {
  ok: boolean;
  filePath?: string;
  size?: number;
  errorCode?: string;
  message?: string;
}

interface WindowsPaths {
  /** Windows %TEMP% (backslashes), e.g. C:\Users\x\AppData\Local\Temp */
  winTemp: string;
  /** /mnt/c/... equivalent of winTemp */
  wslTemp: string;
  /** windows chrome.exe path usable by PowerShell (backslashes) */
  chromeExe: string;
  /** WSL path to the Windows node.exe (drives the CDP helper) */
  nodeExe: string;
}

function formatCnpj(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 14) {
    return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  }
  return raw;
}

/** Joins path segments using Windows backslashes (path.join uses '/' on Linux). */
function winJoin(base: string, ...parts: string[]): string {
  const head = base.replace(/[\\/]+$/, '');
  const tail = parts.map((p) => p.replace(/^[\\/]+|[\\/]+$/g, ''));
  return [head, ...tail].join('\\');
}

export class CndProvider extends BaseScraper {
  readonly name = 'cnd';

  readonly requiredCredentials: EnvCredential[] = [
    {
      key: 'CNPJ',
      label: 'CNPJ da empresa',
      description: 'Informe com ou sem máscara (ex: 12.345.678/0001-95 ou 12345678000195)',
      sensitive: false,
    },
  ];

  constructor(browserService: BrowserService, logger: Logger) {
    super(browserService, logger);
  }

  // ─── run() ──────────────────────────────────────────────────────────────────

  async run(
    credentials: Record<string, string>,
    onProgress: ProgressCallback,
  ): Promise<ScraperResult> {
    this._progressCallback = onProgress;

    const cnpj = formatCnpj(credentials['CNPJ'] ?? '');

    // Degrade to the manual flow when the assisted path is unavailable.
    const windows = await this.resolveWindowsPaths();
    if (process.env['CND_MANUAL'] === 'true' || !windows) {
      return this.runManual(cnpj);
    }

    this.emitStep({ stepId: 'setup', label: 'Preparando ambiente Windows...', status: 'pending' });

    const workDir = path.join(windows.wslTemp, 'scrapariga-cnd');
    const wslDownloadDir = path.join(workDir, 'downloads');
    const winWorkDir = winJoin(windows.winTemp, 'scrapariga-cnd');
    const winProfileDir = winJoin(winWorkDir, 'profile');
    const port = 9333 + Math.floor(Math.random() * 400);

    try {
      await fs.rm(wslDownloadDir, { recursive: true, force: true });
      await fs.mkdir(wslDownloadDir, { recursive: true });
      await this.installHelper(workDir);

      this.emitStep({
        stepId: 'browser',
        label: 'Abrindo seu Chrome (Windows) na Receita Federal...',
        status: 'pending',
      });

      await this.launchWindowsChrome(windows.chromeExe, port, winProfileDir);
      await this.waitForCdp(port);

      this.emitStep({
        stepId: 'captcha',
        label: 'Preencha o captcha na janela do Chrome, se aparecer',
        status: 'pending',
      });

      const helper = await this.runHelper({
        nodeExe: windows.nodeExe,
        wslWorkDir: workDir,
        port,
        cnpj,
        timeoutMs: this.captchaTimeoutMs(),
      });

      if (!helper.ok || !helper.filePath) {
        const friendly = this.friendlyHelperError(helper);
        this.emitStep({ stepId: 'captcha', label: friendly, status: 'error' });
        return { type: 'error', message: friendly };
      }

      // Copy the downloaded PDF from the Windows temp dir into documents/.
      this.emitStep({ stepId: 'download', label: 'Salvando a certidão...', status: 'pending' });

      const finalPath = this.buildFilePath(DOC_NAME, 'pdf');
      const buffer = await this.readWindowsFile(helper.filePath, wslDownloadDir);
      await fs.mkdir(path.dirname(finalPath), { recursive: true });
      await fs.writeFile(finalPath, buffer);

      const sizeBytes = buffer.byteLength;
      const mimeType = await this.detectMime(buffer, finalPath);

      this.emitStep({
        stepId: 'download',
        label: `Certidão salva: ${path.basename(finalPath)}`,
        status: 'success',
      });

      await this.openDocument(finalPath);

      return { type: 'file', filePath: finalPath, mimeType, sizeBytes };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error({ err }, 'CndProvider run() failed');
      return { type: 'error', message, cause: err };
    } finally {
      await this.closeWindowsChrome(port, winProfileDir).catch(() => undefined);
    }
  }

  // ─── Manual fallback ────────────────────────────────────────────────────────

  private async runManual(cnpj: string): Promise<ManualResult> {
    const clipboard = await this.copyTextToClipboard(cnpj);

    this.emitStep({
      stepId: 'manual',
      label: 'Acesse o link abaixo para baixar a certidão',
      status: 'warning',
    });

    const clipboardMessage = clipboard.copied
      ? 'O CNPJ foi copiado para a sua area de transferencia.'
      : `Nao foi possivel copiar o CNPJ automaticamente. Use este valor: ${cnpj}.`;

    return {
      type: 'manual',
      message:
        `${clipboardMessage} ` +
        `Acesse o link abaixo, preencha o CNPJ (${cnpj}), resolva o CAPTCHA e clique em "Consultar Certidão". ` +
        'Em seguida clique em "Segunda via" para baixar o PDF.',
      url: CND_URL,
    };
  }

  // ─── Windows environment detection ──────────────────────────────────────────

  /**
   * Resolves the Windows %TEMP% (backslash + /mnt/c forms) and the Chrome path.
   * Returns undefined when not running under WSL with a Windows Chrome available.
   */
  protected async resolveWindowsPaths(): Promise<WindowsPaths | undefined> {
    const chromeExeWsl = WINDOWS_CHROME_PATHS.find((p) => existsSync(p));
    if (!chromeExeWsl) return undefined;

    try {
      const { stdout } = await execFileAsync('cmd.exe', ['/c', 'echo %TEMP%'], { timeout: 10_000 });
      const winTemp = stdout.trim().replace(/\r?\n/g, '');
      if (!winTemp) return undefined;

      const { stdout: wslOut } = await execFileAsync('wslpath', ['-u', winTemp], { timeout: 10_000 });
      const wslTemp = wslOut.trim();
      if (!wslTemp) return undefined;

      // chromeExe in Windows form for PowerShell.
      const { stdout: chromeOut } = await execFileAsync('wslpath', ['-w', chromeExeWsl], {
        timeout: 10_000,
      });

      // Locate the Windows node.exe that will run the CDP helper.
      let nodeExe = WINDOWS_NODE_PATHS.find((p) => existsSync(p));
      if (!nodeExe) {
        const { stdout: whereOut } = await execFileAsync('cmd.exe', ['/c', 'where node'], {
          timeout: 10_000,
        });
        const first = whereOut
          .split(/\r?\n/)
          .map((s) => s.trim())
          .find(Boolean);
        if (first) {
          const { stdout: nodeOut } = await execFileAsync('wslpath', ['-u', first], {
            timeout: 10_000,
          });
          const candidate = nodeOut.trim();
          if (candidate && existsSync(candidate)) nodeExe = candidate;
        }
      }
      if (!nodeExe) {
        this.logger.warn('Windows node.exe não encontrado; usando o fluxo manual da CND');
        return undefined;
      }

      return { winTemp, wslTemp, chromeExe: chromeOut.trim(), nodeExe };
    } catch (err) {
      this.logger.debug({ err }, 'Windows environment not detected; using manual CND flow');
      return undefined;
    }
  }

  // ─── Chrome launch / close ──────────────────────────────────────────────────

  protected async launchWindowsChrome(
    chromeExe: string,
    port: number,
    winProfileDir: string,
  ): Promise<void> {
    const argList = [
      `'--remote-debugging-port=${port}'`,
      `'--user-data-dir=${winProfileDir}'`,
      "'--no-first-run'",
      "'--no-default-browser-check'",
      "'--start-maximized'",
      "'about:blank'",
    ].join(',');
    const script = `Start-Process -FilePath '${chromeExe}' -ArgumentList ${argList}`;

    await execFileAsync('powershell.exe', ['-NoProfile', '-Command', script], { timeout: 20_000 });
  }

  protected async waitForCdp(_port: number): Promise<void> {
    // WSL cannot reach the Windows loopback, so we cannot verify CDP from here.
    // Give Chrome a moment to start; the helper performs the real readiness check.
    await new Promise((r) => setTimeout(r, 3000));
  }

  protected async closeWindowsChrome(_port: number, winProfileDir: string): Promise<void> {
    // Kill only the Chrome instance we launched (matched by its dedicated
    // user-data-dir) — never the user's main Chrome.
    const script =
      `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | ` +
      `Where-Object { $_.CommandLine -like '*${winProfileDir}*' } | ` +
      `ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
    await execFileAsync('powershell.exe', ['-NoProfile', '-Command', script], {
      timeout: 15_000,
    }).catch(() => undefined);
  }

  // ─── Helper install / execution ─────────────────────────────────────────────

  protected async installHelper(workDir: string): Promise<void> {
    const src = path.resolve(process.cwd(), 'scripts', 'cnd-helper.mjs');
    const dest = path.join(workDir, 'cnd-helper.mjs');
    const content = await fs.readFile(src, 'utf8');
    await fs.writeFile(dest, content, 'utf8');
  }

  protected async runHelper(opts: {
    nodeExe: string;
    wslWorkDir: string;
    port: number;
    cnpj: string;
    timeoutMs: number;
  }): Promise<HelperResult> {
    // Drive node.exe directly (no cmd.exe): WSL hands the args to the Windows
    // process verbatim, and cwd = /mnt/c/... is seen as C:\... by Windows.
    const args = [
      'cnd-helper.mjs',
      '--port',
      String(opts.port),
      '--cnpj',
      opts.cnpj,
      '--timeout-ms',
      String(opts.timeoutMs),
    ];

    return await new Promise<HelperResult>((resolve, reject) => {
      const child = spawn(opts.nodeExe, args, { cwd: opts.wslWorkDir });
      let stdout = '';
      let stderr = '';

      const onLine = (line: string): void => {
        if (line.startsWith('__CND_RESULT__')) return;
        if (line.startsWith('[cnd]')) {
          this.emitStep({ stepId: 'captcha', label: line.slice(5).trim(), status: 'pending' });
        }
      };

      let buffered = '';
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
        buffered += chunk.toString();
        const lines = buffered.split('\n');
        buffered = lines.pop() ?? '';
        for (const l of lines) onLine(l.trim());
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on('error', reject);
      child.on('close', () => {
        const match = stdout.match(/__CND_RESULT__(.+)/);
        if (!match) {
          reject(
            new Error(
              `Helper da CND não retornou resultado. ${stderr.trim() || stdout.trim()}`.trim(),
            ),
          );
          return;
        }
        try {
          resolve(JSON.parse(match[1]) as HelperResult);
        } catch (err) {
          reject(new Error(`Resultado inválido do helper da CND: ${String(err)}`));
        }
      });
    });
  }

  // ─── File helpers ───────────────────────────────────────────────────────────

  /** Reads a file whose path is a Windows path, from WSL. */
  protected async readWindowsFile(winPath: string, wslFallbackDir: string): Promise<Buffer> {
    // Convert the Windows path to its /mnt/c equivalent and read it.
    try {
      const { stdout } = await execFileAsync('wslpath', ['-u', winPath], { timeout: 10_000 });
      const wslPath = stdout.trim();
      if (wslPath) return await fs.readFile(wslPath);
    } catch {
      // fall through to the directory scan
    }

    // Fall back to the first PDF in the known WSL download directory.
    const entries = await fs.readdir(wslFallbackDir).catch(() => [] as string[]);
    const pdf = entries.find((f) => f.toLowerCase().endsWith('.pdf'));
    if (!pdf) throw new Error(`PDF não encontrado em ${wslFallbackDir}`);
    return await fs.readFile(path.join(wslFallbackDir, pdf));
  }

  /** Maps a helper failure to a user-friendly Portuguese message. */
  private friendlyHelperError(helper: HelperResult): string {
    switch (helper.errorCode) {
      case '023':
        return 'O captcha não foi validado pela Receita. Tente novamente.';
      case '033':
        return 'A Receita está indisponível no momento (033). Tente novamente em alguns minutos.';
      case 'TIMEOUT':
        return 'Tempo esgotado aguardando a certidão na janela do Chrome.';
      case 'INVALID_CNPJ':
        return 'O CNPJ informado não foi aceito pela Receita.';
      default:
        return helper.message ?? 'Não foi possível baixar a certidão automaticamente.';
    }
  }

  private async detectMime(buffer: Buffer, _finalPath: string): Promise<string> {
    const { fileTypeFromBuffer } = await import('file-type');
    const detected = await fileTypeFromBuffer(buffer);
    return detected?.mime ?? 'application/pdf';
  }

  private captchaTimeoutMs(): number {
    const raw = process.env['CND_CAPTCHA_TIMEOUT_MS'];
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CAPTCHA_TIMEOUT_MS;
  }

  // ─── Clipboard (manual fallback) ────────────────────────────────────────────

  protected async copyTextToClipboard(text: string): Promise<ClipboardResult> {
    for (const command of this.getClipboardCommands()) {
      const copied = await this.tryClipboardCommand(command, text);
      if (copied) {
        this.logger.info({ clipboard: command.bin }, 'CNPJ copied to clipboard');
        return { copied: true, method: command.bin };
      }
    }

    this.logger.warn('No supported clipboard command available for CND provider');
    return { copied: false };
  }

  private getClipboardCommands(): ClipboardCommand[] {
    if (process.platform === 'darwin') {
      return [{ bin: 'pbcopy', args: [] }];
    }

    return [
      { bin: 'wl-copy', args: [] },
      { bin: 'xclip', args: ['-selection', 'clipboard'] },
      { bin: 'xsel', args: ['--clipboard', '--input'] },
      { bin: 'pbcopy', args: [] },
    ];
  }

  private async tryClipboardCommand(command: ClipboardCommand, text: string): Promise<boolean> {
    return await new Promise<boolean>((resolve) => {
      const child = spawn(command.bin, command.args, {
        stdio: ['pipe', 'ignore', 'ignore'],
      });

      child.once('error', () => resolve(false));
      child.once('close', (code) => resolve(code === 0));

      child.stdin.on('error', () => resolve(false));
      child.stdin.end(text);
    });
  }
}
