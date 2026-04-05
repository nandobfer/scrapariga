/**
 * cnd.provider.ts — Certidão Negativa de Débitos (Receita Federal).
 *
 * URL: https://servicos.receitafederal.gov.br/servico/certidoes/#/home/cnpj
 *
 * NOTA: O download automático não é possível pois o site utiliza CAPTCHA que
 * não pode ser bypassado. Este provider imprime o link e o CNPJ no terminal
 * para que o usuário acesse manualmente.
 */

import type { Logger } from 'pino';
import { BaseScraper, type BrowserService } from '../base-scraper.js';
import type { EnvCredential, ManualResult, ProgressCallback, ScraperResult } from '../interfaces.js';

const CND_URL = 'https://servicos.receitafederal.gov.br/servico/certidoes/#/home/cnpj';

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

  async run(
    credentials: Record<string, string>,
    onProgress: ProgressCallback,
  ): Promise<ScraperResult> {
    this._progressCallback = onProgress;

    const cnpj = formatCnpj(credentials['CNPJ'] ?? '');

    this.emitStep({ stepId: 'manual', label: 'Acesse o link abaixo para baixar a certidão', status: 'warning' });

    const result: ManualResult = {
      type: 'manual',
      message: `Acesse o link abaixo, preencha o CNPJ (${cnpj}), resolva o CAPTCHA e clique em "Consultar Certidão". Em seguida clique em "Segunda via" para baixar o PDF.`,
      url: CND_URL,
    };

    return result;
  }
}

