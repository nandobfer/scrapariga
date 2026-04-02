/**
 * base-scraper.ts — Abstract base class that serves as the ScraperContract.
 *
 * CONSTITUTION ENFORCEMENT (Principle I — Architecture & Design):
 *   - Every provider MUST extend BaseScraper.
 *   - Every provider MUST implement the three abstract methods.
 *   - No provider may bypass run() to call login/fetch/download directly.
 *   - BrowserService is injected via the constructor (Dependency Injection).
 *
 * SHARED LOGIC (never duplicated in providers):
 *   - Template Method: run() → login → fetchDocuments → download (all with retry)
 *   - Exponential backoff retry (Principle II)
 *   - Session persistence / restoration (Principle II)
 *   - File path generation and directory creation
 *   - Download MIME validation (Principle IV)
 *   - ProgressEvent dispatch (FR-010, FR-011)
 *   - Structured logging with pino (Principle III)
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { fileTypeFromBuffer } from 'file-type';
import type { BrowserContext, Page } from 'playwright';
import type { Logger } from 'pino';
import type {
  EnvCredential,
  DocumentMetadata,
  ProgressCallback,
  ProgressEvent,
  RetryOptions,
  ScraperResult,
} from './interfaces.js';

// ---------------------------------------------------------------------------
// BrowserService interface
// ---------------------------------------------------------------------------

export interface BrowserService {
  newPage(storageState?: Awaited<ReturnType<BrowserContext['storageState']>>): Promise<Page>;
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// BaseScraper
// ---------------------------------------------------------------------------

export abstract class BaseScraper {
  private static readonly DOCUMENTS_DIR = path.resolve(process.cwd(), 'documents');
  private static readonly SESSIONS_DIR = path.resolve(process.cwd(), 'sessions');

  constructor(
    protected readonly browserService: BrowserService,
    protected readonly logger: Logger,
  ) {}

  // ─── Abstract declarations ──────────────────────────────────────────────────

  abstract readonly name: string;
  abstract readonly requiredCredentials: EnvCredential[];

  abstract login(page: Page, credentials: Record<string, string>): Promise<void>;
  abstract fetchDocuments(page: Page): Promise<DocumentMetadata[]>;
  abstract download(page: Page, doc: DocumentMetadata): Promise<ScraperResult>;

  // ─── Template Method ────────────────────────────────────────────────────────

  async run(
    credentials: Record<string, string>,
    onProgress: ProgressCallback,
  ): Promise<ScraperResult> {
    const sessionState = await this.loadSession();
    const page = await this.browserService.newPage(sessionState);

    try {
      await this.retry(
        () => this.login(page, credentials),
        {
          maxAttempts: 3,
          baseDelayMs: 1000,
          onAttempt: (attempt, error) => {
            this.emitProgress(onProgress, {
              stepId: 'login',
              label: `Autenticando... (tentativa ${attempt}/3)`,
              status: 'error',
              attempt,
              maxAttempts: 3,
            });
            this.logger.warn({ attempt, err: error.message }, 'login retry');
          },
        },
      );

      const docs = await this.retry(
        () => this.fetchDocuments(page),
        {
          maxAttempts: 3,
          baseDelayMs: 1000,
          onAttempt: (attempt, error) => {
            this.emitProgress(onProgress, {
              stepId: 'fetch',
              label: `Buscando documentos... (tentativa ${attempt}/3)`,
              status: 'error',
              attempt,
              maxAttempts: 3,
            });
            this.logger.warn({ attempt, err: error.message }, 'fetchDocuments retry');
          },
        },
      );

      const result = await this.retry(
        () => this.download(page, docs[0]),
        {
          maxAttempts: 3,
          baseDelayMs: 1000,
          onAttempt: (attempt, error) => {
            this.emitProgress(onProgress, {
              stepId: 'download',
              label: `Baixando... (tentativa ${attempt}/3)`,
              status: 'error',
              attempt,
              maxAttempts: 3,
            });
            this.logger.warn({ attempt, err: error.message }, 'download retry');
          },
        },
      );

      await this.persistSession(page.context());
      return result;
    } catch (err) {
      this.logger.error({ err }, `${this.name} run() failed after all retries`);
      return {
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
        cause: err,
      };
    } finally {
      await page.close();
    }
  }

  // ─── Shared helpers ─────────────────────────────────────────────────────────

  protected emitProgress(cb: ProgressCallback, event: ProgressEvent): void {
    try {
      cb(event);
    } catch {
      // renderer errors must never crash the provider
      this.logger.warn({ stepId: event.stepId }, 'ProgressCallback threw; ignoring');
    }
  }

  protected async retry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
    const maxAttempts = opts.maxAttempts ?? 3;
    const baseDelayMs = opts.baseDelayMs ?? 1000;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (err) {
        opts.onAttempt?.(attempt, err instanceof Error ? err : new Error(String(err)));
        if (attempt === maxAttempts) throw err;
        await this.sleep(baseDelayMs * Math.pow(2, attempt - 1));
      }
    }
    throw new Error('retry: unreachable');
  }

  protected buildFilePath(docName: string, ext: string): string {
    const slug = docName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const date = new Date().toISOString().split('T')[0];
    return path.join(BaseScraper.DOCUMENTS_DIR, slug, `${date}.${ext}`);
  }

  protected async ensureDir(subDir: string): Promise<string> {
    const dir = path.join(BaseScraper.DOCUMENTS_DIR, subDir);
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  protected async validateDownload(tmpPath: string, allowedMimes: string[]): Promise<void> {
    const buf = await fs.readFile(tmpPath);
    const detected = await fileTypeFromBuffer(buf);

    if (!detected || !allowedMimes.includes(detected.mime)) {
      await fs.unlink(tmpPath).catch(() => undefined);
      this.logger.warn(
        { tmpPath, detectedMime: detected?.mime ?? 'unknown', allowedMimes },
        'Download rejected: invalid MIME type',
      );
      throw new Error(
        `Invalid MIME type: expected one of [${allowedMimes.join(', ')}], got ${detected?.mime ?? 'unknown'}`,
      );
    }
  }

  protected async persistSession(ctx: BrowserContext): Promise<void> {
    await fs.mkdir(BaseScraper.SESSIONS_DIR, { recursive: true });
    const sessionPath = path.join(BaseScraper.SESSIONS_DIR, `${this.name}.json`);
    await ctx.storageState({ path: sessionPath });
    this.logger.info({ sessionPath }, 'Session persisted');
  }

  protected async loadSession(): Promise<Awaited<ReturnType<BrowserContext['storageState']>> | undefined> {
    const sessionPath = path.join(BaseScraper.SESSIONS_DIR, `${this.name}.json`);
    try {
      const raw = await fs.readFile(sessionPath, 'utf8');
      this.logger.info({ sessionPath }, 'Session loaded');
      return JSON.parse(raw) as Awaited<ReturnType<BrowserContext['storageState']>>;
    } catch {
      return undefined;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
