/**
 * aluguel.provider.ts — Boleto de aluguel via anticoimoveis.com.br.
 *
 * URL: https://anticoimoveis.com.br/cobrancas?pid=<base64(numericId)>
 *
 * PIDs are sequential integers encoded as Base64. Two known reference points
 * anchor the calculation; the current month's PID is derived from them:
 *
 *   PID 34849 → vencimento 10/03/2026  (março 2026)
 *   PID 34850 → vencimento 10/04/2026  (abril 2026)
 *
 * Formula: basePid = REFERENCE_PID + monthsElapsed(REFERENCE_YEAR, REFERENCE_MONTH)
 * No credentials required — the PID is computed automatically from the current date.
 *
 * Flow (inside run()):
 *   findPendingBoleto() → probe PIDs until unpaid boleto found
 *   readBoletoData()    → POST finangerarcobrancas.imprimir → linha digitável, valor, vencimento, PDF URL
 *   fetchPdf()          → download the PDF fileurl returned by the portal
 *
 * Endpoints / selectors (confirmed via browser DevTools on anticoimoveis.com.br):
 *   #dropdownMenuButton                                       → AÇÕES dropdown toggle (existence check)
 *   input[name="parcela_id"] (hidden row input)               → boleto/parcela id (== PID)
 *   POST task=finangerarcobrancas.imprimir (cid[]=<parcela>)  → boleto JSON (linha_digitavel, fileurl, …)
 *   .table tbody tr td                                        → Table row cells
 */

import path from 'node:path';
import type { Page } from 'playwright';
import type { Logger } from 'pino';
import { BaseScraper, type BrowserService } from '../base-scraper.js';
import type { EnvCredential, ProgressCallback, ScraperResult } from '../interfaces.js';

const BASE_URL = 'https://anticoimoveis.com.br/cobrancas';
const IMPRIMIR_URL =
  'https://anticoimoveis.com.br/index.php?option=com_widesys&task=finangerarcobrancas.imprimir&format=raw&tmpl=component';
const EXPECTED_CONTRACT = '1230103';
const MAX_PID_PROBE = 6;
const ALLOWED_MIMES = ['application/pdf'];

/** Subset of the `finangerarcobrancas.imprimir` JSON response we rely on. */
interface BoletoResponse {
  success?: boolean;
  data?: Array<{
    linha_digitavel?: string;
    valor_boleto?: string;
    valor_desconto?: string;
    aplicar_descontos?: boolean;
    data_vencimento?: string;
    fileurl?: string;
  }>;
}

/**
 * Parse a money string from the portal to cents. The portal mixes formats:
 * `valor_boleto` is pt-BR ("3.132,56") while `valor_desconto` is en-US ("562.50").
 */
function parseMoneyToCents(value: string | undefined): number {
  if (!value) return 0;
  const raw = value.trim();
  const normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
  const parsed = parseFloat(normalized);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

// Reference anchor — both known PIDs must satisfy: REFERENCE_PID + offset == pid for that month.
const REFERENCE_PID = 34849;    // boleto para março 2026
const REFERENCE_YEAR = 2026;
const REFERENCE_MONTH = 3;       // março (1-based)

/**
 * Derive the expected PID for a given year/month based on our reference points.
 * PIDs increment by 1 per month sequentially.
 */
function pidForMonth(year: number, month: number): number {
  const offset = (year - REFERENCE_YEAR) * 12 + (month - REFERENCE_MONTH);
  return REFERENCE_PID + offset;
}

export class AluguelProvider extends BaseScraper {
  readonly name = 'aluguel';

  readonly requiredCredentials: EnvCredential[] = [];

  constructor(browserService: BrowserService, logger: Logger) {
    super(browserService, logger);
  }

  // ─── run() ────────────────────────────────────────────────────────────────

  async run(
    _credentials: Record<string, string>,
    onProgress: ProgressCallback,
  ): Promise<ScraperResult> {
    this._progressCallback = onProgress;

    const sessionState = await this.loadSession();
    const page = await this.browserService.newPage(sessionState);

    try {
      const parcela = await this.retry(
        () => this.findPendingBoleto(page),
        {
          maxAttempts: 2,
          baseDelayMs: 2000,
          onAttempt: (attempt, error) => {
            this.emitStep({ stepId: 'login', label: `Procurando boleto (tentativa ${attempt}/2)...`, status: 'error' });
            this.logger.warn({ attempt, err: error.message }, 'findPendingBoleto retry');
          },
        },
      );

      await this.debugShot(page, 'boleto-found');

      const { boletoCode, amountCents, dueDate, fileUrl } = await this.retry(
        () => this.readBoletoData(page, parcela),
        {
          maxAttempts: 2,
          baseDelayMs: 1000,
          onAttempt: (attempt, error) => {
            this.emitStep({ stepId: 'fetch', label: `Relendo dados (tentativa ${attempt}/2)...`, status: 'error' });
            this.logger.warn({ attempt, err: error.message }, 'readBoletoData retry');
          },
        },
      );

      const finalPath = this.buildFilePath('boleto-aluguel', 'pdf');

      const { mimeType, sizeBytes } = await this.retry(
        () => this.fetchPdf(fileUrl, finalPath),
        {
          maxAttempts: 3,
          baseDelayMs: 2000,
          onAttempt: (attempt, error) => {
            this.emitStep({ stepId: 'download', label: `Baixando boleto (tentativa ${attempt}/3)...`, status: 'error' });
            this.logger.warn({ attempt, err: error.message }, 'fetchPdf retry');
          },
        },
      );

      await this.persistSession(page.context());

      this.emitStep({
        stepId: 'download',
        label: `Boleto salvo: ${path.basename(finalPath)}`,
        status: 'success',
      });

      await this.openDocument(finalPath);

      this.emitStep({ stepId: 'complete', label: 'Concluído', status: 'success' });

      return {
        type: 'boleto',
        boletoCode,
        amountCents,
        dueDate,
        filePath: finalPath,
        mimeType,
        sizeBytes,
      };
    } catch (err) {
      this.logger.error({ err }, 'AluguelProvider run() failed');
      return {
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
        cause: err,
      };
    } finally {
      await page.close();
    }
  }

  // ─── Step 1: Probe PIDs until an unpaid boleto for our contract is found ──

  async findPendingBoleto(page: Page): Promise<number> {
    this.emitStep({ stepId: 'login', label: 'Procurando boleto pendente...', status: 'pending' });

    const now = new Date();
    // The due date is the 10th of each month; if today is past the 10th the
    // boleto is likely already paid — start one month ahead.
    const startMonth = now.getDate() > 10 ? now.getMonth() + 2 : now.getMonth() + 1;
    const startYear = now.getFullYear() + Math.floor((startMonth - 1) / 12);
    const normalizedMonth = ((startMonth - 1) % 12) + 1;
    const basePid = pidForMonth(startYear, normalizedMonth);

    this.logger.info({ basePid, startYear, normalizedMonth }, 'Computed base PID');

    for (let candidate = basePid; candidate <= basePid + MAX_PID_PROBE; candidate++) {
      this.emitStep({ stepId: 'login', label: `Verificando PID ${candidate}...`, status: 'pending' });

      const pid = Buffer.from(String(candidate)).toString('base64');
      const url = `${BASE_URL}?pid=${pid}`;

      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 15_000 });
      } catch {
        this.logger.warn({ candidate }, 'PID navigation failed; trying next');
        continue;
      }

      const isVisible = await page.locator('#dropdownMenuButton').isVisible().catch(() => false);
      if (!isVisible) continue;

      const row = page.locator('.table tbody tr').first();
      const rowText = await row.textContent({ timeout: 5_000 }).catch(() => '');
      if (!rowText) continue;

      if (!rowText.includes(EXPECTED_CONTRACT)) {
        this.emitStep({ stepId: 'login', label: `PID ${candidate}: contrato diferente, ignorando`, status: 'warning' });
        continue;
      }

      const tds = await row.locator('td').all();
      if (tds.length === 0) continue;
      const lastCell = (await tds[tds.length - 1].textContent().catch(() => ''))?.trim() ?? '';
      if (lastCell !== '0,00') {
        this.emitStep({ stepId: 'login', label: `PID ${candidate}: já pago, tentando próximo...`, status: 'pending' });
        continue;
      }

      this.emitStep({ stepId: 'login', label: `Boleto encontrado (PID ${candidate})`, status: 'success' });
      return candidate;
    }

    throw new Error(
      `Nenhum boleto pendente encontrado após verificar ${MAX_PID_PROBE} PIDs a partir de ${basePid}. ` +
        'Verifique se há boleto em aberto no anticoimoveis.com.br',
    );
  }

  // ─── Step 2: Read boleto data (linha digitável, value, due date) ──────────

  async readBoletoData(
    page: Page,
    parcela: number,
  ): Promise<{ boletoCode: string; amountCents: number; dueDate: string; fileUrl: string }> {
    this.emitStep({ stepId: 'fetch', label: 'Lendo dados do boleto...', status: 'pending' });

    // The AÇÕES dropdown no longer exposes a "copiar linha digitável" item, so
    // the boleto is generated through the portal's own AJAX call
    // (cid[]=<parcela>). page.request shares the page context's session cookies.
    const response = await page.request.post(IMPRIMIR_URL, {
      form: { 'cid[]': String(parcela) },
    });
    const json = (await response.json()) as BoletoResponse;
    const data = json.data?.[0];

    if (!json.success || !data) {
      throw new Error('Falha ao gerar o boleto no portal (resposta sem sucesso)');
    }
    if (!data.fileurl) {
      throw new Error('URL do PDF do boleto não retornada pelo portal');
    }

    // Face value minus the early-payment discount (when the portal applies it).
    // valor_boleto "3132,56" (pt-BR) vs valor_desconto "562.50" (en-US).
    const grossCents = parseMoneyToCents(data.valor_boleto);
    const discountCents = data.aplicar_descontos ? parseMoneyToCents(data.valor_desconto) : 0;
    const amountCents = grossCents - discountCents;

    this.logger.info(
      { grossCents, discountCents, amountCents, aplicarDescontos: data.aplicar_descontos },
      'Aluguel amount computed',
    );

    this.emitStep({ stepId: 'fetch', label: 'Dados do boleto obtidos', status: 'success' });

    return {
      boletoCode: (data.linha_digitavel ?? '').trim(),
      amountCents,
      // Portal returns DD/MM/YYYY; the BoletoResult contract uses DD-MM-YYYY.
      dueDate: (data.data_vencimento ?? '').trim().replace(/\//g, '-'),
      fileUrl: data.fileurl,
    };
  }

  // ─── Step 3: Click "Imprimir boleto", download PDF ────────────────────────

  async fetchPdf(fileUrl: string, finalPath: string): Promise<{ mimeType: string; sizeBytes: number }> {
    this.emitStep({ stepId: 'download', label: 'Baixando boleto...', status: 'pending' });
    return this.downloadFile(fileUrl, finalPath, ALLOWED_MIMES);
  }
}

