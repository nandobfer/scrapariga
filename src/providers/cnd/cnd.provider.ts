/**
 * cnd.provider.ts — Certidão Negativa de Débitos (Receita Federal).
 *
 * URL: https://servicos.receitafederal.gov.br/servico/certidoes/#/home/cnpj
 *
 * Flow (inside run()):
 *   navigateAndFill()  → navigate, fill CNPJ, click "Consultar Certidão"
 *   waitForResult()    → wait for the download button to appear
 *   downloadCertidao() → click "Segunda via", intercept download, save PDF
 *
 * Selectors (all confirmed via browser DevTools):
 *   input[name="niContribuinte"]                   → CNPJ input
 *   button.br-button.secondary hasText "Consultar" → submit CNPJ form
 *   button[title="Segunda via"]                     → download PDF
 */

import path from 'node:path';
import type { Page } from 'playwright';
import type { Logger } from 'pino';
import { BaseScraper, type BrowserService } from '../base-scraper.js';
import type { EnvCredential, ProgressCallback, ScraperResult } from '../interfaces.js';

const CND_URL = 'https://servicos.receitafederal.gov.br/servico/certidoes/#/home/cnpj';

/**
 * Formats a raw CNPJ string to XX.XXX.XXX/XXXX-XX.
 * Accepts 14-digit strings with or without mask. Returns the input unchanged if
 * it does not consist of exactly 14 digits after stripping non-digits.
 */
function formatCnpj(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 14) {
    return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  }
  return raw;
}

export class CndProvider extends BaseScraper {
  readonly name = 'cnd';

  readonly requiredCredentials: EnvCredential[] = [
    {
      key: 'CNPJ',
      label: 'CNPJ da empresa',
      description:
        'Informe com ou sem máscara (ex: 12.345.678/0001-95 ou 12345678000195)',
      sensitive: false,
    },
  ];

  constructor(browserService: BrowserService, logger: Logger) {
    super(browserService, logger);
  }

  // ─── run() ────────────────────────────────────────────────────────────────

  async run(
    credentials: Record<string, string>,
    onProgress: ProgressCallback,
  ): Promise<ScraperResult> {
    this._progressCallback = onProgress;

    const sessionState = await this.loadSession();
    const page = await this.browserService.newPage(sessionState);

    try {
      await this.retry(
        () => this.navigateAndFill(page, credentials),
        {
          maxAttempts: 3,
          baseDelayMs: 1000,
          onAttempt: (attempt, error) => {
            this.emitStep({ stepId: 'login', label: `Preenchendo formulário (tentativa ${attempt}/3)...`, status: 'error' });
            this.logger.warn({ attempt, err: error.message }, 'navigateAndFill retry');
          },
        },
      );

      await this.waitForResult(page);

      await this.debugShot(page, 'cnd-result');

      const finalPath = this.buildFilePath('certidao-negativa-debitos', 'pdf');
      const { mimeType, sizeBytes } = await this.retry(
        () => this.downloadCertidao(page, finalPath),
        {
          maxAttempts: 3,
          baseDelayMs: 1000,
          onAttempt: (attempt, error) => {
            this.emitStep({ stepId: 'download', label: `Baixando certidão (tentativa ${attempt}/3)...`, status: 'error' });
            this.logger.warn({ attempt, err: error.message }, 'downloadCertidao retry');
          },
        },
      );

      await this.persistSession(page.context());

      this.emitStep({
        stepId: 'download',
        label: `Certidão salva: ${path.basename(finalPath)}`,
        status: 'success',
      });

      return {
        type: 'file',
        filePath: finalPath,
        mimeType,
        sizeBytes,
      };
    } catch (err) {
      this.logger.error({ err }, 'CndProvider run() failed');
      return {
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
        cause: err,
      };
    } finally {
      await page.close();
    }
  }

  // ─── Step 1: Navigate, fill CNPJ, click "Consultar Certidão" ─────────────

  async navigateAndFill(page: Page, credentials: Record<string, string>): Promise<void> {
    this.emitStep({ stepId: 'login', label: 'Abrindo página da Receita Federal...', status: 'pending' });

    await page.goto(CND_URL, { waitUntil: 'load' });

    this.emitStep({ stepId: 'login', label: 'Preenchendo CNPJ...', status: 'pending' });

    const cnpj = formatCnpj(credentials['CNPJ'] ?? '');
    const input = page.locator('input[name="niContribuinte"]');
    await input.waitFor({ state: 'visible', timeout: 15_000 });
    await input.fill(cnpj);

    const consultarBtn = page
      .locator('button.br-button.secondary')
      .filter({ hasText: 'Consultar' });
    await consultarBtn.waitFor({ state: 'visible', timeout: 10_000 });
    await consultarBtn.click();

    this.emitStep({ stepId: 'login', label: 'Formulário enviado', status: 'success' });
  }

  // ─── Step 2: Wait for the result page ────────────────────────────────────

  async waitForResult(page: Page): Promise<void> {
    this.emitStep({ stepId: 'fetch', label: 'Aguardando resultado da consulta...', status: 'pending' });

    await page.waitForSelector('button[title="Segunda via"]', { timeout: 30_000 });

    this.emitStep({ stepId: 'fetch', label: '1 certidão disponível para download', status: 'success' });
  }

  // ─── Step 3: Click "Segunda via", capture Playwright download, save PDF ──

  async downloadCertidao(
    page: Page,
    finalPath: string,
  ): Promise<{ mimeType: string; sizeBytes: number }> {
    this.emitStep({ stepId: 'download', label: 'Iniciando download da certidão...', status: 'pending' });

    const downloadButton = page.locator('button[title="Segunda via"]');
    await downloadButton.waitFor({ state: 'visible', timeout: 10_000 });

    // Register the download listener BEFORE click to avoid missing the event
    const [downloadEvent] = await Promise.all([
      page.waitForEvent('download'),
      downloadButton.click(),
    ]);

    this.emitStep({ stepId: 'download', label: 'Baixando arquivo...', status: 'pending' });

    // Save via Playwright's built-in download API (no direct URL available)
    const tmpPath = path.join(process.cwd(), `cnd-${Date.now()}.tmp`);
    await downloadEvent.saveAs(tmpPath);

    // Re-use base class validation + move logic via downloadFile workaround:
    // since we already have the file at tmpPath, validate and move manually.
    const fs = await import('node:fs/promises');
    const { fileTypeFromBuffer } = await import('file-type');
    const allowedMimes = ['application/pdf'];

    const buf = await fs.readFile(tmpPath);
    const detected = await fileTypeFromBuffer(buf);

    if (!detected || !allowedMimes.includes(detected.mime)) {
      await fs.unlink(tmpPath).catch(() => undefined);
      throw new Error(
        `Invalid MIME type: expected one of [${allowedMimes.join(', ')}], got ${detected?.mime ?? 'unknown'}`,
      );
    }

    await fs.mkdir(path.dirname(finalPath), { recursive: true });

    try {
      await fs.rename(tmpPath, finalPath);
    } catch {
      await fs.copyFile(tmpPath, finalPath);
      await fs.unlink(tmpPath).catch(() => undefined);
    }

    const stat = await fs.stat(finalPath);
    return { mimeType: detected.mime, sizeBytes: stat.size };
  }
}

