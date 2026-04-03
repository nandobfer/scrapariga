/**
 * copel.provider.ts — Fatura de conta de luz via Copel.
 *
 * URL: https://www.copel.com/avaweb/paginaLogin/login.jsf
 *
 * Flow (inside run()):
 *   doLogin()              → fill CPF, password, click Entrar
 *   navigateToSegundaVia() → click "2ª via de fatura" link
 *   listPendingBills()     → list all pending bills from table
 *   promptBillSelection()  → interactive menu if multiple bills (skip if only 1)
 *   openBillModal()        → click "2 via" link for selected bill
 *   extractBillData()      → extract PIX code, amount, due date from modal + render QR
 *   downloadBillPdf()      → click download button, intercept and save PDF
 *
 * Selectors (confirmed via user input):
 *   #formulario:numDoc                                          → CPF input
 *   #formulario:pass                                            → Password input
 *   #formulario:j_idt41 or button:has-text("Entrar")            → Submit button
 *   a[href*="segundaViaFatura.jsf"]                             → 2ª via link
 *   #formSegundaViaFatura:dtListaSegundaViaFaturaDebitoPendente → Pending bills table
 *   a:has-text("2 via")                                         → Bill detail links
 *   #frmModalSegundaVia:olPixCode                               → PIX code (modal)
 *   #frmModalSegundaVia:j_idt170                                → Amount (modal)
 *   #frmModalSegundaVia:j_idt166                                → Due date (modal)
 *   #frmModalSegundaVia:j_idt154                                → Download button (modal)
 */

import path from 'node:path';
import type { Page } from 'playwright';
import type { Logger } from 'pino';
import terminal from 'terminal-kit';
import qrcode from 'qrcode-terminal';
import { BaseScraper, type BrowserService } from '../base-scraper.js';
import type { EnvCredential, ProgressCallback, ScraperResult } from '../interfaces.js';

const term = terminal.terminal;
const COPEL_URL = 'https://www.copel.com/avaweb/paginaLogin/login.jsf';
const ALLOWED_MIMES = ['application/pdf'];

export class CopelProvider extends BaseScraper {
  readonly name = 'copel';

  readonly requiredCredentials: EnvCredential[] = [
    {
      key: 'COPEL_CPF',
      label: 'CPF',
      description: 'CPF cadastrado no portal da Copel (apenas números)',
      sensitive: false,
    },
    {
      key: 'COPEL_PASSWORD',
      label: 'Senha',
      description: 'Senha de acesso ao portal da Copel',
      sensitive: true,
    },
  ];

  constructor(browserService: BrowserService, logger: Logger) {
    super(browserService, logger);
  }

  // ─── run() ─────────────────────────────────────────────────────────────────

  async run(
    credentials: Record<string, string>,
    onProgress: ProgressCallback,
  ): Promise<ScraperResult> {
    this._progressCallback = onProgress;

    const sessionState = await this.loadSession();
    const page = await this.browserService.newPage(sessionState);

    try {
      await this.retry(
        () => this.doLogin(page, credentials),
        {
          maxAttempts: 2,
          baseDelayMs: 2000,
          onAttempt: (attempt, error) => {
            this.emitStep({
              stepId: 'login',
              label: `Autenticando (tentativa ${attempt}/2)...`,
              status: 'error',
            });
            this.logger.warn({ attempt, err: error.message }, 'doLogin retry');
          },
        },
      );

      await this.debugShot(page, 'logged-in');

      await this.retry(
        () => this.navigateToSegundaVia(page),
        {
          maxAttempts: 2,
          baseDelayMs: 2000,
          onAttempt: (attempt, error) => {
            this.emitStep({
              stepId: 'navigate',
              label: `Navegando (tentativa ${attempt}/2)...`,
              status: 'error',
            });
            this.logger.warn({ attempt, err: error.message }, 'navigateToSegundaVia retry');
          },
        },
      );

      await this.debugShot(page, 'segunda-via-page');

      const bills = await this.listPendingBills(page);

      const selectedIndex = await this.promptBillSelection(bills);

      await this.openBillModal(page, selectedIndex);

      await this.debugShot(page, 'modal-opened');

      const { pixCode, amountCents, dueDate } = await this.extractBillData(page);

      const finalPath = this.buildFilePath('conta-luz-copel', 'pdf');

      const { mimeType, sizeBytes } = await this.retry(
        () => this.downloadBillPdf(page, finalPath),
        {
          maxAttempts: 3,
          baseDelayMs: 2000,
          onAttempt: (attempt, error) => {
            this.emitStep({
              stepId: 'download',
              label: `Baixando PDF (tentativa ${attempt}/3)...`,
              status: 'error',
            });
            this.logger.warn({ attempt, err: error.message }, 'downloadBillPdf retry');
          },
        },
      );

      await this.persistSession(page.context());

      this.emitStep({
        stepId: 'download',
        label: `Fatura salva: ${path.basename(finalPath)}`,
        status: 'success',
      });

      await this.openDocument(finalPath);

      this.emitStep({ stepId: 'complete', label: 'Concluído', status: 'success' });

      return {
        type: 'copel-bill',
        pixCode,
        amountCents,
        dueDate,
        filePath: finalPath,
        mimeType,
        sizeBytes,
      };
    } catch (err) {
      this.logger.error({ err }, 'CopelProvider run() failed');
      return {
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
        cause: err,
      };
    } finally {
      await page.close();
    }
  }

  // ─── Step 1: Login with CPF and password ───────────────────────────────────

  async doLogin(page: Page, credentials: Record<string, string>): Promise<void> {
    this.emitStep({ stepId: 'login', label: 'Abrindo portal da Copel...', status: 'pending' });

    await page.goto(COPEL_URL, { waitUntil: 'networkidle', timeout: 30_000 });

    // Check if already logged in (session restored) — look for "2ª via" link
    const alreadyLoggedIn = await page
      .locator('a[href*="segundaViaFatura"]')
      .isVisible()
      .catch(() => false);

    if (alreadyLoggedIn) {
      this.emitStep({ stepId: 'login', label: 'Sessão restaurada', status: 'success' });
      return;
    }

    this.emitStep({ stepId: 'login', label: 'Preenchendo credenciais...', status: 'pending' });

    const cpf = credentials['COPEL_CPF'] ?? '';
    const password = credentials['COPEL_PASSWORD'] ?? '';

    // Fill CPF
    await page.locator('#formulario\\:numDoc').waitFor({ state: 'visible', timeout: 15_000 });
    await page.locator('#formulario\\:numDoc').fill(cpf);

    // Fill password
    await page.locator('#formulario\\:pass').fill(password);

    this.emitStep({ stepId: 'login', label: 'Enviando formulário...', status: 'pending' });

    // Click submit button — try by ID first, fallback to text
    const submitBtn = page.locator('#formulario\\:j_idt41').or(page.locator('button:has-text("Entrar")'));
    await submitBtn.click();

    // Wait for navigation to complete — look for elements that only appear after login
    await page.waitForSelector('a[href*="segundaViaFatura"]', { timeout: 30_000 });

    this.emitStep({ stepId: 'login', label: 'Autenticado com sucesso', status: 'success' });
  }

  // ─── Step 2: Navigate to "2ª via de fatura" page ──────────────────────────

  async navigateToSegundaVia(page: Page): Promise<void> {
    this.emitStep({ stepId: 'navigate', label: 'Navegando para 2ª via de fatura...', status: 'pending' });

    // Click the "2ª via de fatura" link/image
    const link = page.locator('a[href*="segundaViaFatura"]');
    await link.waitFor({ state: 'visible', timeout: 15_000 });
    await link.click();

    // Wait for the pending bills table to load
    await page.waitForSelector('#formSegundaViaFatura\\:dtListaSegundaViaFaturaDebitoPendente', {
      timeout: 20_000,
    });

    this.emitStep({ stepId: 'navigate', label: 'Página carregada', status: 'success' });
  }

  // ─── Step 3: List all pending bills from table ────────────────────────────

  async listPendingBills(page: Page): Promise<Array<{ index: number; label: string }>> {
    this.emitStep({ stepId: 'list', label: 'Listando faturas pendentes...', status: 'pending' });

    // Find all "2 via" links in the table
    const links = await page.locator('a:has-text("2 via")').all();

    if (links.length === 0) {
      throw new Error('Nenhuma fatura pendente encontrada');
    }

    const bills: Array<{ index: number; label: string }> = [];

    for (let i = 0; i < links.length; i++) {
      // Get the parent row context to extract bill info (date, amount, etc.)
      const row = links[i].locator('xpath=ancestor::tr');
      const rowText = (await row.textContent().catch(() => ''))?.trim() ?? '';

      // Try to extract meaningful info from row text
      // Format will vary, so we'll use the raw text as label
      const label = rowText || `Fatura ${i + 1}`;

      bills.push({ index: i, label });
    }

    this.emitStep({
      stepId: 'list',
      label: `${bills.length} fatura(s) encontrada(s)`,
      status: 'success',
    });

    return bills;
  }

  // ─── Step 4: Interactive menu for bill selection (if multiple) ────────────

  async promptBillSelection(bills: Array<{ index: number; label: string }>): Promise<number> {
    // If only one bill, return immediately
    if (bills.length === 1) {
      return bills[0].index;
    }

    this.emitStep({ stepId: 'select', label: 'Aguardando seleção do usuário...', status: 'pending' });

    term('\n');
    term.bold.white('  Selecione a fatura:\n\n');

    const menuItems = bills.map((bill, idx) => `${idx + 1}  ${bill.label}`);

    return new Promise<number>((resolve) => {
      void term.singleColumnMenu(menuItems, { cancelable: true }, (_err, res) => {
        if (res.canceled) {
          term('\n');
          process.exit(0);
        }
        this.emitStep({ stepId: 'select', label: 'Fatura selecionada', status: 'success' });
        resolve(bills[res.selectedIndex].index);
      });
    });
  }

  // ─── Step 5: Click "2 via" link to open modal ─────────────────────────────

  async openBillModal(page: Page, billIndex: number): Promise<void> {
    this.emitStep({ stepId: 'extract', label: 'Abrindo detalhes da fatura...', status: 'pending' });

    // Click the "2 via" link at the specified index
    const links = await page.locator('a:has-text("2 via")').all();
    if (billIndex >= links.length) {
      throw new Error(`Bill index ${billIndex} out of range (${links.length} bills available)`);
    }

    await links[billIndex].click();

    // Wait for modal to open — wait for PIX code element or download button
    await page.waitForSelector('#frmModalSegundaVia\\:olPixCode, #frmModalSegundaVia\\:j_idt154', {
      timeout: 30_000,
    });

    this.emitStep({ stepId: 'extract', label: 'Modal carregado', status: 'success' });
  }

  // ─── Step 6: Extract PIX code, amount, due date + render QR ───────────────

  async extractBillData(
    page: Page,
  ): Promise<{ pixCode: string; amountCents: number; dueDate: string }> {
    this.emitStep({ stepId: 'extract', label: 'Extraindo dados da fatura...', status: 'pending' });

    // Extract PIX code
    const pixCode = (
      await page
        .locator('#frmModalSegundaVia\\:olPixCode')
        .textContent({ timeout: 10_000 })
        .catch(() => '')
    )?.trim() ?? '';

    if (!pixCode || !pixCode.startsWith('00020126')) {
      throw new Error('Código PIX não encontrado ou inválido no modal');
    }

    // Extract amount
    const amountText = (
      await page
        .locator('#frmModalSegundaVia\\:j_idt170')
        .textContent({ timeout: 5_000 })
        .catch(() => '')
    )?.trim() ?? '';

    // Parse amount: "198,12" → 19812 cents
    const amountMatch = amountText.match(/[\d.]+,\d{2}/);
    const amountCents = amountMatch
      ? Math.round(parseFloat(amountMatch[0].replace(/\./g, '').replace(',', '.')) * 100)
      : 0;

    // Extract due date
    const dueDate = (
      await page
        .locator('#frmModalSegundaVia\\:j_idt166')
        .textContent({ timeout: 5_000 })
        .catch(() => '')
    )?.trim() ?? '';

    this.emitStep({ stepId: 'extract', label: 'Dados extraídos', status: 'success' });

    return { pixCode, amountCents, dueDate };
  }

  // ─── Step 7: Click download button and save PDF ───────────────────────────

  async downloadBillPdf(
    page: Page,
    finalPath: string,
  ): Promise<{ mimeType: string; sizeBytes: number }> {
    this.emitStep({ stepId: 'download', label: 'Iniciando download do PDF...', status: 'pending' });

    // Set up download event listener before clicking
    const downloadPromise = page.waitForEvent('download', { timeout: 45_000 });

    // Click download button
    await page.locator('#frmModalSegundaVia\\:j_idt154').click();

    this.emitStep({ stepId: 'download', label: 'Aguardando download...', status: 'pending' });

    const download = await downloadPromise;

    // Save to temporary path first
    const tmpPath = path.join(process.cwd(), `${this.name}-${Date.now()}.tmp`);
    await download.saveAs(tmpPath);

    // Read file to validate MIME and get size
    const fs = await import('node:fs/promises');
    const buffer = await fs.readFile(tmpPath);

    const { fileTypeFromBuffer } = await import('file-type');
    const detected = await fileTypeFromBuffer(buffer);

    if (!detected || !ALLOWED_MIMES.includes(detected.mime)) {
      await fs.unlink(tmpPath).catch(() => undefined);
      this.logger.warn(
        { tmpPath, detectedMime: detected?.mime ?? 'unknown', ALLOWED_MIMES },
        'Download rejected: invalid MIME type',
      );
      throw new Error(
        `Invalid MIME type: expected one of [${ALLOWED_MIMES.join(', ')}], got ${detected?.mime ?? 'unknown'}`,
      );
    }

    // Move to final path
    await fs.mkdir(path.dirname(finalPath), { recursive: true });

    try {
      await fs.rename(tmpPath, finalPath);
    } catch {
      // Cross-device fallback
      await fs.copyFile(tmpPath, finalPath);
      await fs.unlink(tmpPath).catch(() => undefined);
    }

    const stat = await fs.stat(finalPath);
    this.logger.info({ finalPath, mimeType: detected.mime, sizeBytes: stat.size }, 'File saved');

    this.emitStep({ stepId: 'download', label: 'PDF baixado com sucesso', status: 'success' });

    return { mimeType: detected.mime, sizeBytes: stat.size };
  }
}
