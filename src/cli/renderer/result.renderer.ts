/**
 * result.renderer.ts — Display the final ScraperResult to the user.
 *
 * FileResult:    ✅ path in green
 * PaymentResult: formatted amount + PIX code box + QR code
 * ErrorResult:   ❌ message in red
 *
 * After rendering, waits for any keypress before returning (FR — return to menu).
 */

import qrcode from 'qrcode-terminal';
import terminal from 'terminal-kit';
import type { ScraperResult } from '../../providers/interfaces.js';

const term = terminal.terminal;

export class ResultRenderer {
  async render(result: ScraperResult): Promise<void> {
    term('\n');

    switch (result.type) {
      case 'file':
        term.green(`✅ Arquivo salvo:\n`);
        term.green(`   ${result.filePath}\n`);
        term.gray(`   Tipo: ${result.mimeType} — ${result.sizeBytes.toLocaleString('pt-BR')} bytes\n`);
        break;

      case 'payment': {
        const reais = (result.amountCents / 100).toLocaleString('pt-BR', {
          style: 'currency',
          currency: 'BRL',
        });
        term.cyan(`💰 Pagamento PIX\n`);
        term.white(`   Valor: `);
        term.bold.yellow(`${reais}\n`);
        if (result.dueDate) {
          term.white(`   Vencimento: ${result.dueDate}\n`);
        }
        term.white(`\n   Código PIX:\n`);
        term.gray(`   ┌${'─'.repeat(62)}┐\n`);
        // Wrap code in 60-char blocks
        const code = result.pixCode;
        for (let i = 0; i < code.length; i += 60) {
          term.gray(`   │ `);
          term.white(code.slice(i, i + 60).padEnd(60));
          term.gray(` │\n`);
        }
        term.gray(`   └${'─'.repeat(62)}┘\n\n`);
        term.white('   QR Code:\n');
        qrcode.generate(result.pixQrData, { small: true });
        term('\n');
        break;
      }

      case 'boleto': {
        const reais = (result.amountCents / 100).toLocaleString('pt-BR', {
          style: 'currency',
          currency: 'BRL',
        });
        term.cyan(`🏠 Boleto de Aluguel\n`);
        term.white(`   Vencimento: `);
        term.bold.white(`${result.dueDate}\n`);
        term.white(`   Valor: `);
        term.bold.yellow(`${reais}\n`);
        term.white(`\n   Linha Digitável:\n`);
        const code = result.boletoCode;
        term.gray(`   ┌${'─'.repeat(62)}┐\n`);
        for (let i = 0; i < code.length; i += 60) {
          term.gray(`   │ `);
          term.white(code.slice(i, i + 60).padEnd(60));
          term.gray(` │\n`);
        }
        term.gray(`   └${'─'.repeat(62)}┘\n\n`);
        term.green(`   📄 PDF: ${result.filePath}\n`);
        term.gray(`   Tipo: ${result.mimeType} — ${result.sizeBytes.toLocaleString('pt-BR')} bytes\n`);
        break;
      }

      case 'error':
        term.red(`❌ Erro: ${result.message}\n`);
        break;
    }

    term.gray('\n  Pressione qualquer tecla para continuar...');
    await new Promise<void>((resolve) => {
      term.once('key', () => resolve());
    });
    term('\n\n');
  }
}
