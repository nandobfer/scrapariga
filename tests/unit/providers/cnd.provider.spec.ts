/**
 * cnd.provider.spec.ts — Unit tests for CndProvider.
 *
 * Tests the Playwright interaction flow with a mocked Page object.
 * All browser calls are intercepted; no network access occurs.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CndProvider } from '../../../src/providers/cnd/cnd.provider.js';
import type { BrowserService } from '../../../src/providers/base-scraper.js';
import type { Page } from 'playwright';
import type { DocumentMetadata } from '../../../src/providers/interfaces.js';
import { pino } from 'pino';
import fs from 'node:fs/promises';
import path from 'node:path';

const logger = pino({ level: 'silent' });

// Minimal BrowserService stub — not used for direct method tests
const mockBrowserService: BrowserService = {
  newPage: vi.fn(),
  close: vi.fn().mockResolvedValue(undefined),
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeLocatorStub(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    waitFor: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
    click: vi.fn().mockResolvedValue(undefined),
    count: vi.fn().mockResolvedValue(0),
    filter: vi.fn().mockReturnThis(),
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('CndProvider', () => {
  let provider: CndProvider;

  beforeEach(() => {
    provider = new CndProvider(mockBrowserService, logger);
  });

  // ─── Contract ──────────────────────────────────────────────────────────────

  it('name is "cnd"', () => {
    expect(provider.name).toBe('cnd');
  });

  it('has exactly one requiredCredential: CNPJ (not sensitive)', () => {
    expect(provider.requiredCredentials).toHaveLength(1);
    const [cred] = provider.requiredCredentials;
    expect(cred.key).toBe('CNPJ');
    expect(cred.sensitive).toBe(false);
  });

  // ─── login() ───────────────────────────────────────────────────────────────

  describe('login()', () => {
    it('navigates to the Receita Federal CND URL', async () => {
      const input = makeLocatorStub();
      const button = makeLocatorStub();
      const mockPage = {
        goto: vi.fn().mockResolvedValue(undefined),
        locator: vi.fn().mockImplementation((sel: string) =>
          sel.includes('niContribuinte') ? input : button,
        ),
      };

      await provider.login(mockPage as unknown as Page, { CNPJ: '12345678000195' });

      expect(mockPage.goto).toHaveBeenCalledWith(
        'https://servicos.receitafederal.gov.br/servico/certidoes/#/home/cnpj',
        { waitUntil: 'networkidle' },
      );
    });

    it('formats a 14-digit CNPJ before filling', async () => {
      const input = makeLocatorStub();
      const button = makeLocatorStub();
      const mockPage = {
        goto: vi.fn().mockResolvedValue(undefined),
        locator: vi.fn().mockImplementation((sel: string) =>
          sel.includes('niContribuinte') ? input : button,
        ),
      };

      await provider.login(mockPage as unknown as Page, { CNPJ: '12345678000195' });

      expect(input.fill).toHaveBeenCalledWith('12.345.678/0001-95');
    });

    it('passes already-masked CNPJ through unchanged', async () => {
      const input = makeLocatorStub();
      const button = makeLocatorStub();
      const mockPage = {
        goto: vi.fn().mockResolvedValue(undefined),
        locator: vi.fn().mockImplementation((sel: string) =>
          sel.includes('niContribuinte') ? input : button,
        ),
      };

      await provider.login(mockPage as unknown as Page, { CNPJ: '12.345.678/0001-95' });

      expect(input.fill).toHaveBeenCalledWith('12.345.678/0001-95');
    });

    it('clicks the secondary button after filling CNPJ', async () => {
      const input = makeLocatorStub();
      const button = makeLocatorStub();
      const mockPage = {
        goto: vi.fn().mockResolvedValue(undefined),
        locator: vi.fn().mockImplementation((sel: string) =>
          sel.includes('niContribuinte') ? input : button,
        ),
      };

      await provider.login(mockPage as unknown as Page, { CNPJ: '12345678000195' });

      expect(button.click).toHaveBeenCalled();
    });
  });

  // ─── fetchDocuments() ──────────────────────────────────────────────────────

  describe('fetchDocuments()', () => {
    it('clicks submit and waits for download button, returns CND metadata', async () => {
      const downloadBtn = makeLocatorStub({ count: vi.fn().mockResolvedValue(0) });
      const submitBtn = makeLocatorStub();
      const mockPage = {
        locator: vi.fn().mockImplementation((sel: string) =>
          sel.includes('Segunda via') ? downloadBtn : submitBtn,
        ),
        waitForSelector: vi.fn().mockResolvedValue(undefined),
      };

      const docs = await provider.fetchDocuments(mockPage as unknown as Page);

      expect(docs).toHaveLength(1);
      expect(docs[0].name).toBe('certidao-negativa-debitos');
      expect(docs[0].id).toBe('cnd-certidao');
      expect(mockPage.waitForSelector).toHaveBeenCalledWith(
        'button[title="Segunda via"]',
        expect.any(Object),
      );
    });

    it('skips submit click when download button is already visible (retry safety)', async () => {
      const downloadBtn = makeLocatorStub({ count: vi.fn().mockResolvedValue(1) });
      const submitBtn = makeLocatorStub();
      const mockPage = {
        locator: vi.fn().mockImplementation((sel: string) =>
          sel.includes('Segunda via') ? downloadBtn : submitBtn,
        ),
        waitForSelector: vi.fn().mockResolvedValue(undefined),
      };

      await provider.fetchDocuments(mockPage as unknown as Page);

      expect(submitBtn.click).not.toHaveBeenCalled();
      expect(mockPage.waitForSelector).not.toHaveBeenCalled();
    });
  });

  // ─── download() ────────────────────────────────────────────────────────────

  describe('download()', () => {
    const doc: DocumentMetadata = { id: 'cnd-certidao', name: 'certidao-negativa-debitos' };
    const docsDir = path.join(process.cwd(), 'documents', 'certidao-negativa-debitos');

    afterEach(async () => {
      // Clean up the documents directory created by the test run
      await fs.rm(docsDir, { recursive: true, force: true });
      // Remove any leftover tmp files from the project root
      const entries = await fs.readdir(process.cwd()).catch(() => [] as string[]);
      await Promise.all(
        entries
          .filter((f) => f.startsWith('cnd-') && f.endsWith('.tmp'))
          .map((f) => fs.unlink(path.join(process.cwd(), f)).catch(() => undefined)),
      );
    });

    it('saves the downloaded PDF and returns a valid FileResult', async () => {
      // Write minimal PDF magic bytes so MIME validation passes
      const fakeContent = Buffer.from('%PDF-1.4\n\nfake content\n%%EOF\n');
      const mockDownloadEvent = {
        saveAs: vi.fn().mockImplementation(async (savePath: string) => {
          await fs.writeFile(savePath, fakeContent);
        }),
      };

      const downloadBtn = makeLocatorStub();
      const mockPage = {
        locator: vi.fn().mockReturnValue(downloadBtn),
        waitForEvent: vi.fn().mockResolvedValue(mockDownloadEvent),
      };

      const result = await provider.download(mockPage as unknown as Page, doc);

      expect(result.type).toBe('file');
      if (result.type === 'file') {
        expect(result.filePath).toContain('certidao-negativa-debitos');
        expect(result.mimeType).toBe('application/pdf');
        expect(result.sizeBytes).toBeGreaterThan(0);
        // File must exist on disk
        await expect(fs.stat(result.filePath)).resolves.toBeDefined();
      }
    });

    it('registers the download listener before clicking (correct Playwright pattern)', async () => {
      const callOrder: string[] = [];
      const fakeContent = Buffer.from('%PDF-1.4\n%%EOF\n');
      const mockDownloadEvent = {
        saveAs: vi.fn().mockImplementation(async (savePath: string) => {
          await fs.writeFile(savePath, fakeContent);
        }),
      };

      const downloadBtn = makeLocatorStub({
        click: vi.fn().mockImplementation(() => {
          callOrder.push('click');
          return Promise.resolve(undefined);
        }),
      });
      const mockPage = {
        locator: vi.fn().mockReturnValue(downloadBtn),
        waitForEvent: vi.fn().mockImplementation(() => {
          callOrder.push('waitForEvent');
          return Promise.resolve(mockDownloadEvent);
        }),
      };

      await provider.download(mockPage as unknown as Page, doc);

      // Both are started at the same time via Promise.all; order depends on JS microtask
      // queue (Promise.all starts all in registration order), so waitForEvent must be first
      expect(callOrder[0]).toBe('waitForEvent');
    });
  });
});
