/**
 * aluguel.provider.spec.ts — Unit tests for AluguelProvider.
 *
 * Tests the Playwright interaction flow with a mocked Page object.
 * All browser calls and HTTP calls are intercepted; no network access occurs.
 * No credentials are required — the PID is computed from the current date.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AluguelProvider } from '../../../src/providers/aluguel/aluguel.provider.js';
import type { BrowserService } from '../../../src/providers/base-scraper.js';
import type { Page } from 'playwright';
import { pino } from 'pino';

const logger = pino({ level: 'silent' });

const mockBrowserService: BrowserService = {
  newPage: vi.fn(),
  close: vi.fn().mockResolvedValue(undefined),
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeLocatorStub(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const stub: Record<string, unknown> = {
    waitFor: vi.fn().mockResolvedValue(undefined),
    click: vi.fn().mockResolvedValue(undefined),
    isVisible: vi.fn().mockResolvedValue(true),
    textContent: vi.fn().mockResolvedValue(''),
    getAttribute: vi.fn().mockResolvedValue(null),
    all: vi.fn().mockResolvedValue([]),
    first: vi.fn(),
    ...overrides,
  };
  (stub.first as ReturnType<typeof vi.fn>).mockReturnValue(stub);
  return stub;
}

function makeRowStub(text: string, lastCellText: string): Record<string, unknown> {
  const lastTd = makeLocatorStub({ textContent: vi.fn().mockResolvedValue(lastCellText) });
  const row = makeLocatorStub({
    textContent: vi.fn().mockResolvedValue(text),
    locator: vi.fn().mockReturnValue(
      makeLocatorStub({ all: vi.fn().mockResolvedValue([lastTd]) }),
    ),
  });
  return row;
}

function makeValidPage(rowText = 'Locacao: Contrato - 1230103 10-04-2026 2.496,69  0,00') {
  const tableRow = makeRowStub(rowText, '0,00');
  const dropdownBtn = makeLocatorStub({ isVisible: vi.fn().mockResolvedValue(true) });
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    locator: vi.fn().mockImplementation((sel: string) => {
      if (sel === '#dropdownMenuButton') return dropdownBtn;
      if (sel.includes('tbody tr')) return tableRow;
      return makeLocatorStub();
    }),
    waitForSelector: vi.fn().mockResolvedValue(undefined),
    once: vi.fn(),
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('AluguelProvider', () => {
  let provider: AluguelProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    provider = new AluguelProvider(mockBrowserService, logger);
  });

  // ─── Contract ──────────────────────────────────────────────────────────────

  it('name is "aluguel"', () => {
    expect(provider.name).toBe('aluguel');
  });

  it('requires no credentials', () => {
    expect(provider.requiredCredentials).toHaveLength(0);
  });

  // ─── PID derivation ───────────────────────────────────────────────────────

  describe('PID derivation from reference points', () => {
    it('derives PID 34849 for March 2026 (reference anchor)', async () => {
      vi.setSystemTime(new Date('2026-03-05T10:00:00'));
      const mockPage = makeValidPage('Locacao: Contrato - 1230103 10-03-2026 3.059,19  0,00');

      await provider.findPendingBoleto(mockPage as unknown as Page);

      const expectedPid = Buffer.from('34849').toString('base64');
      expect(mockPage.goto).toHaveBeenCalledWith(
        `https://anticoimoveis.com.br/cobrancas?pid=${expectedPid}`,
        expect.any(Object),
      );
    });

    it('derives PID 34850 for April 2026 (reference anchor)', async () => {
      vi.setSystemTime(new Date('2026-04-02T10:00:00'));
      const mockPage = makeValidPage();

      await provider.findPendingBoleto(mockPage as unknown as Page);

      const expectedPid = Buffer.from('34850').toString('base64');
      expect(mockPage.goto).toHaveBeenCalledWith(
        `https://anticoimoveis.com.br/cobrancas?pid=${expectedPid}`,
        expect.any(Object),
      );
    });

    it('derives PID 34851 for May 2026 (+1 from April reference)', async () => {
      vi.setSystemTime(new Date('2026-05-03T10:00:00'));
      const mockPage = makeValidPage('Locacao: Contrato - 1230103 10-05-2026 3.059,19  0,00');

      await provider.findPendingBoleto(mockPage as unknown as Page);

      const expectedPid = Buffer.from('34851').toString('base64');
      expect(mockPage.goto).toHaveBeenCalledWith(
        `https://anticoimoveis.com.br/cobrancas?pid=${expectedPid}`,
        expect.any(Object),
      );
    });

    it('derives PID 34861 for March 2027 (+12 months from March 2026)', async () => {
      vi.setSystemTime(new Date('2027-03-05T10:00:00'));
      const mockPage = makeValidPage('Locacao: Contrato - 1230103 10-03-2027 3.059,19  0,00');

      await provider.findPendingBoleto(mockPage as unknown as Page);

      const expectedPid = Buffer.from('34861').toString('base64');
      expect(mockPage.goto).toHaveBeenCalledWith(
        `https://anticoimoveis.com.br/cobrancas?pid=${expectedPid}`,
        expect.any(Object),
      );
    });

    it('starts one month ahead when run after the 10th (boleto likely already paid)', async () => {
      // April 15: today > 10, should start probing May 2026 (PID 34851)
      vi.setSystemTime(new Date('2026-04-15T10:00:00'));
      const mockPage = makeValidPage('Locacao: Contrato - 1230103 10-05-2026 3.059,19  0,00');

      await provider.findPendingBoleto(mockPage as unknown as Page);

      const expectedPid = Buffer.from('34851').toString('base64');
      expect(mockPage.goto).toHaveBeenCalledWith(
        `https://anticoimoveis.com.br/cobrancas?pid=${expectedPid}`,
        expect.any(Object),
      );
    });
  });

  // ─── login() probe behaviour ───────────────────────────────────────────────

  describe('findPendingBoleto()', () => {
    it('skips pages that do not show the dropdown (invalid PID)', async () => {
      vi.setSystemTime(new Date('2026-04-02T10:00:00'));

      const missingDropdown = makeLocatorStub({ isVisible: vi.fn().mockResolvedValue(false) });
      const validRow = makeRowStub(
        'Locacao: Contrato - 1230103 10-04-2026 2.496,69  0,00',
        '0,00',
      );
      const validDropdown = makeLocatorStub({ isVisible: vi.fn().mockResolvedValue(true) });

      let callCount = 0;
      const mockPage = {
        goto: vi.fn().mockResolvedValue(undefined),
        locator: vi.fn().mockImplementation((sel: string) => {
          if (sel === '#dropdownMenuButton') return callCount++ === 0 ? missingDropdown : validDropdown;
          if (sel.includes('tbody tr')) return validRow;
          return makeLocatorStub();
        }),
        waitForSelector: vi.fn().mockResolvedValue(undefined),
        once: vi.fn(),
      };

      await provider.findPendingBoleto(mockPage as unknown as Page);

      expect(mockPage.goto).toHaveBeenCalledTimes(2);
    });

    it('skips pages belonging to a different contract', async () => {
      vi.setSystemTime(new Date('2026-04-02T10:00:00'));

      const wrongRow = makeRowStub(
        'Locacao: Contrato - 9999999 10-04-2026 2.496,69  0,00',
        '0,00',
      );
      const rightRow = makeRowStub(
        'Locacao: Contrato - 1230103 10-04-2026 2.496,69  0,00',
        '0,00',
      );
      const dropdownBtn = makeLocatorStub({ isVisible: vi.fn().mockResolvedValue(true) });

      let callCount = 0;
      const mockPage = {
        goto: vi.fn().mockResolvedValue(undefined),
        locator: vi.fn().mockImplementation((sel: string) => {
          if (sel === '#dropdownMenuButton') return dropdownBtn;
          if (sel.includes('tbody tr')) return callCount++ === 0 ? wrongRow : rightRow;
          return makeLocatorStub();
        }),
        waitForSelector: vi.fn().mockResolvedValue(undefined),
        once: vi.fn(),
      };

      await provider.findPendingBoleto(mockPage as unknown as Page);

      expect(mockPage.goto).toHaveBeenCalledTimes(2);
    });

    it('skips already-paid boletos (Valor pago != 0,00)', async () => {
      vi.setSystemTime(new Date('2026-04-02T10:00:00'));

      const paidRow = makeRowStub(
        'Locacao: Contrato - 1230103 10-03-2026 2.496,69 09-03-2026 2.496,69',
        '2.496,69',
      );
      const unpaidRow = makeRowStub(
        'Locacao: Contrato - 1230103 10-04-2026 2.496,69  0,00',
        '0,00',
      );
      const dropdownBtn = makeLocatorStub({ isVisible: vi.fn().mockResolvedValue(true) });

      let callCount = 0;
      const mockPage = {
        goto: vi.fn().mockResolvedValue(undefined),
        locator: vi.fn().mockImplementation((sel: string) => {
          if (sel === '#dropdownMenuButton') return dropdownBtn;
          if (sel.includes('tbody tr')) return callCount++ === 0 ? paidRow : unpaidRow;
          return makeLocatorStub();
        }),
        waitForSelector: vi.fn().mockResolvedValue(undefined),
        once: vi.fn(),
      };

      await provider.findPendingBoleto(mockPage as unknown as Page);

      expect(mockPage.goto).toHaveBeenCalledTimes(2);
    });

    it('throws after exhausting all probe candidates', async () => {
      vi.setSystemTime(new Date('2026-04-02T10:00:00'));

      const dropdownBtn = makeLocatorStub({ isVisible: vi.fn().mockResolvedValue(false) });
      const mockPage = {
        goto: vi.fn().mockResolvedValue(undefined),
        locator: vi.fn().mockReturnValue(dropdownBtn),
        waitForSelector: vi.fn().mockResolvedValue(undefined),
        once: vi.fn(),
      };

      await expect(
        provider.findPendingBoleto(mockPage as unknown as Page),
      ).rejects.toThrow('Nenhum boleto pendente encontrado');
    });
  });

  // ─── readBoletoData() ─────────────────────────────────────────────────────

  describe('readBoletoData()', () => {
    it('registers a dialog listener before clicking the barcode button', async () => {
      const onceSpy = vi.fn();

      const mockPage = {
        locator: vi.fn().mockReturnValue(makeLocatorStub()),
        waitForSelector: vi.fn().mockResolvedValue(undefined),
        once: onceSpy,
      };

      // We don't await because the dialog never fires — just check ordering
      void provider.readBoletoData(mockPage as unknown as Page).catch(() => undefined);

      expect(onceSpy).toHaveBeenCalledWith('dialog', expect.any(Function));
    });

    it('returns boletoCode, amountCents, and dueDate', async () => {
      let dialogHandler: ((d: unknown) => void) | null = null;

      const mockDialog = {
        message: () => 'Linha digitavel copiada: 34191095030050798383164',
        accept: vi.fn().mockResolvedValue(undefined),
      };

      const rowLocator = makeLocatorStub({
        textContent: vi.fn().mockResolvedValue(
          'Locacao: Contrato - 1230103 10-04-2026 2.496,69  0,00',
        ),
      });

      const mockPage = {
        locator: vi.fn().mockImplementation((sel: string) => {
          if (sel.includes('tbody tr')) return rowLocator;
          return makeLocatorStub();
        }),
        waitForSelector: vi.fn().mockResolvedValue(undefined),
        once: vi.fn().mockImplementation((event: string, handler: (d: unknown) => void) => {
          if (event === 'dialog') dialogHandler = handler;
        }),
      };

      const fetchPromise = provider.readBoletoData(mockPage as unknown as Page);
      if (dialogHandler) await (dialogHandler as (d: unknown) => Promise<void>)(mockDialog);
      const data = await fetchPromise;

      expect(data.boletoCode).toBe('34191095030050798383164');
      expect(data.dueDate).toBe('10-04-2026');
      expect(data.amountCents).toBe(249669);
    });

    it('extracts the barcode from the dialog message', async () => {
      const expectedBarcode = '34191095030050798383164000550000414120000305919';
      let dialogHandler: ((d: unknown) => void) | null = null;

      const mockDialog = {
        message: () => `Linha digitavel copiada: ${expectedBarcode}`,
        accept: vi.fn().mockResolvedValue(undefined),
      };

      const rowLocator = makeLocatorStub({
        textContent: vi.fn().mockResolvedValue('1230103 10-04-2026 3.059,19  0,00'),
      });

      const mockPage = {
        locator: vi.fn().mockImplementation((sel: string) => {
          if (sel.includes('tbody tr')) return rowLocator;
          return makeLocatorStub();
        }),
        waitForSelector: vi.fn().mockResolvedValue(undefined),
        once: vi.fn().mockImplementation((event: string, handler: (d: unknown) => void) => {
          if (event === 'dialog') dialogHandler = handler;
        }),
      };

      const fetchPromise = provider.readBoletoData(mockPage as unknown as Page);
      if (dialogHandler) await (dialogHandler as (d: unknown) => Promise<void>)(mockDialog);
      const data = await fetchPromise;

      expect(data.boletoCode).toBe(expectedBarcode);
    });
  });
});
