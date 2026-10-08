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
  /**
   * Open a page backed by a persistent Chromium profile (`userDataDir`).
   * Cookies / localStorage live on disk, so SSO sessions survive between runs.
   * Optional so test doubles can omit it.
   */
  newPersistentPage?(userDataDir: string): Promise<Page>;
  /** Gracefully close the browser and all pages */
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// PlaywrightBrowserService
// ---------------------------------------------------------------------------

export interface PlaywrightBrowserServiceOptions {
  headless?: boolean;
  /**
   * Accept invalid/self-signed TLS certificates. Required when a corporate
   * TLS-inspection proxy (e.g. FortiGate MITM) re-signs HTTPS traffic with a CA
   * that Chromium does not trust — otherwise every page.goto fails with
   * `net::ERR_CERT_AUTHORITY_INVALID`.
   *
   * Defaults to true unless the env var PLAYWRIGHT_IGNORE_HTTPS_ERRORS=false.
   */
  ignoreHTTPSErrors?: boolean;
}

export class PlaywrightBrowserService implements BrowserService {
  private context: BrowserContext | null = null;
  private readonly headless: boolean;
  private readonly ignoreHTTPSErrors: boolean;

  constructor(options: PlaywrightBrowserServiceOptions = {}) {
    this.headless = options.headless ?? true;
    this.ignoreHTTPSErrors =
      options.ignoreHTTPSErrors ?? process.env['PLAYWRIGHT_IGNORE_HTTPS_ERRORS'] !== 'false';
  }

  async newPage(storageState?: SessionState): Promise<Page> {
    if (this.context) {
      await this.context.close();
      this.context = null;
    }
    const browser = await chromium.launch({ headless: this.headless });
    this.context = await browser.newContext({
      ignoreHTTPSErrors: this.ignoreHTTPSErrors,
      ...(storageState ? { storageState } : {}),
    });
    return this.context.newPage();
  }

  async newPersistentPage(userDataDir: string): Promise<Page> {
    if (this.context) {
      await this.context.close();
      this.context = null;
    }
    this.context = await chromium.launchPersistentContext(userDataDir, {
      ignoreHTTPSErrors: this.ignoreHTTPSErrors,
      headless: this.headless,
    });
    const [existing] = this.context.pages();
    return existing ?? this.context.newPage();
  }

  async close(): Promise<void> {
    if (this.context) {
      await this.context.close();
      this.context = null;
    }
  }
}
