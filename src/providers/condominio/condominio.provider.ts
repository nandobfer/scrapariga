/**
 * condominio.provider.ts — Boleto de condomínio via Superlogica (officeadm).
 *
 * URL: https://officeadm.superlogica.net/clients/areadocondomino
 *
 * Flow (inside run()):
 *   doLogin()            → fill email, click "Entrar Agora", fill password, click "Entrar"
 *   openBoleto()         → find a-vencer boleto, click, click "Visualizar" → returns new tab
 *   readBoletoData()     → read valor, vencimento, competência from boleto tab
 *   extractPixCode()     → click "Pagar", wait for QR, extract PIX string (best-effort)
 *   extractBoletoCode()  → click radio parcela-0, read textarea with linha digitável
 *   downloadFromImprimir() → click "Imprimir", intercept new tab, download PDF
 *
 * Selectors (confirmed via browser DevTools on officeadm.superlogica.net):
 *   #email                                        → E-mail input
 *   input[name="senha"]                           → Password input
 *   input[value="Entrar Agora"]                   → First submit button
 *   input[value="Entrar"]                         → Second submit button
 *   .bloco-grid-cobrancas:has(.situacao-a-vencer) → Unpaid boleto card
 *   input[value="Visualizar"]                     → Modal: open boleto in new tab
 *   p.valorFatura                                 → Valor atualizado
 *   #DT_VENCIMENTO_FATURA                         → Due date
 *   p.competencia                                 → Competência month/year
 *   a.pagarBoleto                                 → Trigger PIX section
 *   #imgQrcodePix                                 → PIX QR code image (signals PIX ready)
 *   #parcela-0                                    → Radio: boleto option (reveals linha digitável)
 *   textarea.text                                 → Código de barras / linha digitável
 *   #btnSubmitParcelamentoCartao                  → "Imprimir" — opens PDF in new tab
 */

import path from 'node:path';
import type { Page, Request, Route } from 'playwright';
import type { Logger } from 'pino';
import { BaseScraper, type BrowserService } from '../base-scraper.js';
import type { EnvCredential, ProgressCallback, ScraperResult } from '../interfaces.js';

const CONDO_URL = 'https://officeadm.superlogica.net/clients/areadocondomino';
const ALLOWED_MIMES = ['application/pdf'];

export class CondominioProvider extends BaseScraper {
  readonly name = 'condominio';

  readonly requiredCredentials: EnvCredential[] = [
    {
      key: 'CONDO_EMAIL',
      label: 'E-mail do condomínio',
      description: 'E-mail de acesso ao portal Superlogica (areadocondomino)',
      sensitive: false,
    },
    {
      key: 'CONDO_PASSWORD',
      label: 'Senha do condomínio',
      description: 'Senha de acesso ao portal Superlogica',
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

    let boletoPage: Page | null = null;

    try {
      await this.retry(
        () => this.doLogin(page, credentials),
        {
          maxAttempts: 2,
          baseDelayMs: 2000,
          onAttempt: (attempt, error) => {
            this.emitStep({ stepId: 'login', label: `Autenticando (tentativa ${attempt}/2)...`, status: 'error' });
            this.logger.warn({ attempt, err: error.message }, 'doLogin retry');
          },
        },
      );

      await this.debugShot(page, 'logged-in');

      boletoPage = await this.retry(
        () => this.openBoleto(page),
        {
          maxAttempts: 2,
          baseDelayMs: 2000,
          onAttempt: (attempt, error) => {
            this.emitStep({ stepId: 'fetch', label: `Abrindo boleto (tentativa ${attempt}/2)...`, status: 'error' });
            this.logger.warn({ attempt, err: error.message }, 'openBoleto retry');
          },
        },
      );

      await this.debugShot(boletoPage, 'boleto-tab');

      const { amountCents, dueDate, competencia } = await this.readBoletoData(boletoPage);

      // Open the payment section — reveals PIX QR, #parcela-0, textarea.text, and Imprimir button.
      // Everything below depends on this click.
      // There are 3 a.pagarBoleto in the DOM; the first one (pagarComBoleto() with no arg) is the real button.
      this.emitStep({ stepId: 'fetch', label: 'Abrindo opções de pagamento...', status: 'pending' });
      await boletoPage.locator('a.pagarBoleto').first().click();
      await boletoPage.waitForSelector('#parcela-0', { state: 'visible', timeout: 20_000 });
      await this.debugShot(boletoPage, 'payment-section');

      // PIX is read while the PIX QR is still the active view
      const pixCode = await this.extractPixCode(boletoPage);

      // Boleto code: click #parcela-0 to switch from PIX view to boleto view
      const boletoCode = await this.extractBoletoCode(boletoPage);

      const finalPath = this.buildFilePath('boleto-condominio', 'pdf');

      const { mimeType, sizeBytes } = await this.retry(
        () => this.downloadFromImprimir(boletoPage!, finalPath),
        {
          maxAttempts: 3,
          baseDelayMs: 2000,
          onAttempt: (attempt, error) => {
            this.emitStep({ stepId: 'download', label: `Baixando boleto (tentativa ${attempt}/3)...`, status: 'error' });
            this.logger.warn({ attempt, err: error.message }, 'downloadFromImprimir retry');
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
        type: 'condo-boleto',
        boletoCode,
        pixCode: pixCode ?? undefined,
        amountCents,
        dueDate,
        competencia,
        filePath: finalPath,
        mimeType,
        sizeBytes,
      };
    } catch (err) {
      this.logger.error({ err }, 'CondominioProvider run() failed');
      return {
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
        cause: err,
      };
    } finally {
      await boletoPage?.close().catch(() => undefined);
      await page.close();
    }
  }

  // ─── Step 1: Two-step login (email → password) ──────────────────────────

  async doLogin(page: Page, credentials: Record<string, string>): Promise<void> {
    this.emitStep({ stepId: 'login', label: 'Abrindo portal do condomínio...', status: 'pending' });

    await page.goto(CONDO_URL, { waitUntil: 'networkidle', timeout: 30_000 });

    // If already logged in (session restored), the boleto grid will be visible
    const alreadyLoggedIn = await page
      .locator('.bloco-grid-cobrancas')
      .isVisible()
      .catch(() => false);

    if (alreadyLoggedIn) {
      this.emitStep({ stepId: 'login', label: 'Sessão restaurada', status: 'success' });
      return;
    }

    this.emitStep({ stepId: 'login', label: 'Preenchendo e-mail...', status: 'pending' });

    const email = credentials['CONDO_EMAIL'] ?? '';
    const password = credentials['CONDO_PASSWORD'] ?? '';

    await page.locator('#email').waitFor({ state: 'visible', timeout: 15_000 });
    await page.locator('#email').fill(email);
    await page.locator('input[value="Entrar Agora"]').click();

    this.emitStep({ stepId: 'login', label: 'Preenchendo senha...', status: 'pending' });

    // Wait for the password field to appear in the second step
    await page.waitForSelector('input[name="senha"]', { state: 'visible', timeout: 15_000 });
    await page.locator('input[name="senha"]').fill(password);
    await page.locator('input[value="Entrar"]').click();

    // Wait for the boleto list to confirm successful login
    await page.waitForSelector('.bloco-grid-cobrancas', { timeout: 30_000 });

    this.emitStep({ stepId: 'login', label: 'Autenticado com sucesso', status: 'success' });
  }

  // ─── Step 2: Click unpaid boleto → modal → Visualizar → new tab ─────────

  async openBoleto(page: Page): Promise<Page> {
    this.emitStep({ stepId: 'fetch', label: 'Localizando boleto a vencer...', status: 'pending' });

    // Find the first unpaid (a-vencer) boleto card
    const boletoCard = page.locator('.bloco-grid-cobrancas:has(.situacao-a-vencer)').first();
    await boletoCard.waitFor({ state: 'visible', timeout: 15_000 });
    await boletoCard.click();

    this.emitStep({ stepId: 'fetch', label: 'Carregando segunda via...', status: 'pending' });

    // Wait for the modal with the "Visualizar" button
    await page.waitForSelector('input[value="Visualizar"]', { state: 'visible', timeout: 20_000 });

    // Click Visualizar — opens boleto in a new tab
    const [boletoPage] = await Promise.all([
      page.context().waitForEvent('page'),
      page.locator('input[value="Visualizar"]').click(),
    ]);

    await boletoPage.waitForLoadState('domcontentloaded', { timeout: 30_000 });

    this.emitStep({ stepId: 'fetch', label: 'Boleto aberto', status: 'success' });

    return boletoPage;
  }

  // ─── Step 3: Read valor, vencimento, competência ─────────────────────────

  async readBoletoData(
    page: Page,
  ): Promise<{ amountCents: number; dueDate: string; competencia: string }> {
    this.emitStep({ stepId: 'fetch', label: 'Lendo dados do boleto...', status: 'pending' });

    // Valor: "R$993,44" inside p.valorFatura — strip the span text first
    const valorRaw = await page.locator('p.valorFatura').textContent({ timeout: 10_000 }).catch(() => '');
    const valorMatch = valorRaw?.match(/R\$\s*([\d.]+,\d{2})/);
    const amountCents = valorMatch
      ? Math.round(parseFloat(valorMatch[1].replace(/\./g, '').replace(',', '.')) * 100)
      : 0;

    // Due date: "10/04/2026" from #DT_VENCIMENTO_FATURA
    const dueDate = (
      await page.locator('#DT_VENCIMENTO_FATURA').textContent({ timeout: 5_000 }).catch(() => '')
    )?.trim() ?? '';

    // Competência: "04/2026" from p.competencia
    const competencia = (
      await page.locator('p.competencia').textContent({ timeout: 5_000 }).catch(() => '')
    )?.trim() ?? '';

    this.emitStep({ stepId: 'fetch', label: 'Dados lidos', status: 'success' });

    return { amountCents, dueDate, competencia };
  }

  // ─── Step 4: Click "Pagar", extract PIX code (best-effort) ───────────────

  async extractPixCode(page: Page): Promise<string | null> {
    this.emitStep({ stepId: 'fetch', label: 'Carregando PIX...', status: 'pending' });

    try {
      // Payment section is already open; just wait for the QR image to be visible
      await page.waitForSelector('#imgQrcodePix', { state: 'visible', timeout: 15_000 });

      // Search the DOM for a PIX EMV string (always starts with "000201")
      const pixCode = await page.evaluate((): string | null => {
        for (const el of document.querySelectorAll('input, textarea')) {
          const val = (el as HTMLInputElement).value.trim();
          if (val.startsWith('000201')) return val;
        }
        for (const el of document.querySelectorAll('[class*="pix" i], [id*="pix" i]')) {
          const candidate =
            (el as HTMLInputElement).value?.trim() ?? el.textContent?.trim() ?? '';
          if (candidate.startsWith('000201')) return candidate;
        }
        return null;
      }) as string | null;

      if (pixCode) {
        this.emitStep({ stepId: 'fetch', label: 'Código PIX obtido', status: 'success' });
      } else {
        this.emitStep({ stepId: 'fetch', label: 'PIX QR disponível (texto não extraível)', status: 'warning' });
        this.logger.warn('extractPixCode: PIX EMV string not found in DOM');
      }

      return pixCode;
    } catch (err) {
      this.logger.warn({ err }, 'extractPixCode failed; skipping PIX');
      this.emitStep({ stepId: 'fetch', label: 'PIX não disponível', status: 'warning' });
      return null;
    }
  }

  // ─── Step 5: Click radio parcela-0, read linha digitável ─────────────────

  async extractBoletoCode(page: Page): Promise<string> {
    this.emitStep({ stepId: 'fetch', label: 'Obtendo linha digitável...', status: 'pending' });

    // Clicking parcela-0 reveals the barcode textarea and the Imprimir button
    await this.debugShot(page, 'boleto-tab-antes');
    await page.locator('#parcela-0').click();
    await this.debugShot(page, 'boleto-tab-parcela0');
    await page.waitForSelector('textarea.text', { state: 'visible', timeout: 10_000 });

    const boletoCode = (await page.locator('textarea.text').inputValue().catch(() => '')).trim();

    this.emitStep({ stepId: 'fetch', label: 'Linha digitável obtida', status: 'success' });

    return boletoCode;
  }

  // ─── Step 6: Click "Imprimir", capture PDF URL then download with axios ─

  async downloadFromImprimir(
    page: Page,
    finalPath: string,
  ): Promise<{ mimeType: string; sizeBytes: number }> {
    this.emitStep({ stepId: 'download', label: 'Gerando PDF do boleto...', status: 'pending' });

    // "Imprimir" navigates the current tab to a PDF URL. The browser's built-in PDF viewer
    // absorbs the response body before CDP can read it (ERR_ABORTED / body gone).
    // Strategy: capture the outgoing URL via the 'request' event (fires before routing),
    // abort the navigation via page.route() so the viewer never kicks in,
    // then re-download the same URL independently with axios.
    const pdfUrlPromise = new Promise<string>((resolve) => {
      const handler = (req: Request) => {
        if (req.isNavigationRequest() && req.frame() === page.mainFrame()) {
          page.off('request', handler);
          resolve(req.url());
        }
      };
      page.on('request', handler);
    });

    const abortNav = async (route: Route) => {
      if (route.request().isNavigationRequest()) {
        await route.abort();
      } else {
        await route.continue();
      }
    };
    await page.route('**', abortNav);

    await page.locator('#btnSubmitParcelamentoCartao').click();
    this.emitStep({ stepId: 'download', label: 'Aguardando URL do PDF...', status: 'pending' });

    const pdfUrl = await Promise.race([
      pdfUrlPromise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Timeout aguardando URL do PDF (45s)')), 45_000),
      ),
    ]);

    await page.unroute('**', abortNav);

    this.logger.info({ pdfUrl }, 'downloadFromImprimir: captured PDF URL');
    this.emitStep({ stepId: 'download', label: 'Baixando PDF...', status: 'pending' });
    return this.downloadFile(pdfUrl, finalPath, ALLOWED_MIMES);
  }
}
