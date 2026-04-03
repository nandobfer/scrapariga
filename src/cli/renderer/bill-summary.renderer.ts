/**
 * bill-summary.renderer.ts — Financial summary for multiple bill results.
 *
 * Aggregates amounts from successful bill results, calculates totals,
 * and renders a formatted table with per-person split.
 */

import terminal from 'terminal-kit';
import type { ScraperResult } from '../../providers/interfaces.js';

const term = terminal.terminal;

interface BillItem {
  name: string;
  displayName: string;
  icon: string;
  amountCents: number;
}

const PROVIDER_METADATA: Record<string, { displayName: string; icon: string }> = {
  copel: { displayName: 'Conta de Luz (Copel)', icon: '⚡' },
  aluguel: { displayName: 'Aluguel', icon: '🏠' },
  condominio: { displayName: 'Condomínio', icon: '🏢' },
};

export class BillSummaryRenderer {
  /**
   * Extract bill items from results.
   */
  private extractBills(results: ScraperResult[]): BillItem[] {
    const bills: BillItem[] = [];

    for (const result of results) {
      let name: string | undefined;
      let amountCents: number | undefined;

      switch (result.type) {
        case 'boleto':
          name = 'aluguel';
          amountCents = result.amountCents;
          break;
        case 'condo-boleto':
          name = 'condominio';
          amountCents = result.amountCents;
          break;
        case 'copel-bill':
          name = 'copel';
          amountCents = result.amountCents;
          break;
        default:
          continue;
      }

      if (name && amountCents !== undefined) {
        const metadata = PROVIDER_METADATA[name] ?? { displayName: name, icon: '📄' };
        bills.push({
          name,
          displayName: metadata.displayName,
          icon: metadata.icon,
          amountCents,
        });
      }
    }

    return bills;
  }

  /**
   * Format cents to Brazilian Real currency string.
   */
  private formatCurrency(cents: number): string {
    return (cents / 100).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    });
  }

  /**
   * Render financial summary table.
   */
  render(results: ScraperResult[], splitPeople: number): void {
    const bills = this.extractBills(results);

    if (bills.length === 0) {
      term.yellow('\n  ⚠️  Nenhuma conta com valor foi encontrada.\n\n');
      return;
    }

    const total = bills.reduce((sum, b) => sum + b.amountCents, 0);
    const perPerson = Math.round(total / splitPeople);

    term('\n');
    term.bold.cyan('  💰 Resumo Financeiro\n');
    term.gray('  ┌' + '─'.repeat(58) + '┐\n');

    // Individual bills
    for (const bill of bills) {
      const amount = this.formatCurrency(bill.amountCents);
      const label = `${bill.icon} ${bill.displayName}`;
      const padding = 40 - label.length;
      term.gray('  │ ');
      term.white(label);
      term(' '.repeat(padding > 0 ? padding : 1));
      term.bold.yellow(amount.padStart(16));
      term.gray(' │\n');
    }

    // Separator
    term.gray('  ├' + '─'.repeat(58) + '┤\n');

    // Total
    const totalAmount = this.formatCurrency(total);
    const totalLabel = 'TOTAL';
    const totalPadding = 40 - totalLabel.length;
    term.gray('  │ ');
    term.bold.white(totalLabel);
    term(' '.repeat(totalPadding > 0 ? totalPadding : 1));
    term.bold.green(totalAmount.padStart(16));
    term.gray(' │\n');

    // Per person (only if > 1 person)
    if (splitPeople > 1) {
      term.gray('  │' + ' '.repeat(58) + '│\n');
      const perPersonAmount = this.formatCurrency(perPerson);
      const perPersonLabel = `Dividido por ${splitPeople} pessoa${splitPeople > 1 ? 's' : ''}:`;
      const perPersonPadding = 40 - perPersonLabel.length;
      term.gray('  │ ');
      term.italic.white(perPersonLabel);
      term(' '.repeat(perPersonPadding > 0 ? perPersonPadding : 1));
      term.bold.cyan(perPersonAmount.padStart(16));
      term.gray(' │\n');
    }

    term.gray('  └' + '─'.repeat(58) + '┘\n');
    term('\n');
  }
}
