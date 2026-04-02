/**
 * BaseScraper.ts — Abstract base class that serves as the ScraperContract.
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
 *   - File path generation and directory creation (FR-005, data-model.md convention)
 *   - Download MIME validation (Principle IV)
 *   - ProgressEvent dispatch (FR-010, FR-011)
 *   - Structured logging with pino (Principle III)
 *
 * PROVIDER RESPONSIBILITY (only what belongs in each concrete class):
 *   - abstract name: string             — provider identifier
 *   - abstract requiredCredentials      — which env vars are needed
 *   - abstract login()                  — site-specific auth flow
 *   - abstract fetchDocuments()         — site-specific document listing
 *   - abstract download()               — site-specific download/payment extraction
 *
 * File: src/providers/base-scraper.ts  (canonical location in the codebase)
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { fileTypeFromBuffer } from 'file-type';
import type { BrowserContext, Page, StorageState } from 'playwright';
import type { Logger } from 'pino';
import type {
  EnvCredential,
  DocumentMetadata,
  ProgressCallback,
  ProgressEvent,
  RetryOptions,
  ScraperResult,
} from './interfaces';

// ---------------------------------------------------------------------------
// BrowserService interface (src/core/browser.service.ts)
// Injected into BaseScraper; allows test doubles without launching a real browser.
// ---------------------------------------------------------------------------

export interface BrowserService {
  /** Open a new page with an optional pre-loaded session state */
  newPage(storageState?: StorageState): Promise<Page>;
  /** Gracefully close the browser */
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// BaseScraper — Abstract Class
// ---------------------------------------------------------------------------

export abstract class BaseScraper {
  /** Paths */
  private static readonly DOCUMENTS_DIR = path.resolve(process.cwd(), 'documents');
  private static readonly SESSIONS_DIR = path.resolve(process.cwd(), 'sessions');

  constructor(
    protected readonly browserService: BrowserService,
    protected readonly logger: Logger,
  ) {}

  // ─── Abstract declarations (MUST be implemented by every provider) ─────────

  /** Unique provider identifier. Used for session file names and document subdirs. */
  abstract readonly name: string;

  /**
   * Environment variables required by this provider.
   * Declared statically so EnvService can verify/collect them before
   * opening any browser or making any network call.
   */
  abstract readonly requiredCredentials: EnvCredential[];

  /**
   * Site-specific authentication.
   * Called by run() with a fresh (or session-restored) Page.
   * MUST emit at least one ProgressEvent (pending → success/error).
   */
  abstract login(page: Page, credentials: Record<string, string>): Promise<void>;

  /**
   * Site-specific document listing.
   * Returns metadata for all downloadable documents found on the authenticated page.
   * MUST emit at least one ProgressEvent (pending → success/error).
   */
  abstract fetchDocuments(page: Page): Promise<DocumentMetadata[]>;

  /**
   * Site-specific download or payment data extraction.
   * Returns a FileResult, PaymentResult, or ErrorResult.
   * MUST emit at least one ProgressEvent (pending → success/error).
   */
  abstract download(page: Page, doc: DocumentMetadata): Promise<ScraperResult>;

  // ─── Template Method ───────────────────────────────────────────────────────

  /**
   * Executes the full scraping flow in a defined order:
   *   loadSession → login → fetchDocuments → download → persistSession
   *
   * Each step is wrapped in retry() with exponential backoff.
   * ProgressEvents are dispatched to the CLI via the onProgress callback.
   *
   * Providers MUST NOT override this method.
   */
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

  // ─── Shared helpers (NOT overridden by providers) ──────────────────────────

  /**
   * Dispatch a ProgressEvent to the CLI renderer.
   * Always goes through this method — providers never call onProgress directly.
   */
  protected emitProgress(cb: ProgressCallback, event: ProgressEvent): void {
    try {
      cb(event);
    } catch {
      // renderer errors must never crash the provider
      this.logger.warn({ event }, 'ProgressCallback threw; ignoring');
    }
  }

  /**
   * Retry wrapper with exponential backoff.
   * Delays: baseDelayMs × 2^(attempt-1)  →  1s, 2s, 4s with defaults.
   */
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
    // unreachable — TypeScript type narrowing requires explicit throw
    throw new Error('retry: unreachable');
  }

  /**
   * Build the canonical file path for a downloaded document.
   * Convention: ./documents/<slug>/<YYYY-MM-DD>.<ext>
   */
  protected buildFilePath(docName: string, ext: string): string {
    const slug = docName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    return path.join(BaseScraper.DOCUMENTS_DIR, slug, `${date}.${ext}`);
  }

  /**
   * Ensure the directory for the given document subdirectory exists.
   * Creates ./documents/<subDir>/ recursively if missing.
   * Returns the absolute path to the directory.
   */
  protected async ensureDir(subDir: string): Promise<string> {
    const dir = path.join(BaseScraper.DOCUMENTS_DIR, subDir);
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  /**
   * Validate the MIME type of a downloaded file.
   * Reads the file from tmpPath, checks MIME against allowedMimes,
   * deletes tmpPath and throws if invalid.
   * Called by providers before moving the tmp file to its final destination.
   */
  protected async validateDownload(
    tmpPath: string,
    allowedMimes: string[],
  ): Promise<void> {
    const buf = await fs.readFile(tmpPath);
    const detected = await fileTypeFromBuffer(buf);

    if (!detected || !allowedMimes.includes(detected.mime)) {
      await fs.unlink(tmpPath).catch(() => undefined);
      this.logger.warn(
        // SECURITY: do not log file content — only path and detected mime
        { tmpPath, detectedMime: detected?.mime ?? 'unknown', allowedMimes },
        'Download rejected: invalid MIME type',
      );
      throw new Error(
        `Invalid MIME type: expected one of [${allowedMimes.join(', ')}], got ${detected?.mime ?? 'unknown'}`,
      );
    }
  }

  /**
   * Persist the current Playwright BrowserContext session to disk.
   * Saved to ./sessions/<provider-name>.json.
   */
  protected async persistSession(ctx: BrowserContext): Promise<void> {
    await fs.mkdir(BaseScraper.SESSIONS_DIR, { recursive: true });
    const sessionPath = path.join(BaseScraper.SESSIONS_DIR, `${this.name}.json`);
    await ctx.storageState({ path: sessionPath });
    this.logger.info({ sessionPath }, 'Session persisted');
  }

  /**
   * Load a previously saved Playwright session state from disk.
   * Returns undefined if no session file exists (first run or after expiry).
   */
  protected async loadSession(): Promise<StorageState | undefined> {
    const sessionPath = path.join(BaseScraper.SESSIONS_DIR, `${this.name}.json`);
    try {
      const raw = await fs.readFile(sessionPath, 'utf8');
      this.logger.info({ sessionPath }, 'Session loaded');
      return JSON.parse(raw) as StorageState;
    } catch {
      return undefined; // file does not exist or is invalid — start fresh
    }
  }

  // ─── Private utilities ────────────────────────────────────────────────────

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
