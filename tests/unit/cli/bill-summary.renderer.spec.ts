import { describe, it, expect, beforeEach } from 'vitest';
import { BillSummaryRenderer } from '../../../src/cli/renderer/bill-summary.renderer.js';
import type {
  BoletoResult,
  CondoBoletoResult,
  CopelBillResult,
  ErrorResult,
} from '../../../src/providers/interfaces.js';

describe('BillSummaryRenderer', () => {
  let renderer: BillSummaryRenderer;

  beforeEach(() => {
    renderer = new BillSummaryRenderer();
  });

  describe('render', () => {
    it('renders summary with multiple successful results', () => {
      const results = [
        makeBoletoResult('aluguel', 249669),
        makeCondoResult('condominio', 99344),
        makeCopelResult('copel', 19812),
      ];

      // Should not throw
      expect(() => renderer.render(results, 1)).not.toThrow();
    });

    it('renders with split people > 1', () => {
      const results = [
        makeBoletoResult('aluguel', 249669),
        makeCondoResult('condominio', 99344),
      ];

      expect(() => renderer.render(results, 2)).not.toThrow();
    });

    it('renders with split people = 1 (no division line)', () => {
      const results = [makeBoletoResult('aluguel', 100000)];

      expect(() => renderer.render(results, 1)).not.toThrow();
    });

    it('handles empty results', () => {
      expect(() => renderer.render([], 1)).not.toThrow();
    });

    it('handles only error results', () => {
      const results = [makeErrorResult('Test error')];

      expect(() => renderer.render(results, 1)).not.toThrow();
    });

    it('filters out error results from calculation', () => {
      const results = [
        makeBoletoResult('aluguel', 100000),
        makeErrorResult('Error happened'),
        makeCondoResult('condominio', 50000),
      ];

      expect(() => renderer.render(results, 1)).not.toThrow();
    });

    it('handles mixed successful and error results', () => {
      const results = [
        makeBoletoResult('aluguel', 249669),
        makeErrorResult('Login failed'),
        makeCopelResult('copel', 19812),
      ];

      expect(() => renderer.render(results, 2)).not.toThrow();
    });

    it('handles large numbers', () => {
      const results = [
        makeBoletoResult('aluguel', 999999999), // R$ 9.999.999,99
      ];

      expect(() => renderer.render(results, 1)).not.toThrow();
    });

    it('handles zero amounts', () => {
      const results = [makeBoletoResult('aluguel', 0)];

      expect(() => renderer.render(results, 1)).not.toThrow();
    });

    it('handles rounding for odd split', () => {
      const results = [
        makeBoletoResult('aluguel', 100), // R$ 1,00
      ];

      // 100 / 3 = 33.33... should round to 33
      expect(() => renderer.render(results, 3)).not.toThrow();
    });

    it('handles all three provider types', () => {
      const results = [
        makeBoletoResult('aluguel', 249669),
        makeCondoResult('condominio', 99344),
        makeCopelResult('copel', 19812),
      ];

      expect(() => renderer.render(results, 2)).not.toThrow();
    });

    it('handles single provider', () => {
      const results = [makeCopelResult('copel', 19812)];

      expect(() => renderer.render(results, 1)).not.toThrow();
    });

    it('handles large split people number', () => {
      const results = [makeBoletoResult('aluguel', 1000000)];

      expect(() => renderer.render(results, 10)).not.toThrow();
    });
  });

  describe('extractBills', () => {
    it('extracts bill from boleto result', () => {
      const result = makeBoletoResult('aluguel', 100000);
      const bills = renderer['extractBills']([result]);

      expect(bills).toHaveLength(1);
      expect(bills[0]).toMatchObject({
        name: 'aluguel',
        amountCents: 100000,
      });
    });

    it('extracts bill from condo result', () => {
      const result = makeCondoResult('condominio', 50000);
      const bills = renderer['extractBills']([result]);

      expect(bills).toHaveLength(1);
      expect(bills[0]).toMatchObject({
        name: 'condominio',
        amountCents: 50000,
      });
    });

    it('extracts bill from copel result', () => {
      const result = makeCopelResult('copel', 25000);
      const bills = renderer['extractBills']([result]);

      expect(bills).toHaveLength(1);
      expect(bills[0]).toMatchObject({
        name: 'copel',
        amountCents: 25000,
      });
    });

    it('filters out error results', () => {
      const results = [
        makeBoletoResult('aluguel', 100000),
        makeErrorResult('Error'),
      ];

      const bills = renderer['extractBills'](results);
      expect(bills).toHaveLength(1);
    });

    it('handles empty array', () => {
      const bills = renderer['extractBills']([]);
      expect(bills).toHaveLength(0);
    });

    it('preserves provider names', () => {
      const results = [
        makeBoletoResult('aluguel', 100000),
        makeCondoResult('condominio', 50000),
        makeCopelResult('copel', 25000),
      ];

      const bills = renderer['extractBills'](results);
      expect(bills.map((b) => b.name)).toEqual(['aluguel', 'condominio', 'copel']);
    });
  });
});

// ─── Test Helpers ──────────────────────────────────────────────────────────

function makeBoletoResult(
  providerName: string,
  amountCents: number,
): BoletoResult {
  return {
    type: 'boleto',
    providerName,
    amountCents,
    dueDate: '2026-04-10',
    barcode: '12345678901234567890123456789012345678901234567890',
    filePath: '/tmp/test.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
  };
}

function makeCondoResult(
  providerName: string,
  amountCents: number,
): CondoBoletoResult {
  return {
    type: 'condo-boleto',
    providerName,
    amountCents,
    dueDate: '2026-04-10',
    barcode: '12345678901234567890123456789012345678901234567890',
    filePath: '/tmp/test.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    referenceMonth: '03/2026',
  };
}

function makeCopelResult(
  providerName: string,
  amountCents: number,
): CopelBillResult {
  return {
    type: 'copel-bill',
    providerName,
    amountCents,
    pixCode: '00020126...',
    dueDate: '10/04/2026',
    filePath: '/tmp/test.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
  };
}

function makeErrorResult(message: string): ErrorResult {
  return {
    type: 'error',
    message,
    code: 'TEST_ERROR',
  };
}
