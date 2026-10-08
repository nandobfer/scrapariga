/**
 * zeev.provider.ts — Submete uma solicitação de pagamento de NFS-e no Zeev.
 *
 * URL: request form da Sipal no Zeev (login via SSO Microsoft).
 *
 * Fluxo:
 *   1. Lê o número da nota do PDF da NFS-e (NFSE_PATH)
 *   2. Obtém o comprovante de pagamento (rclone/Drive) via ComprovantePagamentoProvider
 *   3. Obtém a CND (CND_PATH, resolvida pelo preflight da CLI)
 *   4. Abre o formulário do Zeev e autentica no SSO Microsoft
 *   5. Preenche os campos do formulário
 *   6. Anexa NFS-e + comprovante + CND
 *   7. Clica em "Enviar solicitação"
 *
 * SSO: usa um perfil persistente do Chromium (`.zeev-profile`), então a sessão
 * Microsoft é reaproveitada entre execuções. O login pode aparecer inline ou em
 * popup; o provider observa todas as páginas do contexto e, se necessário,
 * aguarda o usuário concluir MFA na janela (headful por padrão).
 *
 * Descoberta do DOM: como o formulário é dinâmico, os campos são resolvidos por
 * rótulo (getByLabel) com fallback por name/placeholder, em todos os frames.
 * Use DEBUG=true para gravar um dump completo (JSON + HTML + screenshot) em
 * screenshots/zeev/ e calibrar FIELD_LABELS. Um dump também é gravado quando a
 * execução falha, para facilitar o diagnóstico.
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import type { BrowserContext, Frame, Locator, Page } from 'playwright';
import type { Logger } from 'pino';
import { BaseScraper, type BrowserService } from '../base-scraper.js';
import type {
  EnvCredential,
  FileResult,
  MessageResult,
  ProgressCallback,
  ScraperResult,
} from '../interfaces.js';
import { ComprovantePagamentoProvider } from '../comprovante-pagamento/comprovante-pagamento.provider.js';
import { extractNotaNumber } from './nfse-parser.js';

const ZEEV_PROFILE_DIR = path.resolve(process.cwd(), '.zeev-profile');

// A URL do formulário (com o token c=...) fica no .env (SIPAL_ZEEV_URL), nunca no
// código — o repositório é público.

// ─── Valores fixos do formulário ─────────────────────────────────────────────

const ENCARGOS = 'Desenvolvimento de programas de computador customizados';
const TIPO_PROCESSO = 'Nota fiscal de serviço';
const BANCO_QUERY = '0260';
const BANCO_OPTION = 'NUBANK';
const AGENCIA = '0001';
const CONTA = '585929545-1';

/** Texto do botão de envio — usado como sinal de "formulário pronto". */
const SUBMIT_TEXT_RE = /enviar solicita/i;

interface FieldSpec {
  /** Semantic id in the Zeev form (primary selector). */
  id: string;
  /** Fallback labels, used only if the id is not found. */
  labels: readonly string[];
}

/**
 * Campos do formulário "Cadastrar Pagamento" do Zeev. Os ids são estáveis e
 * semânticos (confirmados no dump em screenshots/zeev/); os labels são fallback.
 */
export const FIELDS: Record<string, FieldSpec> = {
  cnpj: { id: '#inpcNPJFavorecido', labels: ['CNPJ Favorecido', 'CNPJ do favorecido', 'CNPJ'] },
  razaoSocial: { id: '#inprazaoSocial', labels: ['Razão Social', 'Razão social'] },
  encargos: { id: '#inpencargos', labels: ['Encargos'] },
  numeroNota: { id: '#inpnnf', labels: ['Nº da NF', 'Número da nota'] },
  tipoProcesso: { id: '#inptipoDeProcesso', labels: ['Tipo de processo'] },
  // O select do gestor tem id GUID; usamos o name estável do campo (40391).
  gestor: { id: 'select[name="inp40391"]', labels: ['Gestor aprovador'] },
  banco: { id: '#inpbanco', labels: ['Banco'] },
  agencia: { id: '#inpagencia', labels: ['Agência', 'Agencia'] },
  conta: { id: '#inpconta', labels: ['Conta'] },
};

/** Botões "anexar arquivo" — um por anexo obrigatório. */
export const ATTACH_BUTTONS = {
  nfse: '#btnUploadnff',
  comprovante: '#btnUploadcomptrib',
  cnd: '#btnUploadcnd',
} as const;

interface FormField {
  tag: string;
  type: string;
  name: string;
  id: string;
  placeholder: string;
  label: string;
  options?: string[];
}

interface FormButton {
  text: string;
  tag: string;
  id: string;
  cls: string;
}

interface FrameDump {
  name: string;
  url: string;
  title: string;
  fields: FormField[];
  buttons: FormButton[];
}

export class ZeevProvider extends BaseScraper {
  readonly name = 'zeev';

  readonly requiredCredentials: EnvCredential[] = [
    {
      key: 'SIPAL_MICROSOFT_EMAIL',
      label: 'E-mail Microsoft (SIPAL)',
      description: 'Conta Microsoft usada no SSO do Zeev',
      sensitive: false,
    },
    {
      key: 'SIPAL_MICROSOFT_PASSWORD',
      label: 'Senha Microsoft (SIPAL)',
      description: 'Senha da conta Microsoft usada no SSO do Zeev',
      sensitive: true,
    },
    {
      key: 'SIPAL_GESTOR_APROVADOR',
      label: 'Gestor aprovador',
      description: 'Nome exato do gestor aprovador no Zeev',
      sensitive: false,
    },
    {
      key: 'CNPJ',
      label: 'CNPJ favorecido',
      description: 'CNPJ da empresa favorecida (prestador)',
      sensitive: false,
    },
    {
      key: 'RAZAO_SOCIAL',
      label: 'Razão social',
      description: 'Razão social do favorecido',
      sensitive: false,
    },
    {
      key: 'RCLONE_REMOTE',
      label: 'Remote rclone',
      description: 'Nome do remote configurado no rclone (ex: gdrive)',
      sensitive: false,
    },
    {
      key: 'RCLONE_COMPROVANTE_FOLDER',
      label: 'Pasta dos comprovantes',
      description: 'Caminho da pasta no remote (ex: Documentos/Comprovantes)',
      sensitive: false,
    },
    {
      key: 'SIPAL_ZEEV_URL',
      label: 'URL do formulário do Zeev',
      description: 'URL do request do Zeev, incluindo o token c=... (fica no .env, não no código)',
      sensitive: true,
    },
  ];

  constructor(browserService: BrowserService, logger: Logger) {
    super(browserService, logger);
  }

  // ─── run() ──────────────────────────────────────────────────────────────────

  async run(
    credentials: Record<string, string>,
    onProgress: ProgressCallback,
  ): Promise<ScraperResult> {
    this._progressCallback = onProgress;

    let page: Page | null = null;

    try {
      // ── 1. Número da nota ─────────────────────────────────────────────────
      const nfsePath = this.requirePath(credentials, 'NFSE_PATH', 'PDF da NFS-e');
      await this.assertReadablePdf(nfsePath, 'NFS-e');

      this.emitStep({ stepId: 'parse', label: 'Lendo o número da nota...', status: 'pending' });
      const numeroNota = await extractNotaNumber(nfsePath);
      this.emitStep({
        stepId: 'parse',
        label: `Número da nota: ${numeroNota}`,
        status: 'success',
      });

      // ── 2. Comprovante de pagamento ───────────────────────────────────────
      this.emitStep({
        stepId: 'comprovante',
        label: 'Obtendo comprovante de pagamento...',
        status: 'pending',
      });
      const comprovantePath = await this.fetchComprovante(credentials);
      this.emitStep({ stepId: 'comprovante', label: 'Comprovante obtido', status: 'success' });

      // ── 3. CND ────────────────────────────────────────────────────────────
      const cndPath = this.requirePath(credentials, 'CND_PATH', 'PDF da CND');
      await this.assertReadablePdf(cndPath, 'CND');

      // ── 4. Browser + login SSO ────────────────────────────────────────────
      page = await this.openBrowser();
      const url = this.requireZeevUrl();
      await this.openAndLogin(page, url, credentials);

      if (process.env['DEBUG'] === 'true') {
        await this.dumpFormFields(page, 'debug');
      }

      // ── 5. Formulário ─────────────────────────────────────────────────────
      await this.fillForm(page, { numeroNota, credentials });

      // ── 6. Anexos ─────────────────────────────────────────────────────────
      await this.attachFiles(page, [nfsePath, comprovantePath, cndPath]);

      // ── 7. Enviar ─────────────────────────────────────────────────────────
      const submitted = await this.submit(page);

      const result: MessageResult = {
        type: 'message',
        message: submitted
          ? `Solicitação enviada ao Zeev (NFS-e nº ${numeroNota}).`
          : `Formulário preenchido e anexado (NFS-e nº ${numeroNota}), mas o envio não foi confirmado.`,
      };
      return result;
    } catch (err) {
      // Dump the DOM on failure so the selectors can be calibrated.
      if (page) await this.dumpFormFields(page, 'failure').catch(() => undefined);

      const message = err instanceof Error ? err.message : String(err);
      this.logger.error({ err }, 'ZeevProvider run() failed');
      return { type: 'error', message, cause: err };
    } finally {
      await page?.close().catch(() => undefined);
      await this.browserService.close().catch(() => undefined);
    }
  }

  // ─── Anexos ─────────────────────────────────────────────────────────────────

  /** Downloads the latest payment receipt via ComprovantePagamentoProvider. */
  protected async fetchComprovante(credentials: Record<string, string>): Promise<string> {
    const provider = new ComprovantePagamentoProvider(this.browserService, this.logger);

    // Progress events reuse the same step ids; prefix them so the parent
    // progress renderer does not clash with the Zeev steps.
    const result: FileResult = await provider.fetchLatest(credentials, (event) => {
      this.emitStep({ ...event, stepId: `comprovante:${event.stepId}` });
    });

    return result.filePath;
  }

  // ─── Navegação + SSO Microsoft ──────────────────────────────────────────────

  protected async openBrowser(): Promise<Page> {
    if (!this.browserService.newPersistentPage) {
      throw new Error('O BrowserService em uso não suporta perfil persistente (SSO).');
    }
    this.emitStep({ stepId: 'login', label: 'Abrindo o Zeev...', status: 'pending' });
    return this.browserService.newPersistentPage(ZEEV_PROFILE_DIR);
  }

  protected async openAndLogin(
    page: Page,
    url: string,
    credentials: Record<string, string>,
  ): Promise<void> {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });

    this.emitStep({
      stepId: 'login',
      label: 'Login Zeev/Microsoft — conclua o SSO na janela, se solicitado...',
      status: 'pending',
    });

    const context = page.context();
    const deadline = Date.now() + 180_000;
    let handledLogin = false;

    while (Date.now() < deadline) {
      // 1. Any page (inline or popup) showing a Microsoft auth step?
      const authPage = await this.findMicrosoftLoginPage(context);
      if (authPage) {
        await this.handleMicrosoftStep(authPage, credentials);
        handledLogin = true;
        await page.waitForTimeout(1000);
        continue;
      }

      // 2. Is the Zeev request form ready?
      if (await this.isFormReady(context)) {
        this.emitStep({
          stepId: 'login',
          label: handledLogin ? 'Autenticado com sucesso' : 'Sessão Zeev restaurada',
          status: 'success',
        });
        await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
        await page.waitForTimeout(1000);
        return;
      }

      await page.waitForTimeout(1000);
    }

    throw new Error(
      `Timeout aguardando o formulário do Zeev (180s). URL atual: ${page.url()}`,
    );
  }

  /** Finds any page in the context currently on a Microsoft login step. */
  protected async findMicrosoftLoginPage(context: BrowserContext): Promise<Page | null> {
    for (const p of context.pages()) {
      const url = p.url();
      const onMicrosoft =
        url.includes('microsoftonline.com') ||
        url.includes('live.com') ||
        url.includes('login.microsoft.com');
      if (!onMicrosoft) continue;

      const email = p.locator('input[type="email"], input[name="loginfmt"], #i0116').first();
      if (await email.isVisible().catch(() => false)) return p;

      const password = p.locator('input[type="password"], input[name="passwd"], #i0118').first();
      if (await password.isVisible().catch(() => false)) return p;

      // "Continuar conectado?" / "Stay signed in?"
      const body = await p.locator('body').innerText().catch(() => '');
      if (/continuar conectado|stay signed in/i.test(body)) return p;
    }
    return null;
  }

  /** Performs one Microsoft auth step (email → password → stay signed in). */
  protected async handleMicrosoftStep(
    authPage: Page,
    credentials: Record<string, string>,
  ): Promise<void> {
    const email = authPage.locator('input[type="email"], input[name="loginfmt"], #i0116').first();
    if (await email.isVisible().catch(() => false)) {
      this.emitStep({ stepId: 'login', label: 'SSO Microsoft: e-mail...', status: 'pending' });
      await email.fill(credentials['SIPAL_MICROSOFT_EMAIL'] ?? '');
      await authPage.locator('#idSIButton9, input[type="submit"]').first().click();
      await authPage.waitForTimeout(1500);
      return;
    }

    const password = authPage
      .locator('input[type="password"], input[name="passwd"], #i0118')
      .first();
    if (await password.isVisible().catch(() => false)) {
      this.emitStep({ stepId: 'login', label: 'SSO Microsoft: senha...', status: 'pending' });
      await password.fill(credentials['SIPAL_MICROSOFT_PASSWORD'] ?? '');
      await authPage.locator('#idSIButton9, input[type="submit"]').first().click();
      await authPage.waitForTimeout(1500);
      return;
    }

    // Stay signed in? → Yes
    await authPage.locator('#idSIButton9').first().click().catch(() => undefined);
    await authPage.waitForTimeout(1000);
  }

  /** True when any page/frame in the context shows the Zeev request form. */
  protected async isFormReady(context: BrowserContext): Promise<boolean> {
    for (const p of context.pages()) {
      for (const frame of p.frames()) {
        const submit = frame.getByText(SUBMIT_TEXT_RE).first();
        if ((await submit.count().catch(() => 0)) > 0) return true;
      }
    }
    return false;
  }

  /** Finds the first element matching a text regex, across all frames. */
  protected async findTextAcrossFrames(page: Page, re: RegExp): Promise<Locator | null> {
    for (const frame of page.frames()) {
      const el = frame.getByText(re).first();
      if ((await el.count().catch(() => 0)) > 0) return el;
    }
    return null;
  }

  // ─── Formulário ─────────────────────────────────────────────────────────────

  protected async fillForm(
    page: Page,
    ctx: { numeroNota: string; credentials: Record<string, string> },
  ): Promise<void> {
    const { numeroNota, credentials } = ctx;
    this.emitStep({
      stepId: 'form',
      label: 'Preenchendo o formulário do Zeev...',
      status: 'pending',
    });

    await this.dismissTutorial(page);

    await this.setField(page, FIELDS.cnpj, credentials['CNPJ'] ?? '');
    await this.setField(page, FIELDS.razaoSocial, credentials['RAZAO_SOCIAL'] ?? '');
    await this.setField(page, FIELDS.encargos, ENCARGOS);
    await this.setField(page, FIELDS.numeroNota, numeroNota);
    await this.setField(page, FIELDS.tipoProcesso, TIPO_PROCESSO);
    await this.setField(page, FIELDS.gestor, credentials['SIPAL_GESTOR_APROVADOR'] ?? '');
    await this.setBanco(page);
    await this.setField(page, FIELDS.agencia, AGENCIA);
    await this.setField(page, FIELDS.conta, CONTA);

    this.emitStep({ stepId: 'form', label: 'Formulário preenchido', status: 'success' });
  }

  /** Fecha o tutorial de boas-vindas, que pode cobrir campos do formulário. */
  protected async dismissTutorial(page: Page): Promise<void> {
    const close = page.locator('#btnCloseTutorial').first();
    if ((await close.count().catch(() => 0)) === 0) return;
    if (!(await close.isVisible().catch(() => false))) return;

    await page.locator('#chkDoNotShowTutorialMore').first().check().catch(() => undefined);
    await close.click().catch(() => undefined);
    await page.waitForTimeout(500);
  }

  /**
   * Preenche um campo pelo id semântico (com fallback por label). Usa
   * `selectOption` quando o alvo é um <select>.
   */
  protected async setField(page: Page, spec: FieldSpec, value: string): Promise<void> {
    const locator = await this.resolveField(page, spec);
    if (!locator) {
      throw new Error(`Campo não encontrado no Zeev: "${spec.labels[0]}"`);
    }

    const tag = await locator.evaluate((el) => el.tagName.toLowerCase()).catch(() => '');
    if (tag === 'select') {
      await this.selectByText(locator, value);
      return;
    }

    await locator.fill(value);
  }

  /** Seleciona uma opção pelo texto exato e, se falhar, por substring (case-insensitive). */
  protected async selectByText(locator: Locator, value: string): Promise<void> {
    try {
      await locator.selectOption({ label: value });
      return;
    } catch {
      // fall through to fuzzy match
    }

    const options = await locator.locator('option').allTextContents();
    const match = options.find((o) => o.trim().toLowerCase().includes(value.trim().toLowerCase()));
    if (match) {
      await locator.selectOption({ label: match.trim() });
      return;
    }

    throw new Error(
      `Opção "${value}" não encontrada no select. Opções: ${options
        .map((o) => o.trim())
        .filter(Boolean)
        .join(' | ')}`,
    );
  }

  /** Resolve um campo pelo id semântico, com fallback por labels. */
  protected async resolveField(page: Page, spec: FieldSpec): Promise<Locator | null> {
    for (const frame of page.frames()) {
      const byId = frame.locator(spec.id).first();
      if ((await byId.count().catch(() => 0)) > 0) return byId;
    }
    return this.findByLabels(page, spec.labels);
  }

  /** Banco é um autocomplete: digita o código e clica na opção sugerida. */
  protected async setBanco(page: Page): Promise<void> {
    const locator = await this.resolveField(page, FIELDS.banco);
    if (!locator) {
      throw new Error('Campo "Banco" não encontrado no Zeev.');
    }

    await locator.click();
    await locator.fill('');
    await locator.pressSequentially(BANCO_QUERY, { delay: 120 });
    await page.waitForTimeout(1200);

    const listOption = page
      .locator('li, [role="option"], .autocomplete-item, .ui-menu-item')
      .filter({ hasText: new RegExp(BANCO_OPTION, 'i') })
      .first();
    if (
      (await listOption.count().catch(() => 0)) > 0 &&
      (await listOption.isVisible().catch(() => false))
    ) {
      await listOption.click();
      return;
    }

    const textOption = await this.findTextAcrossFrames(page, new RegExp(BANCO_OPTION, 'i'));
    if (textOption) {
      await textOption.click();
      return;
    }

    // Keyboard fallback for a keyboard-driven autocomplete.
    await locator.press('ArrowDown').catch(() => undefined);
    await locator.press('Enter').catch(() => undefined);
  }

  /** Resolves the first field matching any candidate label, across all frames. */
  protected async findByLabels(page: Page, labels: readonly string[]): Promise<Locator | null> {
    for (const frame of page.frames()) {
      for (const label of labels) {
        const locator = frame.getByLabel(label, { exact: false });
        if ((await locator.count().catch(() => 0)) > 0) return locator.first();
      }

      for (const label of labels) {
        const needle = label.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
        if (!needle) continue;
        const css = `input[name*="${needle}" i], textarea[name*="${needle}" i], input[placeholder*="${needle}" i]`;
        const locator = frame.locator(css);
        if ((await locator.count().catch(() => 0)) > 0) return locator.first();
      }
    }
    return null;
  }

  // ─── Anexos + envio ─────────────────────────────────────────────────────────

  /** Collects every file input across all frames. */
  protected async collectFileInputs(page: Page): Promise<Locator[]> {
    const inputs: Locator[] = [];
    for (const frame of page.frames()) {
      const locator = frame.locator('input[type="file"]');
      const count = await locator.count().catch(() => 0);
      for (let i = 0; i < count; i++) inputs.push(locator.nth(i));
    }
    return inputs;
  }

  protected async attachFiles(page: Page, files: string[]): Promise<void> {
    this.emitStep({
      stepId: 'attach',
      label: `Anexando ${files.length} arquivo(s)...`,
      status: 'pending',
    });

    const targets: Array<{ selector: string; file: string | undefined; label: string }> = [
      { selector: ATTACH_BUTTONS.nfse, file: files[0], label: 'NFS-e' },
      { selector: ATTACH_BUTTONS.comprovante, file: files[1], label: 'Comprovante' },
      { selector: ATTACH_BUTTONS.cnd, file: files[2], label: 'CND' },
    ];
    const present = targets.filter(
      (t): t is { selector: string; file: string; label: string } => Boolean(t.file),
    );

    for (const target of present) {
      await this.uploadFile(page, target.selector, target.file, target.label);
    }

    this.emitStep({
      stepId: 'attach',
      label: `${present.length} arquivo(s) anexado(s)`,
      status: 'success',
    });
  }

  /**
   * Anexa um arquivo pelo botão "anexar arquivo". No Zeev, isso abre um modal
   * (`#dynmodal`) com um iframe `…/files/upload`; escolhemos o arquivo e clicamos
   * em "Iniciar upload agora" até o modal fechar. Fallback p/ file chooser nativo.
   */
  protected async uploadFile(
    page: Page,
    buttonSelector: string,
    file: string,
    label: string,
  ): Promise<void> {
    const button = page.locator(buttonSelector).first();
    if ((await button.count().catch(() => 0)) === 0) {
      throw new Error(`Botão de anexo "${label}" não encontrado (${buttonSelector}).`);
    }
    await button.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined);

    // Native chooser may fire before the modal; listen before clicking.
    const chooserPromise = page.waitForEvent('filechooser', { timeout: 2_500 }).catch(() => null);
    await button.click();
    const chooser = await chooserPromise;
    if (chooser) {
      await chooser.setFiles(file);
      await page.waitForTimeout(600);
      return;
    }

    // Zeev upload modal (iframe …/files/upload?…).
    const frame = await this.waitForUploadFrame(page, 12_000);
    if (!frame) {
      const inputs = await this.collectFileInputs(page);
      if (inputs.length === 0) {
        throw new Error(
          `Não foi possível anexar "${label}" (sem modal de upload nem input[type=file]).`,
        );
      }
      await inputs[inputs.length - 1].setInputFiles(file);
      await page.waitForTimeout(600);
      return;
    }

    const input = frame.locator('input[type="file"]').first();
    await input.waitFor({ state: 'attached', timeout: 15_000 });
    await input.setInputFiles(file);

    this.emitStep({ stepId: 'attach', label: `Enviando "${label}"...`, status: 'pending' });
    await this.clickStartUpload(frame);

    // Wait for the modal to close (Zeev processes the upload).
    await page
      .locator('#dynmodal')
      .waitFor({ state: 'hidden', timeout: 60_000 })
      .catch(() => undefined);
    await page.waitForTimeout(600);
  }

  /** Waits for the Zeev upload modal frame (src `…/files/upload`). */
  protected async waitForUploadFrame(page: Page, timeoutMs: number): Promise<Frame | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      for (const frame of page.frames()) {
        if (frame === page.mainFrame()) continue;
        if (/\/files\/upload/i.test(frame.url())) return frame;
        if ((await frame.locator('input[type="file"]').count().catch(() => 0)) > 0) return frame;
      }
      await page.waitForTimeout(300);
    }
    return null;
  }

  /** Clicks the "Iniciar upload agora" button inside the upload modal. */
  protected async clickStartUpload(frame: Frame): Promise<void> {
    const patterns = [
      /iniciar upload agora/i,
      /iniciar upload/i,
      /upload agora/i,
      /fazer upload/i,
      /enviar arquivo/i,
    ];
    for (const re of patterns) {
      const btn = frame.getByRole('button', { name: re }).first();
      if ((await btn.count().catch(() => 0)) > 0 && (await btn.isVisible().catch(() => false))) {
        await btn.click();
        return;
      }
    }

    // Last resort: the first visible button that isn't cancel/close/select.
    const buttons = frame.locator('button, input[type="submit"], a.btn');
    const count = await buttons.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      const b = buttons.nth(i);
      const text = ((await b.textContent().catch(() => '')) ?? '').trim().toLowerCase();
      if (!text) continue;
      if (/cancel|fechar|close|selecionar arquivo|escolher/.test(text)) continue;
      if (await b.isVisible().catch(() => false)) {
        await b.click();
        return;
      }
    }

    throw new Error('Botão "Iniciar upload agora" não encontrado no modal do Zeev.');
  }

  /**
   * Handoff manual: NÃO clica em enviar. Aguarda o usuário revisar e clicar em
   * "Enviar solicitação" na janela. Retorna true se o envio foi detectado.
   */
  protected async submit(page: Page): Promise<boolean> {
    const timeoutMs = this.manualSubmitTimeoutMs();

    this.emitStep({
      stepId: 'submit',
      label: 'Pronto! Revise e clique em "Enviar solicitação" na janela do Zeev',
      status: 'warning',
    });

    const start = await page
      .evaluate(() => location.pathname + location.search)
      .catch(() => '');
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (page.isClosed()) {
        this.emitStep({ stepId: 'submit', label: 'Janela fechada pelo usuário', status: 'success' });
        return true;
      }

      const state = await page
        .evaluate((startPath) => {
          const btn = document.querySelector('#BtnSend');
          const path = location.pathname + location.search;
          const body = document.body?.innerText ?? '';
          const successRe =
            /solicita[çc][ãa]o\s+(enviada|criada|registrada|cadastrada)|enviad[ao] com sucesso|n[uú]mero da solicita[çc][ãa]o|protocolo/i;
          return { gone: !btn, navigated: path !== startPath, success: successRe.test(body) };
        }, start)
        .catch(() => ({ gone: false, navigated: false, success: false }));

      if (state.gone || state.navigated || state.success) {
        this.emitStep({ stepId: 'submit', label: 'Envio confirmado', status: 'success' });
        return true;
      }

      await page.waitForTimeout(1000);
    }

    this.emitStep({
      stepId: 'submit',
      label: 'Não detectei o envio no tempo limite',
      status: 'warning',
    });
    return false;
  }

  private manualSubmitTimeoutMs(): number {
    const raw = process.env['ZEEV_SUBMIT_TIMEOUT_MS'];
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 900_000;
  }

  // ─── Discovery (DEBUG=true / falha) ─────────────────────────────────────────

  protected async dumpFormFields(page: Page, reason = 'debug'): Promise<void> {
    const dir = path.join(process.cwd(), 'screenshots', 'zeev');
    await fs.mkdir(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const base = path.join(dir, `zeev-${reason}-${stamp}`);

    const frames: FrameDump[] = [];
    for (const frame of page.frames()) {
      const dump = await this.dumpFrame(frame).catch(() => null);
      if (dump) frames.push(dump);
    }

    await fs.writeFile(
      `${base}.json`,
      JSON.stringify({ pageUrl: page.url(), frames }, null, 2),
      'utf8',
    );
    await page.screenshot({ path: `${base}.png`, fullPage: true }).catch(() => undefined);
    await fs
      .writeFile(`${base}.html`, await page.content().catch(() => ''), 'utf8')
      .catch(() => undefined);

    this.logger.info({ frames: frames.map((f) => f.url) }, 'Zeev DOM dump');
    this.emitStep({
      stepId: 'form',
      label: `Dump do Zeev salvo: ${base}.json / .html / .png`,
      status: 'warning',
    });
  }

  private async dumpFrame(frame: Frame): Promise<FrameDump> {
    const data = await frame.evaluate((): {
      title: string;
      url: string;
      fields: FormField[];
      buttons: FormButton[];
    } => {
      const fields: FormField[] = [];
      document.querySelectorAll('input, select, textarea').forEach((node) => {
        const el = node as HTMLInputElement;
        const labelText = el.labels
          ? Array.from(el.labels)
              .map((l) => l.textContent?.trim() ?? '')
              .filter(Boolean)
              .join(' | ')
          : '';
        const field: FormField = {
          tag: el.tagName.toLowerCase(),
          type: el.type,
          name: el.name,
          id: el.id,
          placeholder: el.placeholder ?? '',
          label: labelText,
        };
        if (field.tag === 'select') {
          field.options = Array.from((node as HTMLSelectElement).options).map((o) =>
            o.text.trim(),
          );
        }
        fields.push(field);
      });

      const buttons: FormButton[] = [];
      document.querySelectorAll('button, [role="button"], input[type="submit"], a').forEach(
        (node) => {
          const el = node as HTMLElement;
          const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 80);
          if (text) {
            buttons.push({
              text,
              tag: el.tagName.toLowerCase(),
              id: el.id,
              cls: (el.className || '').toString().slice(0, 60),
            });
          }
        },
      );

      return { title: document.title, url: location.href, fields, buttons };
    });

    return { name: frame.name(), ...data };
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private requirePath(credentials: Record<string, string>, key: string, label: string): string {
    const value = credentials[key];
    if (!value) throw new Error(`Caminho do ${label} não informado.`);
    return value;
  }

  private requireZeevUrl(): string {
    const url = process.env['SIPAL_ZEEV_URL'];
    if (!url) {
      throw new Error(
        'SIPAL_ZEEV_URL não configurada. Defina a URL do formulário de request do Zeev no .env.',
      );
    }
    return url;
  }

  private async assertReadablePdf(filePath: string, label: string): Promise<void> {
    try {
      await fs.access(filePath);
    } catch {
      throw new Error(`Arquivo do ${label} não encontrado: ${filePath}`);
    }
  }
}
