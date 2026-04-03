/**
 * browser.service.ts — BrowserService interface + PlaywrightBrowserService implementation.
 *
 * Dependency-injected into BaseScraper. Enables test doubles without launching
 * a real browser (Constitution Principle I — Dependency Injection).
 */

import { chromium, type BrowserContext, type Page } from 'playwright';

type SessionState = Awaited<ReturnType<BrowserContext['storageState']>>;

// ---------------------------------------------------------------------------
// BrowserService interface (also re-exported from base-scraper.ts)
// ---------------------------------------------------------------------------

export interface BrowserService {
  /** Open a new page, optionally restoring a previously saved session state */
  newPage(storageState?: SessionState): Promise<Page>;
  /** Gracefully close the browser and all pages */
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// PlaywrightBrowserService
// ---------------------------------------------------------------------------

export interface PlaywrightBrowserServiceOptions {
  headless?: boolean;
}

export class PlaywrightBrowserService implements BrowserService {
  private context: BrowserContext | null = null;
  private readonly headless: boolean;

  constructor(options: PlaywrightBrowserServiceOptions = {}) {
    this.headless = options.headless ?? true;
  }

  async newPage(storageState?: SessionState): Promise<Page> {
    if (this.context) {
      await this.context.close();
      this.context = null;
    }
    const browser = await chromium.launch({ headless: this.headless });
    this.context = await browser.newContext(
      storageState ? { storageState } : undefined,
    );
    return this.context.newPage();
  }

  async close(): Promise<void> {
    if (this.context) {
      await this.context.close();
      this.context = null;
    }
  }
}
