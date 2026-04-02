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

  // ─── navigateAndFill() ─────────────────────────────────────────────────────

  describe('navigateAndFill()', () => {
    it('navigates to the Receita Federal CND URL', async () => {
      const input = makeLocatorStub();
      const button = makeLocatorStub();
      const mockPage = {
        goto: vi.fn().mockResolvedValue(undefined),
        locator: vi.fn().mockImplementation((sel: string) =>
          sel.includes('niContribuinte') ? input : button,
        ),
      };

      await provider.navigateAndFill(mockPage as unknown as Page, { CNPJ: '12345678000195' });

      expect(mockPage.goto).toHaveBeenCalledWith(
        'https://servicos.receitafederal.gov.br/servico/certidoes/#/home/cnpj',
        { waitUntil: 'load' },
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

      await provider.navigateAndFill(mockPage as unknown as Page, { CNPJ: '12345678000195' });

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

      await provider.navigateAndFill(mockPage as unknown as Page, { CNPJ: '12.345.678/0001-95' });

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

      await provider.navigateAndFill(mockPage as unknown as Page, { CNPJ: '12345678000195' });

      expect(button.click).toHaveBeenCalled();
    });
  });

  // ─── waitForResult() ───────────────────────────────────────────────────────

  describe('waitForResult()', () => {
    it('waits for the Segunda via button', async () => {
      const mockPage = {
        locator: vi.fn().mockReturnValue(makeLocatorStub()),
        waitForSelector: vi.fn().mockResolvedValue(undefined),
      };

      await provider.waitForResult(mockPage as unknown as Page);

      expect(mockPage.waitForSelector).toHaveBeenCalledWith(
        'button[title="Segunda via"]',
        expect.any(Object),
      );
    });
  });

  // ─── downloadCertidao() ────────────────────────────────────────────────────

  describe('downloadCertidao()', () => {
    const finalPath = path.join(process.cwd(), 'documents', 'certidao-negativa-debitos', 'test.pdf');
    const docsDir = path.dirname(finalPath);

    afterEach(async () => {
      await fs.rm(docsDir, { recursive: true, force: true });
      const entries = await fs.readdir(process.cwd()).catch(() => [] as string[]);
      await Promise.all(
        entries
          .filter((f) => f.startsWith('cnd-') && f.endsWith('.tmp'))
          .map((f) => fs.unlink(path.join(process.cwd(), f)).catch(() => undefined)),
      );
    });

    it('saves the downloaded PDF and returns mimeType and sizeBytes', async () => {
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

      const result = await provider.downloadCertidao(mockPage as unknown as Page, finalPath);

      expect(result.mimeType).toBe('application/pdf');
      expect(result.sizeBytes).toBeGreaterThan(0);
      await expect(fs.stat(finalPath)).resolves.toBeDefined();
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

      await provider.downloadCertidao(mockPage as unknown as Page, finalPath);

      expect(callOrder[0]).toBe('waitForEvent');
    });
  });
});
