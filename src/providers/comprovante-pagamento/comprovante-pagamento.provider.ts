/**
 * comprovante-pagamento.provider.ts
 *
 * Downloads the most recent payment receipt (YYYY-MM-DD.png) from a
 * configured Google Drive remote via the rclone RC daemon + rclone-sdk.
 *
 * Flow:
 *   1. Ping rclone RC on port 5572; if not responding, spawn daemon
 *   2. List files in {RCLONE_REMOTE}:{RCLONE_COMPROVANTE_FOLDER}
 *   3. Filter YYYY-MM-DD.png names, sort descending, take the newest
 *   4. Copy file to documents/comprovante-pagamento/{name} via operations/copyfile
 *   5. Kill daemon if we started it; open the file
 */

import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import createRCDClient from 'rclone-sdk';
import { BaseScraper } from '../base-scraper.js';
import type {
  EnvCredential,
  ErrorResult,
  FileResult,
  ProgressCallback,
  ScraperResult,
} from '../interfaces.js';
import type { BrowserService } from '../../core/browser.service.js';
import type { Logger } from 'pino';

const RCLONE_PORT = 5572;
const DAEMON_READY_TIMEOUT_MS = 8_000;
const DAEMON_POLL_INTERVAL_MS = 200;
const DATE_FILENAME_RE = /^\d{4}-\d{2}-\d{2}\.png$/;

export class ComprovantePagamentoProvider extends BaseScraper {
  readonly name = 'comprovante-pagamento';

  readonly requiredCredentials: EnvCredential[] = [
    {
      key: 'RCLONE_REMOTE',
      label: 'Remote rclone',
      description: 'Nome do remote configurado no rclone (ex: gdrive)',
      sensitive: false,
    },
    {
      key: 'RCLONE_COMPROVANTE_FOLDER',
      label: 'Pasta dos comprovantes',
      description: 'Caminho da pasta no remote (ex: Documentos/Comprovantes)',
      sensitive: false,
    },
  ];

  constructor(browserService: BrowserService, logger: Logger) {
    super(browserService, logger);
  }

  async run(
    credentials: Record<string, string>,
    onProgress: ProgressCallback,
  ): Promise<ScraperResult> {
    let daemon: ChildProcess | null = null;
    let ownsDaemon = false;

    try {
      // ── 1. Start or reuse rclone daemon ────────────────────────────────────
      this.emitProgress(onProgress, {
        stepId: 'connect',
        label: 'Verificando daemon rclone...',
        status: 'pending',
      });

      const alreadyRunning = await this.pingDaemon();

      if (alreadyRunning) {
        this.emitProgress(onProgress, {
          stepId: 'connect',
          label: 'Daemon rclone já está rodando',
          status: 'success',
        });
      } else {
        this.emitProgress(onProgress, {
          stepId: 'connect',
          label: 'Iniciando daemon rclone...',
          status: 'pending',
        });

        daemon = this.spawnDaemon();
        await this.waitForDaemon();
        ownsDaemon = true;

        this.emitProgress(onProgress, {
          stepId: 'connect',
          label: 'Daemon rclone pronto',
          status: 'success',
        });
      }

      const rcd = createRCDClient({ baseUrl: `http://localhost:${RCLONE_PORT}` });
      const remote = credentials['RCLONE_REMOTE'] ?? '';
      const folder = credentials['RCLONE_COMPROVANTE_FOLDER'] ?? '';

      // ── 2. List files in remote folder ─────────────────────────────────────
      this.emitProgress(onProgress, {
        stepId: 'fetch',
        label: 'Listando comprovantes no Drive...',
        status: 'pending',
      });

      const { data: listData, error: listError } = await rcd.POST('/operations/list', {
        params: { query: { fs: `${remote}:`, remote: folder } },
      });

      if (listError) {
        throw new Error(`Erro ao listar arquivos: ${JSON.stringify(listError)}`);
      }

      // ── 3. Find the most recent YYYY-MM-DD.png ──────────────────────────────
      const files = (listData?.list ?? [])
        .filter((f) => !f.IsDir && DATE_FILENAME_RE.test(f.Name))
        .sort((a, b) => b.Name.localeCompare(a.Name));

      if (files.length === 0) {
        throw new Error(
          `Nenhum comprovante (YYYY-MM-DD.png) encontrado em ${remote}:${folder}`,
        );
      }

      const latest = files[0];
      const fileName = latest.Name;

      this.emitProgress(onProgress, {
        stepId: 'fetch',
        label: `${files.length} comprovante(s) encontrado(s) — usando ${fileName}`,
        status: 'success',
      });

      // ── 4. Copy file to local documents folder ──────────────────────────────
      const docsDir = path.join(process.cwd(), 'documents', 'comprovante-pagamento');
      const finalPath = path.join(docsDir, fileName);

      fs.mkdirSync(docsDir, { recursive: true });

      this.emitProgress(onProgress, {
        stepId: 'download',
        label: `Baixando ${fileName}...`,
        status: 'pending',
      });

      const { error: copyError } = await rcd.POST('/operations/copyfile', {
        params: {
          query: {
            srcFs: `${remote}:`,
            srcRemote: `${folder}/${fileName}`,
            dstFs: `${docsDir}${path.sep}`,
            dstRemote: fileName,
          },
        },
      });

      if (copyError) {
        throw new Error(`Erro ao copiar arquivo: ${JSON.stringify(copyError)}`);
      }

      const sizeBytes = fs.statSync(finalPath).size;

      this.emitProgress(onProgress, {
        stepId: 'download',
        label: 'Comprovante baixado com sucesso!',
        status: 'success',
      });

      // ── 5. Open the file ────────────────────────────────────────────────────
      await this.openDocument(finalPath);

      return {
        type: 'file',
        filePath: finalPath,
        mimeType: 'image/png',
        sizeBytes,
      } satisfies FileResult;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error({ err }, 'ComprovantePagamentoProvider failed');
      return { type: 'error', message, cause: err } satisfies ErrorResult;
    } finally {
      if (ownsDaemon && daemon) {
        daemon.kill();
      }
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async pingDaemon(): Promise<boolean> {
    try {
      const res = await fetch(`http://localhost:${RCLONE_PORT}/rc/noop`, {
        method: 'POST',
        signal: AbortSignal.timeout(1_000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  private spawnDaemon(): ChildProcess {
    return spawn('rclone', ['rcd', '--rc-no-auth', `--rc-addr=localhost:${RCLONE_PORT}`], {
      stdio: 'ignore',
      detached: false,
    });
  }

  private async waitForDaemon(): Promise<void> {
    const deadline = Date.now() + DAEMON_READY_TIMEOUT_MS;

    while (Date.now() < deadline) {
      if (await this.pingDaemon()) return;
      await new Promise<void>((r) => setTimeout(r, DAEMON_POLL_INTERVAL_MS));
    }

    throw new Error(
      `rclone daemon não ficou disponível após ${DAEMON_READY_TIMEOUT_MS / 1000}s. ` +
        'Verifique se o rclone está instalado e o remote está configurado.',
    );
  }
}
