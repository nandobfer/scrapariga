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
 *   readBoletoData()    → capture linha digitável via dialog, read value + due date
 *   fetchPdf()          → click "Imprimir boleto", wait for link, download PDF
 *
 * Selectors (confirmed via browser DevTools on anticoimoveis.com.br):
 *   #dropdownMenuButton                          → AÇÕES dropdown toggle
 *   .ld                                          → Copiar linha digitável
 *   [grid-data-action="print"]                   → Imprimir boleto
 *   #downloadfile                                → Download link popover
 *   .table tbody tr:first-child td               → Table row cells
 */

import path from 'node:path';
import type { Page } from 'playwright';
import type { Logger } from 'pino';
import { BaseScraper, type BrowserService } from '../base-scraper.js';
import type { EnvCredential, ProgressCallback, ScraperResult } from '../interfaces.js';

const BASE_URL = 'https://anticoimoveis.com.br/cobrancas';
const EXPECTED_CONTRACT = '1230103';
const MAX_PID_PROBE = 6;
const ALLOWED_MIMES = ['application/pdf'];

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
      const pid = await this.retry(
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

      const { boletoCode, amountCents, dueDate } = await this.retry(
        () => this.readBoletoData(page),
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
        () => this.fetchPdf(page, finalPath),
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

  async readBoletoData(page: Page): Promise<{ boletoCode: string; amountCents: number; dueDate: string }> {
    this.emitStep({ stepId: 'fetch', label: 'Lendo dados do boleto...', status: 'pending' });

    // Register BEFORE any await — guarantee the listener is in place before
    // the button click triggers window.alert synchronously.
    const barcodeCapture = new Promise<string>((resolve) => {
      page.once('dialog', async (dialog) => {
        const msg = dialog.message();
        await dialog.accept();
        // Message format: "Linha digitável copiada: 34191095030050798383..."
        const afterColon = msg.split('copiada:')[1]?.trim() ?? msg.trim();
        resolve(afterColon);
      });
    });

    const row = page.locator('.table tbody tr').first();
    const rowText = await row.textContent({ timeout: 10_000 }).catch(() => '');

    const dateMatch = rowText?.match(/\d{2}-\d{2}-\d{4}/);
    const dueDate = dateMatch?.[0] ?? '';

    const valueMatches = rowText?.match(/\d{1,3}(?:\.\d{3})*,\d{2}/g) ?? [];
    const parsedValues = valueMatches
      .map((v) => parseFloat(v.replace(/\./g, '').replace(',', '.')))
      .filter((v) => v > 0);
    const amountCents = parsedValues.length > 0 ? Math.round(Math.max(...parsedValues) * 100) : 0;

    await page.locator('#dropdownMenuButton').click();
    await page.waitForSelector('.dropdown-menu .ld', { state: 'visible', timeout: 5_000 });
    await page.locator('.ld').first().click();

    const boletoCode = await barcodeCapture;

    this.emitStep({ stepId: 'fetch', label: 'Dados do boleto obtidos', status: 'success' });

    return { boletoCode, amountCents, dueDate };
  }

  // ─── Step 3: Click "Imprimir boleto", download PDF ────────────────────────

  async fetchPdf(page: Page, finalPath: string): Promise<{ mimeType: string; sizeBytes: number }> {
    this.emitStep({ stepId: 'download', label: 'Gerando boleto para download...', status: 'pending' });

    await page.locator('#dropdownMenuButton').click();
    await page.waitForSelector('.dropdown-menu [grid-data-action="print"]', {
      state: 'visible',
      timeout: 5_000,
    });
    await page.locator('[grid-data-action="print"]').click();

    this.emitStep({ stepId: 'download', label: 'Aguardando link do boleto...', status: 'pending' });

    // On retries the old link may still be in the DOM — use .last() to always
    // pick the most recently generated one.
    await page.waitForSelector('#downloadfile', { state: 'visible', timeout: 45_000 });
    const href = await page.locator('#downloadfile').last().getAttribute('href');
    if (!href) throw new Error('Link de download do boleto não encontrado no popover');

    await this.debugShot(page, 'download-link-ready');

    this.emitStep({ stepId: 'download', label: 'Baixando PDF...', status: 'pending' });

    return this.downloadFile(href, finalPath, ALLOWED_MIMES);
  }
}

