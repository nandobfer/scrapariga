/**
 * cnd.provider.spec.ts — Unit tests for CndProvider.
 *
 * Tests the manual flow: navigate, fill CNPJ, inject overlay, wait for close.
 * All browser calls are intercepted; no network access occurs.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CndProvider } from '../../../src/providers/cnd/cnd.provider.js';
import type { BrowserService } from '../../../src/providers/base-scraper.js';
import type { Page } from 'playwright';
import { pino } from 'pino';

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
      const mockPage = {
        goto: vi.fn().mockResolvedValue(undefined),
        locator: vi.fn().mockReturnValue(input),
      };

      await (provider as unknown as { navigateAndFill: (p: Page, c: Record<string, string>) => Promise<void> })
        .navigateAndFill(mockPage as unknown as Page, { CNPJ: '12345678000195' });

      expect(mockPage.goto).toHaveBeenCalledWith(
        'https://servicos.receitafederal.gov.br/servico/certidoes/#/home/cnpj',
        { waitUntil: 'load' },
      );
    });

    it('formats a 14-digit CNPJ before filling', async () => {
      const input = makeLocatorStub();
      const mockPage = {
        goto: vi.fn().mockResolvedValue(undefined),
        locator: vi.fn().mockReturnValue(input),
      };

      await (provider as unknown as { navigateAndFill: (p: Page, c: Record<string, string>) => Promise<void> })
        .navigateAndFill(mockPage as unknown as Page, { CNPJ: '12345678000195' });

      expect(input.fill).toHaveBeenCalledWith('12.345.678/0001-95');
    });

    it('passes already-masked CNPJ through unchanged', async () => {
      const input = makeLocatorStub();
      const mockPage = {
        goto: vi.fn().mockResolvedValue(undefined),
        locator: vi.fn().mockReturnValue(input),
      };

      await (provider as unknown as { navigateAndFill: (p: Page, c: Record<string, string>) => Promise<void> })
        .navigateAndFill(mockPage as unknown as Page, { CNPJ: '12.345.678/0001-95' });

      expect(input.fill).toHaveBeenCalledWith('12.345.678/0001-95');
    });

    it('does NOT click any button after filling (manual mode)', async () => {
      const input = makeLocatorStub();
      const mockPage = {
        goto: vi.fn().mockResolvedValue(undefined),
        locator: vi.fn().mockReturnValue(input),
      };

      await (provider as unknown as { navigateAndFill: (p: Page, c: Record<string, string>) => Promise<void> })
        .navigateAndFill(mockPage as unknown as Page, { CNPJ: '12345678000195' });

      expect(input.click).not.toHaveBeenCalled();
    });
  });

  // ─── run() manual flow ─────────────────────────────────────────────────────

  describe('run()', () => {
    it('returns ManualResult after page is closed', async () => {
      const input = makeLocatorStub();
      const mockPage = {
        goto: vi.fn().mockResolvedValue(undefined),
        locator: vi.fn().mockReturnValue(input),
        evaluate: vi.fn().mockResolvedValue(undefined),
        waitForEvent: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      };

      vi.mocked(mockBrowserService.newPage).mockResolvedValue(mockPage as unknown as Page);

      const result = await provider.run({ CNPJ: '12345678000195' }, vi.fn());

      expect(result.type).toBe('manual');
    });

    it('returns ErrorResult if navigation fails', async () => {
      const mockPage = {
        goto: vi.fn().mockRejectedValue(new Error('net::ERR_NAME_NOT_RESOLVED')),
        locator: vi.fn().mockReturnValue(makeLocatorStub()),
        close: vi.fn().mockResolvedValue(undefined),
      };

      vi.mocked(mockBrowserService.newPage).mockResolvedValue(mockPage as unknown as Page);

      const result = await provider.run({ CNPJ: '12345678000195' }, vi.fn());

      expect(result.type).toBe('error');
    });
  });
});
