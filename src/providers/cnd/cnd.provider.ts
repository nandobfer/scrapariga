/**
 * cnd.provider.ts — Certidão Negativa de Débitos (Receita Federal).
 *
 * URL: https://servicos.receitafederal.gov.br/servico/certidoes/#/home/cnpj
 *
 * NOTA: O download automático não é possível pois o site utiliza CAPTCHA que
 * não pode ser bypassado. Este provider imprime o link e o CNPJ no terminal
 * para que o usuário acesse manualmente.
 */

import { spawn } from 'node:child_process';
import type { Logger } from 'pino';
import { BaseScraper, type BrowserService } from '../base-scraper.js';
import type { EnvCredential, ManualResult, ProgressCallback, ScraperResult } from '../interfaces.js';

const CND_URL = 'https://servicos.receitafederal.gov.br/servico/certidoes/#/home/cnpj';

interface ClipboardCommand {
  bin: string;
  args: string[];
}

interface ClipboardResult {
  copied: boolean;
  method?: string;
}

function formatCnpj(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 14) {
    return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  }
  return raw;
}

export class CndProvider extends BaseScraper {
  readonly name = 'cnd';

  readonly requiredCredentials: EnvCredential[] = [
    {
      key: 'CNPJ',
      label: 'CNPJ da empresa',
      description: 'Informe com ou sem máscara (ex: 12.345.678/0001-95 ou 12345678000195)',
      sensitive: false,
    },
  ];

  constructor(browserService: BrowserService, logger: Logger) {
    super(browserService, logger);
  }

  protected async copyTextToClipboard(text: string): Promise<ClipboardResult> {
    for (const command of this.getClipboardCommands()) {
      const copied = await this.tryClipboardCommand(command, text);
      if (copied) {
        this.logger.info({ clipboard: command.bin }, 'CNPJ copied to clipboard');
        return { copied: true, method: command.bin };
      }
    }

    this.logger.warn('No supported clipboard command available for CND provider');
    return { copied: false };
  }

  async run(
    credentials: Record<string, string>,
    onProgress: ProgressCallback,
  ): Promise<ScraperResult> {
    this._progressCallback = onProgress;

    const cnpj = formatCnpj(credentials['CNPJ'] ?? '');
    const clipboard = await this.copyTextToClipboard(cnpj);

    this.emitStep({ stepId: 'manual', label: 'Acesse o link abaixo para baixar a certidão', status: 'warning' });

    const clipboardMessage = clipboard.copied
      ? 'O CNPJ foi copiado para a sua area de transferencia.'
      : `Nao foi possivel copiar o CNPJ automaticamente. Use este valor: ${cnpj}.`;

    const result: ManualResult = {
      type: 'manual',
      message:
        `${clipboardMessage} ` +
        `Acesse o link abaixo, preencha o CNPJ (${cnpj}), resolva o CAPTCHA e clique em "Consultar Certidão". ` +
        'Em seguida clique em "Segunda via" para baixar o PDF.',
      url: CND_URL,
    };

    return result;
  }

  private getClipboardCommands(): ClipboardCommand[] {
    if (process.platform === 'darwin') {
      return [{ bin: 'pbcopy', args: [] }];
    }

    return [
      { bin: 'wl-copy', args: [] },
      { bin: 'xclip', args: ['-selection', 'clipboard'] },
      { bin: 'xsel', args: ['--clipboard', '--input'] },
      { bin: 'pbcopy', args: [] },
    ];
  }

  private async tryClipboardCommand(command: ClipboardCommand, text: string): Promise<boolean> {
    return await new Promise<boolean>((resolve) => {
      const child = spawn(command.bin, command.args, {
        stdio: ['pipe', 'ignore', 'ignore'],
      });

      child.once('error', () => resolve(false));
      child.once('close', (code) => resolve(code === 0));

      child.stdin.on('error', () => resolve(false));
      child.stdin.end(text);
    });
  }
}
