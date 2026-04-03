/**
 * condominio.provider.spec.ts — Unit tests for CondominioProvider.
 *
 * Tests with mocked Page objects; no network access occurs.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CondominioProvider } from '../../../src/providers/condominio/condominio.provider.js';
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
  return {
    waitFor: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
    click: vi.fn().mockResolvedValue(undefined),
    isVisible: vi.fn().mockResolvedValue(false),
    textContent: vi.fn().mockResolvedValue(''),
    inputValue: vi.fn().mockResolvedValue(''),
    first: vi.fn().mockReturnThis(),
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('CondominioProvider', () => {
  let provider: CondominioProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new CondominioProvider(mockBrowserService, logger);
  });

  // ─── Contract ──────────────────────────────────────────────────────────────

  it('name is "condominio"', () => {
    expect(provider.name).toBe('condominio');
  });

  it('has exactly 2 requiredCredentials', () => {
    expect(provider.requiredCredentials).toHaveLength(2);
  });

  it('first credential is CONDO_EMAIL (not sensitive)', () => {
    const cred = provider.requiredCredentials[0];
    expect(cred.key).toBe('CONDO_EMAIL');
    expect(cred.sensitive).toBe(false);
  });

  it('second credential is CONDO_PASSWORD (sensitive)', () => {
    const cred = provider.requiredCredentials[1];
    expect(cred.key).toBe('CONDO_PASSWORD');
    expect(cred.sensitive).toBe(true);
  });

  // ─── doLogin() ─────────────────────────────────────────────────────────────

  describe('doLogin()', () => {
    it('navigates to the Superlogica areadocondomino URL', async () => {
      const emailInput = makeLocatorStub({
        waitFor: vi.fn().mockResolvedValue(undefined),
      });
      const page = {
        goto: vi.fn().mockResolvedValue(undefined),
        locator: vi.fn().mockReturnValue(emailInput),
        waitForSelector: vi.fn().mockResolvedValue(undefined),
      } as unknown as Page;

      // Trigger already-logged-in path via isVisible
      (emailInput.isVisible as ReturnType<typeof vi.fn>).mockResolvedValue(true);
      (page as unknown as Record<string, unknown>).locator = vi.fn().mockImplementation((sel: string) => {
        if (sel === '.bloco-grid-cobrancas') {
          return { ...emailInput, isVisible: vi.fn().mockResolvedValue(true) };
        }
        return emailInput;
      });

      await provider.doLogin(page, { CONDO_EMAIL: 'test@test.com', CONDO_PASSWORD: 'pass' });

      expect((page as unknown as { goto: ReturnType<typeof vi.fn> }).goto).toHaveBeenCalledWith(
        'https://officeadm.superlogica.net/clients/areadocondomino',
        { waitUntil: 'networkidle', timeout: 30_000 },
      );
    });

    it('fills email and clicks "Entrar Agora" when not logged in', async () => {
      const locatorCalls: string[] = [];
      const emailInput = makeLocatorStub();
      const passwordInput = makeLocatorStub();
      const entrarAgoraBtn = makeLocatorStub();
      const entrarBtn = makeLocatorStub();

      // Password locator with isVisible false (hidden initially)
      const passwordLocator = {
        ...passwordInput,
        isVisible: vi.fn().mockResolvedValue(false),
      };

      // Mock for race condition: email input appears (login page)
      const emailLocatorWithWait = {
        ...emailInput,
        waitFor: vi.fn().mockResolvedValue(undefined),
      };

      // Mock for race condition: grid never appears (timeout)
      const gridLocator = {
        first: vi.fn().mockReturnThis(),
        waitFor: vi.fn().mockImplementation(
          () => new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 20_000)),
        ),
      };

      const mockPage = {
        goto: vi.fn().mockResolvedValue(undefined),
        waitForSelector: vi.fn().mockResolvedValue(undefined),
        locator: vi.fn().mockImplementation((sel: string) => {
          locatorCalls.push(sel);
          if (sel === '.bloco-grid-cobrancas') return gridLocator;
          if (sel === '#email') return emailLocatorWithWait;
          if (sel === '#senha') return passwordLocator;
          if (sel === 'input[value="Entrar Agora"]') return entrarAgoraBtn;
          if (sel === 'input[value="Entrar"]') return entrarBtn;
          return makeLocatorStub();
        }),
      } as unknown as Page;

      await provider.doLogin(mockPage, {
        CONDO_EMAIL: 'user@example.com',
        CONDO_PASSWORD: 'secret',
      });

      expect(emailInput.fill).toHaveBeenCalledWith('user@example.com');
      expect(passwordLocator.isVisible).toHaveBeenCalled();
      expect(entrarAgoraBtn.click).toHaveBeenCalled();
      expect(passwordInput.fill).toHaveBeenCalledWith('secret');
      expect(entrarBtn.click).toHaveBeenCalled();
    });

    it('skips login when .bloco-grid-cobrancas is already visible (session restored)', async () => {
      const emailInput = makeLocatorStub();

      // Mock for race condition: grid appears immediately (session restored)
      const gridLocator = {
        first: vi.fn().mockReturnThis(),
        waitFor: vi.fn().mockResolvedValue(undefined),
      };

      // Mock for race condition: email never appears (will be ignored by Promise.race)
      const emailLocator = {
        waitFor: vi.fn().mockImplementation(
          () => new Promise((resolve) => setTimeout(resolve, 30_000)),
        ),
      };

      const mockPage = {
        goto: vi.fn().mockResolvedValue(undefined),
        waitForSelector: vi.fn().mockResolvedValue(undefined),
        locator: vi.fn().mockImplementation((sel: string) => {
          if (sel === '.bloco-grid-cobrancas') return gridLocator;
          if (sel === '#email') return emailLocator;
          return emailInput;
        }),
      } as unknown as Page;

      await provider.doLogin(mockPage, {
        CONDO_EMAIL: 'user@example.com',
        CONDO_PASSWORD: 'secret',
      });

      // Grid appeared first, so login was skipped
      expect(gridLocator.first).toHaveBeenCalled();
      expect(gridLocator.waitFor).toHaveBeenCalled();
      // email input should NOT have been filled
      expect(emailInput.fill).not.toHaveBeenCalled();
    });
  });

  // ─── readBoletoData() ──────────────────────────────────────────────────────

  describe('readBoletoData()', () => {
    it('parses "R$993,44" from p.valorFatura into 99344 cents', async () => {
      const mockPage = {
        locator: vi.fn().mockImplementation((sel: string) => {
          if (sel === 'p.valorFatura') {
            return { textContent: vi.fn().mockResolvedValue('Valor\natualizado: R$993,44') };
          }
          if (sel === '#DT_VENCIMENTO_FATURA') {
            return { textContent: vi.fn().mockResolvedValue('10/04/2026') };
          }
          if (sel === 'p.competencia') {
            return { textContent: vi.fn().mockResolvedValue('04/2026') };
          }
          return makeLocatorStub();
        }),
      } as unknown as Page;

      const result = await provider.readBoletoData(mockPage);

      expect(result.amountCents).toBe(99344);
    });

    it('parses "R$1.200,00" correctly into 120000 cents', async () => {
      const mockPage = {
        locator: vi.fn().mockImplementation((sel: string) => {
          if (sel === 'p.valorFatura') {
            return { textContent: vi.fn().mockResolvedValue('R$1.200,00') };
          }
          return { textContent: vi.fn().mockResolvedValue('') };
        }),
      } as unknown as Page;

      const { amountCents } = await provider.readBoletoData(mockPage);

      expect(amountCents).toBe(120000);
    });

    it('reads dueDate from #DT_VENCIMENTO_FATURA', async () => {
      const mockPage = {
        locator: vi.fn().mockImplementation((sel: string) => {
          if (sel === '#DT_VENCIMENTO_FATURA') {
            return { textContent: vi.fn().mockResolvedValue('  10/04/2026  ') };
          }
          return { textContent: vi.fn().mockResolvedValue('') };
        }),
      } as unknown as Page;

      const { dueDate } = await provider.readBoletoData(mockPage);

      expect(dueDate).toBe('10/04/2026');
    });

    it('reads competencia from p.competencia', async () => {
      const mockPage = {
        locator: vi.fn().mockImplementation((sel: string) => {
          if (sel === 'p.competencia') {
            return { textContent: vi.fn().mockResolvedValue('04/2026') };
          }
          return { textContent: vi.fn().mockResolvedValue('') };
        }),
      } as unknown as Page;

      const { competencia } = await provider.readBoletoData(mockPage);

      expect(competencia).toBe('04/2026');
    });

    it('returns amountCents=0 when valor text is missing or unparseable', async () => {
      const mockPage = {
        locator: vi.fn().mockReturnValue({
          textContent: vi.fn().mockResolvedValue('Carregando...'),
        }),
      } as unknown as Page;

      const { amountCents } = await provider.readBoletoData(mockPage);

      expect(amountCents).toBe(0);
    });
  });

  // ─── extractPixCode() ──────────────────────────────────────────────────────

  describe('extractPixCode()', () => {
    it('returns null (and does not throw) when PIX section fails to appear', async () => {
      const mockPage = {
        locator: vi.fn().mockReturnValue(makeLocatorStub()),
        waitForSelector: vi.fn().mockRejectedValue(new Error('Timeout')),
        evaluate: vi.fn().mockResolvedValue(null),
      } as unknown as Page;

      const result = await provider.extractPixCode(mockPage);

      expect(result).toBeNull();
    });
  });

  // ─── extractBoletoCode() ───────────────────────────────────────────────────

  describe('extractBoletoCode()', () => {
    it('returns the value from textarea.text', async () => {
      const textareaStub = makeLocatorStub({
        inputValue: vi.fn().mockResolvedValue('48190.00003 00000.000000 00000.000000 0 00000000000000'),
      });
      const mockPage = {
        locator: vi.fn().mockReturnValue(textareaStub),
        waitForSelector: vi.fn().mockResolvedValue(undefined),
      } as unknown as Page;

      const code = await provider.extractBoletoCode(mockPage);

      expect(code).toBe('48190.00003 00000.000000 00000.000000 0 00000000000000');
    });

    it('clicks #parcela-0 before reading the textarea', async () => {
      const radioStub = makeLocatorStub({
        click: vi.fn().mockResolvedValue(undefined),
      });
      const textareaStub = makeLocatorStub({
        inputValue: vi.fn().mockResolvedValue('12345'),
      });
      const mockPage = {
        locator: vi.fn().mockImplementation((sel: string) => {
          if (sel === '#parcela-0') return radioStub;
          return textareaStub;
        }),
        waitForSelector: vi.fn().mockResolvedValue(undefined),
      } as unknown as Page;

      await provider.extractBoletoCode(mockPage);

      expect(radioStub.click).toHaveBeenCalled();
    });
  });
});
