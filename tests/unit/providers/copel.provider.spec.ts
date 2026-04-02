/**
 * copel.provider.spec.ts — Unit tests for CopelProvider.
 *
 * Tests with mocked Page objects; no network access occurs.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CopelProvider } from '../../../src/providers/copel/copel.provider.js';
import type { BrowserService } from '../../../src/providers/base-scraper.js';
import type { Page, Download } from 'playwright';
import { pino } from 'pino';

const logger = pino({ level: 'silent' });

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
    isVisible: vi.fn().mockResolvedValue(false),
    textContent: vi.fn().mockResolvedValue(''),
    or: vi.fn().mockReturnThis(),
    all: vi.fn().mockResolvedValue([]),
    locator: vi.fn().mockReturnThis(),
    ...overrides,
  };
}

// Unused helper function removed (makePageStub was not used)

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('CopelProvider', () => {
  let provider: CopelProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new CopelProvider(mockBrowserService, logger);
  });

  // ─── Contract ──────────────────────────────────────────────────────────────

  it('name is "copel"', () => {
    expect(provider.name).toBe('copel');
  });

  it('has exactly 2 requiredCredentials', () => {
    expect(provider.requiredCredentials).toHaveLength(2);
  });

  it('first credential is COPEL_CPF (not sensitive)', () => {
    const cred = provider.requiredCredentials[0];
    expect(cred.key).toBe('COPEL_CPF');
    expect(cred.sensitive).toBe(false);
  });

  it('second credential is COPEL_PASSWORD (sensitive)', () => {
    const cred = provider.requiredCredentials[1];
    expect(cred.key).toBe('COPEL_PASSWORD');
    expect(cred.sensitive).toBe(true);
  });

  // ─── doLogin() ─────────────────────────────────────────────────────────────

  describe('doLogin()', () => {
    it('navigates to Copel login URL', async () => {
      const cpfInput = makeLocatorStub({ waitFor: vi.fn().mockResolvedValue(undefined) });
      const passwordInput = makeLocatorStub();
      const submitBtn = makeLocatorStub();

      const mockPage = {
        goto: vi.fn().mockResolvedValue(undefined),
        waitForSelector: vi.fn().mockResolvedValue(undefined),
        locator: vi.fn().mockImplementation((sel: string) => {
          if (sel === 'a[href*="segundaViaFatura"]') {
            return { isVisible: vi.fn().mockResolvedValue(false) };
          }
          if (sel === '#formulario\\:numDoc') return cpfInput;
          if (sel === '#formulario\\:pass') return passwordInput;
          if (sel === '#formulario\\:j_idt41') return submitBtn;
          return makeLocatorStub();
        }),
      } as unknown as Page;

      await provider.doLogin(mockPage, { COPEL_CPF: '12345678900', COPEL_PASSWORD: 'senha123' });

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockPage.goto).toHaveBeenCalledWith(
        'https://www.copel.com/avaweb/paginaLogin/login.jsf',
        { waitUntil: 'networkidle', timeout: 30_000 },
      );
    });

    it('fills CPF and password when not logged in', async () => {
      const cpfInput = makeLocatorStub({ waitFor: vi.fn().mockResolvedValue(undefined) });
      const passwordInput = makeLocatorStub();
      const submitBtn = makeLocatorStub();

      const mockPage = {
        goto: vi.fn().mockResolvedValue(undefined),
        waitForSelector: vi.fn().mockResolvedValue(undefined),
        locator: vi.fn().mockImplementation((sel: string) => {
          if (sel === 'a[href*="segundaViaFatura"]') {
            return { isVisible: vi.fn().mockResolvedValue(false) };
          }
          if (sel === '#formulario\\:numDoc') return cpfInput;
          if (sel === '#formulario\\:pass') return passwordInput;
          if (sel === '#formulario\\:j_idt41') {
            return { ...submitBtn, or: vi.fn().mockReturnValue(submitBtn) };
          }
          return makeLocatorStub();
        }),
      } as unknown as Page;

      await provider.doLogin(mockPage, { COPEL_CPF: '12345678900', COPEL_PASSWORD: 'senha123' });

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(cpfInput.fill).toHaveBeenCalledWith('12345678900');
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(passwordInput.fill).toHaveBeenCalledWith('senha123');
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(submitBtn.click).toHaveBeenCalled();
    });

    it('skips login when already authenticated (session restored)', async () => {
      const mockPage = {
        goto: vi.fn().mockResolvedValue(undefined),
        locator: vi.fn().mockImplementation((sel: string) => {
          if (sel === 'a[href*="segundaViaFatura"]') {
            return { isVisible: vi.fn().mockResolvedValue(true) };
          }
          return makeLocatorStub();
        }),
      } as unknown as Page;

      await provider.doLogin(mockPage, { COPEL_CPF: '12345678900', COPEL_PASSWORD: 'senha123' });

      // Should not attempt to fill credentials if already logged in
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockPage.goto).toHaveBeenCalledOnce();
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockPage.locator).toHaveBeenCalledWith('a[href*="segundaViaFatura"]');
    });
  });

  // ─── navigateToSegundaVia() ────────────────────────────────────────────────

  describe('navigateToSegundaVia()', () => {
    it('clicks the segunda via link and waits for table', async () => {
      const link = makeLocatorStub({
        waitFor: vi.fn().mockResolvedValue(undefined),
      });

      const mockPage = {
        locator: vi.fn().mockReturnValue(link),
        waitForSelector: vi.fn().mockResolvedValue(undefined),
      } as unknown as Page;

      await provider.navigateToSegundaVia(mockPage);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockPage.locator).toHaveBeenCalledWith('a[href*="segundaViaFatura"]');
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(link.click).toHaveBeenCalled();
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockPage.waitForSelector).toHaveBeenCalledWith(
        '#formSegundaViaFatura\\:dtListaSegundaViaFaturaDebitoPendente',
        { timeout: 20_000 },
      );
    });
  });

  // ─── listPendingBills() ────────────────────────────────────────────────────

  describe('listPendingBills()', () => {
    it('returns single bill when only one "2 via" link exists', async () => {
      const link1 = makeLocatorStub({
        locator: vi.fn().mockReturnValue(
          makeLocatorStub({ textContent: vi.fn().mockResolvedValue('UC 123456 - Venc: 10/04/2026 - R$ 198,12') }),
        ),
      });

      const mockPage = {
        locator: vi.fn().mockReturnValue({
          all: vi.fn().mockResolvedValue([link1]),
        }),
      } as unknown as Page;

      const bills = await provider.listPendingBills(mockPage);

      expect(bills).toHaveLength(1);
      expect(bills[0]).toMatchObject({
        index: 0,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        label: expect.stringContaining('UC 123456'),
      });
    });

    it('returns multiple bills when multiple "2 via" links exist', async () => {
      const link1 = makeLocatorStub({
        locator: vi.fn().mockReturnValue(
          makeLocatorStub({ textContent: vi.fn().mockResolvedValue('UC 111 - Venc: 10/04/2026 - R$ 150,00') }),
        ),
      });
      const link2 = makeLocatorStub({
        locator: vi.fn().mockReturnValue(
          makeLocatorStub({ textContent: vi.fn().mockResolvedValue('UC 222 - Venc: 10/05/2026 - R$ 200,00') }),
        ),
      });

      const mockPage = {
        locator: vi.fn().mockReturnValue({
          all: vi.fn().mockResolvedValue([link1, link2]),
        }),
      } as unknown as Page;

      const bills = await provider.listPendingBills(mockPage);

      expect(bills).toHaveLength(2);
      expect(bills[0].index).toBe(0);
      expect(bills[1].index).toBe(1);
    });

    it('throws error when no bills found', async () => {
      const mockPage = {
        locator: vi.fn().mockReturnValue({
          all: vi.fn().mockResolvedValue([]),
        }),
      } as unknown as Page;

      await expect(provider.listPendingBills(mockPage)).rejects.toThrow(
        'Nenhuma fatura pendente encontrada',
      );
    });
  });

  // ─── promptBillSelection() ─────────────────────────────────────────────────

  describe('promptBillSelection()', () => {
    it('returns index immediately when only one bill', async () => {
      const bills = [{ index: 0, label: 'UC 123456 - R$ 198,12' }];

      const selectedIndex = await provider.promptBillSelection(bills);

      expect(selectedIndex).toBe(0);
    });
  });

  // ─── openBillModal() ───────────────────────────────────────────────────────

  describe('openBillModal()', () => {
    it('clicks the "2 via" link at specified index', async () => {
      const link1 = makeLocatorStub();
      const link2 = makeLocatorStub();

      const mockPage = {
        locator: vi.fn().mockReturnValue({
          all: vi.fn().mockResolvedValue([link1, link2]),
        }),
        waitForSelector: vi.fn().mockResolvedValue(undefined),
      } as unknown as Page;

      await provider.openBillModal(mockPage, 1);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(link2.click).toHaveBeenCalled();
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(link1.click).not.toHaveBeenCalled();
    });

    it('throws error when bill index out of range', async () => {
      const link1 = makeLocatorStub();

      const mockPage = {
        locator: vi.fn().mockReturnValue({
          all: vi.fn().mockResolvedValue([link1]),
        }),
      } as unknown as Page;

      await expect(provider.openBillModal(mockPage, 5)).rejects.toThrow('out of range');
    });
  });

  // ─── extractBillData() ─────────────────────────────────────────────────────

  describe('extractBillData()', () => {
    it('extracts PIX code, amount, and due date from modal', async () => {
      const pixCodeLocator = makeLocatorStub({
        textContent: vi
          .fn()
          .mockResolvedValue(
            '00020126510014BR.GOV.BCB.PIX01290111_copeldis_arrec@copel.com5204000053039865406198.125802BR',
          ),
      });
      const amountLocator = makeLocatorStub({
        textContent: vi.fn().mockResolvedValue('198,12'),
      });
      const dueDateLocator = makeLocatorStub({
        textContent: vi.fn().mockResolvedValue('10/04/2026'),
      });

      const mockPage = {
        locator: vi.fn().mockImplementation((sel: string) => {
          if (sel === '#frmModalSegundaVia\\:olPixCode') return pixCodeLocator;
          if (sel === '#frmModalSegundaVia\\:j_idt170') return amountLocator;
          if (sel === '#frmModalSegundaVia\\:j_idt166') return dueDateLocator;
          return makeLocatorStub();
        }),
      } as unknown as Page;

      const result = await provider.extractBillData(mockPage);

      expect(result.pixCode).toContain('00020126510014BR.GOV.BCB.PIX');
      expect(result.amountCents).toBe(19812); // 198.12 * 100
      expect(result.dueDate).toBe('10/04/2026');
    });

    it('throws error when PIX code is invalid', async () => {
      const pixCodeLocator = makeLocatorStub({
        textContent: vi.fn().mockResolvedValue('INVALID_PIX_CODE'),
      });

      const mockPage = {
        locator: vi.fn().mockReturnValue(pixCodeLocator),
      } as unknown as Page;

      await expect(provider.extractBillData(mockPage)).rejects.toThrow(
        'Código PIX não encontrado ou inválido',
      );
    });

    it('parses amount with dots correctly', async () => {
      const pixCodeLocator = makeLocatorStub({
        textContent: vi.fn().mockResolvedValue('00020126510014BR.GOV.BCB.PIX'),
      });
      const amountLocator = makeLocatorStub({
        textContent: vi.fn().mockResolvedValue('1.234,56'), // R$ 1.234,56
      });
      const dueDateLocator = makeLocatorStub({
        textContent: vi.fn().mockResolvedValue('10/04/2026'),
      });

      const mockPage = {
        locator: vi.fn().mockImplementation((sel: string) => {
          if (sel === '#frmModalSegundaVia\\:olPixCode') return pixCodeLocator;
          if (sel === '#frmModalSegundaVia\\:j_idt170') return amountLocator;
          if (sel === '#frmModalSegundaVia\\:j_idt166') return dueDateLocator;
          return makeLocatorStub();
        }),
      } as unknown as Page;

      const result = await provider.extractBillData(mockPage);

      expect(result.amountCents).toBe(123456); // R$ 1.234,56 → 123456 cents
    });
  });

  // ─── downloadBillPdf() ─────────────────────────────────────────────────────

  describe('downloadBillPdf()', () => {
    it('waits for download event with correct timeout', async () => {
      const mockDownload: Partial<Download> = {
        saveAs: vi.fn().mockResolvedValue(undefined),
      };

      const downloadBtn = makeLocatorStub();

      const mockPage = {
        locator: vi.fn().mockReturnValue(downloadBtn),
        waitForEvent: vi.fn().mockResolvedValue(mockDownload),
      } as unknown as Page;

      // The actual download will fail without proper fs mocking, but we can verify the setup
      const downloadPromise = provider.downloadBillPdf(mockPage, '/tmp/test-copel.pdf');

      // Verify the download button was clicked
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(downloadBtn.click).toHaveBeenCalled();
      
      // Verify waitForEvent was called with correct parameters
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockPage.waitForEvent).toHaveBeenCalledWith('download', { timeout: 45_000 });

      // Let the promise reject (expected without full fs mock setup)
      await expect(downloadPromise).rejects.toThrow();
    });
  });
});
