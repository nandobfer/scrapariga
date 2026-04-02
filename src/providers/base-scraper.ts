/**
 * base-scraper.ts — Abstract base class that serves as the ScraperContract.
 *
 * CONSTITUTION ENFORCEMENT (Principle I — Architecture & Design):
 *   - Every provider MUST extend BaseScraper and implement run().
 *   - BrowserService is injected via the constructor (Dependency Injection).
 *
 * SHARED LOGIC (never duplicated in providers):
 *   - Session persistence / restoration (Principle II)
 *   - Exponential backoff retry (Principle II)
 *   - File path generation under documents/<slug>/YYYY-MM-DD.<ext>
 *   - downloadFile() — axios fetch → tmp → MIME validate → move to final path
 *   - openDocument() — convert WSL path, open with explorer.exe
 *   - debugShot() — screenshot to screenshots/<provider>/YYYY-MM-DD/HH-MM-SS.png
 *   - ProgressEvent dispatch (FR-010, FR-011)
 *   - Structured logging with pino (Principle III)
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { spawn, execFile } from 'node:child_process';
import axios from 'axios';
import { fileTypeFromBuffer } from 'file-type';
import type { BrowserContext, Page } from 'playwright';
import type { Logger } from 'pino';
import type {
  EnvCredential,
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
  private static readonly SCREENSHOTS_DIR = path.resolve(process.cwd(), 'screenshots');

  constructor(
    protected readonly browserService: BrowserService,
    protected readonly logger: Logger,
  ) {}

  // ─── Abstract declarations ──────────────────────────────────────────────────

  abstract readonly name: string;
  abstract readonly requiredCredentials: EnvCredential[];

  /**
   * Providers implement all their logic here: navigation, data extraction,
   * file download. Use the shared helpers (retry, downloadFile, openDocument,
   * emitStep, debugShot, buildFilePath, persistSession, loadSession) freely.
   */
  abstract run(
    credentials: Record<string, string>,
    onProgress: ProgressCallback,
  ): Promise<ScraperResult>;

  // ─── Progress ───────────────────────────────────────────────────────────────

  /**
   * Stored during run() so helper methods can emit events without receiving
   * the callback as a parameter. Initialize to no-op.
   */
  protected _progressCallback: ProgressCallback = () => undefined;

  protected emitStep(event: ProgressEvent): void {
    try {
      this._progressCallback(event);
    } catch {
      this.logger.warn({ stepId: event.stepId }, 'ProgressCallback threw; ignoring');
    }
  }

  /** Convenience overload that accepts an explicit callback (useful in run() implementations). */
  protected emitProgress(cb: ProgressCallback, event: ProgressEvent): void {
    try {
      cb(event);
    } catch {
      this.logger.warn({ stepId: event.stepId }, 'ProgressCallback threw; ignoring');
    }
  }

  // ─── Retry ──────────────────────────────────────────────────────────────────

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

  // ─── File paths ─────────────────────────────────────────────────────────────

  /**
   * Returns `documents/<slug>/YYYY-MM-DD.<ext>` (absolute path).
   * The directory is NOT created here — call fs.mkdir before writing.
   */
  protected buildFilePath(docName: string, ext: string): string {
    const slug = docName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const date = new Date().toISOString().split('T')[0];
    return path.join(BaseScraper.DOCUMENTS_DIR, slug, `${date}.${ext}`);
  }

  // ─── downloadFile() ─────────────────────────────────────────────────────────

  /**
   * Downloads a URL via axios, validates MIME, and moves the file to finalPath.
   * The directory for finalPath is created automatically.
   *
   * @param url          Direct URL of the file to download.
   * @param finalPath    Destination path (use buildFilePath() to generate it).
   * @param allowedMimes List of accepted MIME types (e.g. ['application/pdf']).
   * @returns            Validated MIME type and file size in bytes.
   */
  protected async downloadFile(
    url: string,
    finalPath: string,
    allowedMimes: string[],
  ): Promise<{ mimeType: string; sizeBytes: number }> {
    const response = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer',
      timeout: 30_000,
    });
    const buffer = Buffer.from(response.data);

    const tmpPath = path.join(process.cwd(), `${this.name}-${Date.now()}.tmp`);
    await fs.writeFile(tmpPath, buffer);

    // Validate MIME before committing to final location
    const detected = await fileTypeFromBuffer(buffer);
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

    await fs.mkdir(path.dirname(finalPath), { recursive: true });

    try {
      await fs.rename(tmpPath, finalPath);
    } catch {
      // Cross-device fallback (tmp on different partition)
      await fs.copyFile(tmpPath, finalPath);
      await fs.unlink(tmpPath).catch(() => undefined);
    }

    const stat = await fs.stat(finalPath);
    this.logger.info({ finalPath, mimeType: detected.mime, sizeBytes: stat.size }, 'File saved');

    return { mimeType: detected.mime, sizeBytes: stat.size };
  }

  // ─── openDocument() ─────────────────────────────────────────────────────────

  /**
   * Opens a local file with the OS default application.
   * Under WSL the path is translated to a Windows path first; on native Linux
   * xdg-open is used as a fallback.
   */
  protected async openDocument(filePath: string): Promise<void> {
    let target = filePath;

    // Detect WSL by checking for wslpath availability
    const isWsl = await new Promise<boolean>((resolve) => {
      execFile('wslpath', ['-w', filePath], (err, stdout) => {
        if (!err && stdout.trim()) {
          target = stdout.trim();
          resolve(true);
        } else {
          resolve(false);
        }
      });
    });

    const bin = isWsl ? 'explorer.exe' : 'xdg-open';
    spawn(bin, [target], { detached: true, stdio: 'ignore' }).unref();
    this.logger.info({ filePath, target, bin }, 'Opened document');
  }

  // ─── debugShot() ────────────────────────────────────────────────────────────

  /**
   * Takes a screenshot and saves it to
   * `screenshots/<provider>/YYYY-MM-DD/HH-MM-SS.png`.
   * No-op unless DEBUG=true in the environment.
   */
  protected async debugShot(page: Page, label?: string): Promise<void> {
    if (process.env['DEBUG'] !== 'true') return;

    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = now.toTimeString().split(' ')[0]!.replace(/:/g, '-');
    const suffix = label ? `-${label.replace(/[^a-z0-9]/gi, '-')}` : '';
    const shotPath = path.join(
      BaseScraper.SCREENSHOTS_DIR,
      this.name,
      dateStr,
      `${timeStr}${suffix}.png`,
    );

    await fs.mkdir(path.dirname(shotPath), { recursive: true });
    await page.screenshot({ path: shotPath, fullPage: true });
    this.logger.info({ shotPath }, 'Debug screenshot saved');
  }

  // ─── Session persistence ─────────────────────────────────────────────────────

  protected async persistSession(ctx: BrowserContext): Promise<void> {
    await fs.mkdir(BaseScraper.SESSIONS_DIR, { recursive: true });
    const sessionPath = path.join(BaseScraper.SESSIONS_DIR, `${this.name}.json`);
    await ctx.storageState({ path: sessionPath });
    this.logger.info({ sessionPath }, 'Session persisted');
  }

  protected async loadSession(): Promise<
    Awaited<ReturnType<BrowserContext['storageState']>> | undefined
  > {
    const sessionPath = path.join(BaseScraper.SESSIONS_DIR, `${this.name}.json`);
    try {
      const raw = await fs.readFile(sessionPath, 'utf8');
      this.logger.info({ sessionPath }, 'Session loaded');
      return JSON.parse(raw) as Awaited<ReturnType<BrowserContext['storageState']>>;
    } catch {
      return undefined;
    }
  }

  // ─── Internal ───────────────────────────────────────────────────────────────

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}