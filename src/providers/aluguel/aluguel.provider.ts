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
 * Flow:
 *   login()          → compute base PID, probe until unpaid boleto found
 *   fetchDocuments() → capture barcode via dialog, read value + due date
 *   download()       → click "Imprimir boleto", wait for link, download PDF
 *
 * Selectors (confirmed via browser DevTools on anticoimoveis.com.br):
 *   #dropdownMenuButton                          → AÇÕES dropdown toggle
 *   .ld                                          → Copiar linha digitável
 *   [grid-data-action="print"]                   → Imprimir boleto
 *   #downloadfile                                → Download link popover
 *   .table tbody tr:first-child td               → Table row cells
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { spawn, execFile } from 'node:child_process';
import axios from 'axios';
import type { Page } from 'playwright';
import type { Logger } from 'pino';
import { BaseScraper, type BrowserService } from '../base-scraper.js';
import type { DocumentMetadata, EnvCredential, ScraperResult } from '../interfaces.js';

const BASE_URL = 'https://anticoimoveis.com.br/cobrancas';
const EXPECTED_CONTRACT = '1230103';
const MAX_PID_PROBE = 6;
const ALLOWED_MIMES = ['application/pdf'];

// Reference anchor — both known PIDs must satisfy: REFERENCE_PID + offset == pid for that month.
// PID 34849 == March 2026 == offset 0 from March 2026; equivalently:
// PID 34850 == April 2026 == offset 0 from April 2026 (same formula, different origin)
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

  // Instance state populated by fetchDocuments() and consumed by download()
  private _boletoCode = '';
  private _amountCents = 0;
  private _dueDate = '';

  constructor(browserService: BrowserService, logger: Logger) {
    super(browserService, logger);
  }

  // ─── Step 1: Compute base PID from date, probe until unpaid boleto found ──

  async login(page: Page, _credentials: Record<string, string>): Promise<void> {
    this.emitStep({ stepId: 'login', label: 'Procurando boleto pendente...', status: 'pending' });

    const now = new Date();
    // The due date is the 10th of the current month; if today is past the 10th
    // the boleto is likely already paid — start one month ahead to save probes.
    const startMonth = now.getDate() > 10 ? now.getMonth() + 2 : now.getMonth() + 1;
    const startYear = now.getFullYear() + Math.floor((startMonth - 1) / 12);
    const normalizedMonth = ((startMonth - 1) % 12) + 1;
    const basePid = pidForMonth(startYear, normalizedMonth);

    this.logger.info({ basePid, startYear, normalizedMonth }, 'Computed base PID');

    const resolvedPid = await this.probePid(page, basePid);

    this.emitStep({
      stepId: 'login',
      label: `Boleto encontrado (PID ${resolvedPid})`,
      status: 'success',
    });
  }

  private async probePid(page: Page, startPid: number): Promise<number> {
    for (let candidate = startPid; candidate <= startPid + MAX_PID_PROBE; candidate++) {
      this.emitStep({
        stepId: 'login',
        label: `Verificando PID ${candidate}...`,
        status: 'pending',
      });

      const pid = Buffer.from(String(candidate)).toString('base64');
      const url = `${BASE_URL}?pid=${pid}`;

      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 15_000 });
      } catch {
        this.logger.warn({ candidate }, 'PID navigation failed; trying next');
        continue;
      }

      // A valid boleto page has the AÇÕES dropdown button in a table
      const isVisible = await page.locator('#dropdownMenuButton').isVisible().catch(() => false);
      if (!isVisible) continue;

      const row = page.locator('.table tbody tr').first();
      const rowText = await row.textContent({ timeout: 5_000 }).catch(() => '');
      if (!rowText) continue;

      // Validate this boleto belongs to the expected contract
      if (!rowText.includes(EXPECTED_CONTRACT)) {
        this.emitStep({
          stepId: 'login',
          label: `PID ${candidate}: contrato diferente, ignorando`,
          status: 'warning',
        });
        continue;
      }

      // Check if boleto is unpaid: "Valor pago" (last td) must be "0,00"
      const tds = await row.locator('td').all();
      if (tds.length === 0) continue;
      const lastCell = (await tds[tds.length - 1].textContent().catch(() => ''))?.trim() ?? '';
      if (lastCell !== '0,00') {
        this.emitStep({
          stepId: 'login',
          label: `PID ${candidate}: já pago, tentando próximo...`,
          status: 'pending',
        });
        continue;
      }

      return candidate;
    }

    throw new Error(
      `Nenhum boleto pendente encontrado após verificar ${MAX_PID_PROBE} PIDs a partir de ${startPid}. ` +
        'Verifique se há boleto em aberto no anticoimoveis.com.br',
    );
  }

  // ─── Step 2: Capture barcode via dialog, read value + due date ───────────

  async fetchDocuments(page: Page): Promise<DocumentMetadata[]> {
    this.emitStep({ stepId: 'fetch', label: 'Lendo dados do boleto...', status: 'pending' });

    // Register BEFORE any await — guarantee the listener is in place before
    // the button click below triggers window.alert synchronously.
    const barcodeCapture = new Promise<string>((resolve) => {
      page.once('dialog', async (dialog) => {
        const msg = dialog.message();
        await dialog.accept();
        // Message format: "Linha digitável copiada: 34191095030050798383..."
        const afterColon = msg.split('copiada:')[1]?.trim() ?? msg.trim();
        resolve(afterColon);
      });
    });

    // Read due date and total value from the main table row
    const row = page.locator('.table tbody tr').first();
    const rowText = await row.textContent({ timeout: 10_000 }).catch(() => '');

    // Parse due date: first DD-MM-YYYY occurrence in the row
    const dateMatch = rowText?.match(/\d{2}-\d{2}-\d{4}/);
    this._dueDate = dateMatch?.[0] ?? '';

    // Parse total value: largest Brazilian-format currency value in the row.
    // "Valor pago" is 0,00 for unpaid boletos, so the total will be the max.
    const valueMatches = rowText?.match(/\d{1,3}(?:\.\d{3})*,\d{2}/g) ?? [];
    const parsedValues = valueMatches
      .map((v) => parseFloat(v.replace(/\./g, '').replace(',', '.')))
      .filter((v) => v > 0);
    this._amountCents = parsedValues.length > 0 ? Math.round(Math.max(...parsedValues) * 100) : 0;

    // Open dropdown
    await page.locator('#dropdownMenuButton').click();
    await page.waitForSelector('.dropdown-menu .ld', { state: 'visible', timeout: 5_000 });

    // Click "Copiar linha digitável" — triggers window.alert
    await page.locator('.ld').first().click();

    this._boletoCode = await barcodeCapture;

    this.emitStep({ stepId: 'fetch', label: 'Dados do boleto obtidos', status: 'success' });

    return [{ id: 'boleto', name: 'boleto-aluguel', mimeHint: 'application/pdf' }];
  }

  // ─── Step 3: Click "Imprimir boleto", wait for link, download PDF ─────────

  async download(page: Page, _doc: DocumentMetadata): Promise<ScraperResult> {
    this.emitStep({
      stepId: 'download',
      label: 'Gerando boleto para download...',
      status: 'pending',
    });

    // Re-open dropdown (it may have closed after previous interaction)
    await page.locator('#dropdownMenuButton').click();
    await page.waitForSelector('.dropdown-menu [grid-data-action="print"]', {
      state: 'visible',
      timeout: 5_000,
    });

    // Click "Imprimir boleto" — triggers async PDF generation on the server
    await page.locator('[grid-data-action="print"]').click();

    this.emitStep({
      stepId: 'download',
      label: 'Aguardando link do boleto...',
      status: 'pending',
    });

    // The server generates the PDF and then shows a popover with #downloadfile.
    // On retries the old link may still be in the DOM — use .last() to always
    // pick the most recently generated one.
    await page.waitForSelector('#downloadfile', { state: 'visible', timeout: 45_000 });

    const href = await page.locator('#downloadfile').last().getAttribute('href');
    if (!href) throw new Error('Link de download do boleto não encontrado no popover');

    this.emitStep({ stepId: 'download', label: 'Baixando PDF...', status: 'pending' });

    // Download the PDF via HTTP (axios with arraybuffer response)
    const response = await axios.get<ArrayBuffer>(href, {
      responseType: 'arraybuffer',
      timeout: 30_000,
    });
    const pdfBuffer = Buffer.from(response.data);

    // Write to tmp path → validate MIME → move to canonical documents path
    const tmpPath = path.join(process.cwd(), `aluguel-${Date.now()}.tmp`);
    await fs.writeFile(tmpPath, pdfBuffer);

    await this.validateDownload(tmpPath, ALLOWED_MIMES);

    const finalPath = this.buildFilePath('boleto-aluguel', 'pdf');
    await fs.mkdir(path.dirname(finalPath), { recursive: true });

    try {
      await fs.rename(tmpPath, finalPath);
    } catch {
      // Cross-device move fallback (tmp on different partition)
      await fs.copyFile(tmpPath, finalPath);
      await fs.unlink(tmpPath).catch(() => undefined);
    }

    const stat = await fs.stat(finalPath);

    // Convert WSL path to Windows path before handing off to explorer.exe
    const winPath = await new Promise<string>((resolve) => {
      execFile('wslpath', ['-w', finalPath], (_err, stdout) => resolve(stdout.trim()));
    });
    spawn('explorer.exe', [winPath], { detached: true, stdio: 'ignore' }).unref();

    this.emitStep({
      stepId: 'download',
      label: `Boleto salvo: ${path.basename(finalPath)}`,
      status: 'success',
    });

    return {
      type: 'boleto',
      boletoCode: this._boletoCode,
      amountCents: this._amountCents,
      dueDate: this._dueDate,
      filePath: finalPath,
      mimeType: 'application/pdf',
      sizeBytes: stat.size,
    };
  }
}
