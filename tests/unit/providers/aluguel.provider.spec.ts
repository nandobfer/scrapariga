/**
 * aluguel.provider.spec.ts — Unit tests for AluguelProvider.
 *
 * Tests the portal interaction flow with a mocked Page (APIRequestContext only).
 * All HTTP calls are intercepted; no network access occurs.
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

type FakeJson = { success: boolean; data?: Array<Record<string, unknown>> };

interface HttpPageOptions {
  /** Response for POST finangerarcobrancas.imprimir for a given parcela id. */
  dataFor?: (cid: number) => FakeJson;
  /** Whether GET ajax.getParcelaInfo reports the parcela as paid. */
  paidFor?: (cid: number) => boolean;
  /** Raw HTML returned by ajax.getParcelaInfo (overrides paidFor). */
  infoFor?: (cid: number) => string;
}

function makeHttpPage(options: HttpPageOptions = {}): { page: Page; requested: number[] } {
  const requested: number[] = [];
  const page = {
    request: {
      post: vi.fn().mockImplementation((_url: string, arg: { form: Record<string, string> }) => {
        const cid = Number(arg.form['cid[]']);
        requested.push(cid);
        const body = options.dataFor?.(cid) ?? { success: false, data: [] };
        return Promise.resolve({ json: () => Promise.resolve(body) });
      }),
      get: vi.fn().mockImplementation((url: string) => {
        const match = /parcela_id=(\d+)/.exec(url);
        const cid = Number(match?.[1]);
        const html = options.infoFor
          ? options.infoFor(cid)
          : options.paidFor?.(cid)
            ? '<tr><td>Data Pagamento</td></tr>'
            : '<tr><td>Referente</td></tr>';
        return Promise.resolve({ text: () => Promise.resolve(html) });
      }),
    },
  };
  return { page: page as unknown as Page, requested };
}

/** imprimir response for an open boleto of the given contract. */
function openBoleto(cid: number, contract = '1230104'): FakeJson {
  return { success: true, data: [{ id: cid, numero_contrato: contract }] };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('AluguelProvider', () => {
  let provider: AluguelProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    process.env['ALUGUEL_CONTRACT'] = '1230104';
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

  describe('PID derivation from the reference anchor', () => {
    async function firstProbedPid(date: string): Promise<number | undefined> {
      vi.setSystemTime(new Date(date));
      const { page, requested } = makeHttpPage(); // all ids nonexistent
      await expect(provider.findPendingBoleto(page)).rejects.toThrow(
        'Nenhum boleto pendente encontrado',
      );
      return requested[0];
    }

    it('derives PID 39127 for October 2026 (reference anchor)', async () => {
      expect(await firstProbedPid('2026-10-05T10:00:00')).toBe(39127);
    });

    it('derives PID 39128 for November 2026 (+1 from reference)', async () => {
      expect(await firstProbedPid('2026-11-02T10:00:00')).toBe(39128);
    });

    it('derives PID 39139 for October 2027 (+12 months from reference)', async () => {
      expect(await firstProbedPid('2027-10-05T10:00:00')).toBe(39139);
    });

    it('starts one month ahead when run after the 10th (boleto likely already paid)', async () => {
      // Oct 15: today > 10, should start probing November 2026 (PID 39128)
      expect(await firstProbedPid('2026-10-15T10:00:00')).toBe(39128);
    });
  });

  // ─── findPendingBoleto() probe behaviour ──────────────────────────────────

  describe('findPendingBoleto()', () => {
    it('returns the open boleto for the reference month', async () => {
      vi.setSystemTime(new Date('2026-10-05T10:00:00'));
      const { page } = makeHttpPage({ dataFor: (cid) => openBoleto(cid) });

      await expect(provider.findPendingBoleto(page)).resolves.toBe(39127);
    });

    it('skips nonexistent parcela ids', async () => {
      vi.setSystemTime(new Date('2026-10-05T10:00:00'));
      const { page, requested } = makeHttpPage({
        dataFor: (cid) => (cid === 39127 ? { success: false, data: [] } : openBoleto(cid)),
      });

      await expect(provider.findPendingBoleto(page)).resolves.toBe(39128);
      expect(requested[0]).toBe(39127);
    });

    it('skips boletos belonging to a different contract', async () => {
      vi.setSystemTime(new Date('2026-10-05T10:00:00'));
      const { page } = makeHttpPage({
        dataFor: (cid) => openBoleto(cid, cid === 39127 ? '9999999' : '1230104'),
      });

      await expect(provider.findPendingBoleto(page)).resolves.toBe(39128);
    });

    it('skips already-paid boletos (Data Pagamento present)', async () => {
      vi.setSystemTime(new Date('2026-10-05T10:00:00'));
      const { page } = makeHttpPage({
        dataFor: (cid) => openBoleto(cid),
        paidFor: (cid) => cid === 39127,
      });

      await expect(provider.findPendingBoleto(page)).resolves.toBe(39128);
    });

    it('throws after exhausting all probe candidates', async () => {
      vi.setSystemTime(new Date('2026-10-05T10:00:00'));
      const { page, requested } = makeHttpPage();

      await expect(provider.findPendingBoleto(page)).rejects.toThrow(
        'Nenhum boleto pendente encontrado',
      );
      expect(requested).toHaveLength(7); // basePid .. basePid + MAX_PID_PROBE
    });

    it('throws a clear error when ALUGUEL_CONTRACT is not set', async () => {
      delete process.env['ALUGUEL_CONTRACT'];
      const { page } = makeHttpPage();

      await expect(provider.findPendingBoleto(page)).rejects.toThrow(
        'ALUGUEL_CONTRACT não definido',
      );
    });
  });

  // ─── readBoletoData() ─────────────────────────────────────────────────────

  describe('readBoletoData()', () => {
    it('generates the boleto via the imprimir endpoint and maps the response', async () => {
      const post = vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({
          success: true,
          data: [
            {
              linha_digitavel: '34191.09503 00557.633831 64000.550000 1 15980000313256',
              valor_boleto: '3132,56',
              valor_desconto: '562.50',
              aplicar_descontos: true,
              data_vencimento: '13/10/2026',
              fileurl: 'https://anticoimoveis.com.br/tmp/x.pdf',
            },
          ],
        }),
      });
      const mockPage = { request: { post } } as unknown as Page;

      const data = await provider.readBoletoData(mockPage, 39127);

      expect(post).toHaveBeenCalledWith(
        expect.stringContaining('task=finangerarcobrancas.imprimir'),
        { form: { 'cid[]': '39127' } },
      );
      expect(data.boletoCode).toBe('34191.09503 00557.633831 64000.550000 1 15980000313256');
      // R$ 3.132,56 − R$ 562,50 (desconto até o vencimento) = R$ 2.570,06
      expect(data.amountCents).toBe(257006);
      expect(data.dueDate).toBe('13-10-2026'); // DD/MM/YYYY → DD-MM-YYYY
      expect(data.fileUrl).toBe('https://anticoimoveis.com.br/tmp/x.pdf');
    });

    it('does not deduct the discount when aplicar_descontos is false', async () => {
      const post = vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({
          success: true,
          data: [
            {
              valor_boleto: '3132,56',
              valor_desconto: '562.50',
              aplicar_descontos: false,
              fileurl: 'https://anticoimoveis.com.br/tmp/x.pdf',
            },
          ],
        }),
      });
      const mockPage = { request: { post } } as unknown as Page;

      const data = await provider.readBoletoData(mockPage, 39127);

      expect(data.amountCents).toBe(313256); // sem desconto
    });

    it('throws when the portal response has no boleto data', async () => {
      const mockPage = {
        request: {
          post: vi.fn().mockResolvedValue({
            json: vi.fn().mockResolvedValue({ success: false, data: [] }),
          }),
        },
      } as unknown as Page;

      await expect(provider.readBoletoData(mockPage, 39127)).rejects.toThrow(
        'Falha ao gerar o boleto no portal',
      );
    });
  });
});
