/**
 * demo.provider.ts — DemoProvider: simulates 3 steps with artificial delays.
 *
 * FR-017: Implements ScraperContract fully; zero real network calls.
 * T020: login (1500ms) → fetchDocuments (1000ms) → download (2000ms)
 * DEMO_FAIL_ON env var: set to 'login' | 'fetch' | 'download' to simulate failure.
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import type { Logger } from 'pino';
import { BaseScraper } from '../base-scraper.js';
import type { BrowserService } from '../base-scraper.js';
import type {
  DocumentMetadata,
  EnvCredential,
  ProgressCallback,
  ScraperResult,
} from '../interfaces.js';

export class DemoProvider extends BaseScraper {
  readonly name = 'demo';
  readonly requiredCredentials: EnvCredential[] = [];

  constructor(browserService: BrowserService, logger: Logger) {
    super(browserService, logger);
  }

  /**
   * Override run() to skip Playwright entirely — DemoProvider never opens a real page.
   */
  override async run(
    _credentials: Record<string, string>,
    onProgress: ProgressCallback,
  ): Promise<ScraperResult> {
    try {
      await this.demoLogin(onProgress);
      const docs = await this.demoFetch(onProgress);
      return await this.demoDownload(onProgress, docs[0]);
    } catch (err) {
      return {
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
        cause: err,
      };
    }
  }

  // ─── Demo steps ──────────────────────────────────────────────────────────

  private async demoLogin(onProgress: ProgressCallback): Promise<void> {
    this.emitProgress(onProgress, {
      stepId: 'login',
      label: 'Autenticando no sistema demo...',
      status: 'pending',
    });

    await this.delay(1500);

    if (process.env['DEMO_FAIL_ON'] === 'login') {
      this.emitProgress(onProgress, {
        stepId: 'login',
        label: 'Falha simulada no login',
        status: 'error',
      });
      throw new Error('Falha simulada: DEMO_FAIL_ON=login');
    }

    this.emitProgress(onProgress, {
      stepId: 'login',
      label: 'Autenticado com sucesso',
      status: 'success',
    });
  }

  private async demoFetch(onProgress: ProgressCallback): Promise<DocumentMetadata[]> {
    this.emitProgress(onProgress, {
      stepId: 'fetch',
      label: 'Buscando documentos disponíveis...',
      status: 'pending',
    });

    await this.delay(1000);

    if (process.env['DEMO_FAIL_ON'] === 'fetch') {
      this.emitProgress(onProgress, {
        stepId: 'fetch',
        label: 'Falha simulada ao buscar documentos',
        status: 'error',
      });
      throw new Error('Falha simulada: DEMO_FAIL_ON=fetch');
    }

    this.emitProgress(onProgress, {
      stepId: 'fetch',
      label: '1 documento encontrado',
      status: 'success',
    });

    return [
      {
        id: 'demo-doc-001',
        name: 'documento-demo',
        url: undefined,
        mimeHint: 'application/pdf',
      },
    ];
  }

  private async demoDownload(
    onProgress: ProgressCallback,
    doc: DocumentMetadata,
  ): Promise<ScraperResult> {
    this.emitProgress(onProgress, {
      stepId: 'download',
      label: `Baixando ${doc.name}...`,
      status: 'pending',
    });

    await this.delay(2000);

    if (process.env['DEMO_FAIL_ON'] === 'download') {
      this.emitProgress(onProgress, {
        stepId: 'download',
        label: 'Falha simulada no download',
        status: 'error',
      });
      throw new Error('Falha simulada: DEMO_FAIL_ON=download');
    }

    // Create the demo file on disk
    const filePath = this.buildFilePath(doc.name, 'pdf');
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });

    const content = `Demo PDF — gerado em ${new Date().toISOString()}\n`;
    await fs.writeFile(filePath, content, 'utf8');

    this.emitProgress(onProgress, {
      stepId: 'download',
      label: `Arquivo salvo: ${path.basename(filePath)}`,
      status: 'success',
    });

    return {
      type: 'file',
      filePath,
      mimeType: 'application/pdf',
      sizeBytes: Buffer.byteLength(content, 'utf8'),
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
