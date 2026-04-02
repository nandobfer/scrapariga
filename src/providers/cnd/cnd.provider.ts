/**
 * cnd.provider.ts — Certidão Negativa de Débitos (Receita Federal).
 *
 * URL: https://servicos.receitafederal.gov.br/servico/certidoes/#/home/cnpj
 *
 * Flow:
 *   login()          → navigate, fill CNPJ, click "Consultar Certidão"
 *   fetchDocuments() → wait for results page with download button
 *   download()       → click "Segunda via", capture PDF, validate, save
 *
 * Selectors (all confirmed via browser DevTools):
 *   input[name="niContribuinte"]                   → CNPJ input
 *   button.br-button.secondary hasText "Consultar" → submit CNPJ form
 *   button[title="Segunda via"]                     → download PDF
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import type { Page } from 'playwright';
import type { Logger } from 'pino';
import { BaseScraper, type BrowserService } from '../base-scraper.js';
import type { DocumentMetadata, EnvCredential, ScraperResult } from '../interfaces.js';

const CND_URL = 'https://servicos.receitafederal.gov.br/servico/certidoes/#/home/cnpj';
const ALLOWED_MIMES = ['application/pdf'];

/**
 * Formats a raw CNPJ string to XX.XXX.XXX/XXXX-XX.
 * Accepts 14-digit strings with or without mask. Returns the input unchanged if
 * it does not consist of exactly 14 digits after stripping non-digits.
 */
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
      description:
        'Informe com ou sem máscara (ex: 12.345.678/0001-95 ou 12345678000195)',
      sensitive: false,
    },
  ];

  constructor(browserService: BrowserService, logger: Logger) {
    super(browserService, logger);
  }

  // ─── Step 1: Navigate, fill CNPJ, click first "Consultar Certidão" ───────

  async login(page: Page, credentials: Record<string, string>): Promise<void> {
    this.emitStep({
      stepId: 'login',
      label: 'Abrindo página da Receita Federal...',
      status: 'pending',
    });

    await page.goto(CND_URL, { waitUntil: 'load' });

    this.emitStep({ stepId: 'login', label: 'Preenchendo CNPJ...', status: 'pending' });

    const cnpj = formatCnpj(credentials['CNPJ'] ?? '');
    const input = page.locator('input[name="niContribuinte"]');
    await input.waitFor({ state: 'visible', timeout: 15_000 });
    await input.fill(cnpj);

    // type="button" + .br-button.secondary: DS Gov semantic class for the secondary action
    const consultarBtn = page
      .locator('button.br-button.secondary')
      .filter({ hasText: 'Consultar' });
    await consultarBtn.waitFor({ state: 'visible', timeout: 10_000 });
    await consultarBtn.click();

    this.emitStep({ stepId: 'login', label: 'Formulário enviado', status: 'success' });
  }

  // ─── Step 2: Click primary "Consultar Certidão", wait for results table ───

  async fetchDocuments(page: Page): Promise<DocumentMetadata[]> {
    this.emitStep({
      stepId: 'fetch',
      label: 'Aguardando resultado da consulta...',
      status: 'pending',
    });

    // After clicking "Consultar", the page loads results directly.
    // Wait for the download button to confirm the result is ready.
      setTimeout( async () => {
    }, 3000);
    await page.waitForSelector('button[title="Segunda via"]', { timeout: 30_000 });

    this.emitStep({
      stepId: 'fetch',
      label: '1 certidão disponível para download',
      status: 'success',
    });

    return [
      {
        id: 'cnd-certidao',
        name: 'certidao-negativa-debitos',
        mimeHint: 'application/pdf',
      },
    ];
  }

  // ─── Step 3: Click "Segunda via", capture download, validate, save ────────

  async download(page: Page, doc: DocumentMetadata): Promise<ScraperResult> {
    this.emitStep({
      stepId: 'download',
      label: 'Iniciando download da certidão...',
      status: 'pending',
    });

    const downloadButton = page.locator('button[title="Segunda via"]');
    await downloadButton.waitFor({ state: 'visible', timeout: 10_000 });

    // Register the download listener BEFORE click to avoid missing the event
    const [downloadEvent] = await Promise.all([
      page.waitForEvent('download'),
      downloadButton.click(),
    ]);

    this.emitStep({ stepId: 'download', label: 'Baixando arquivo...', status: 'pending' });

    // Save to tmp → validate MIME → move to canonical documents path
    const tmpPath = path.join(process.cwd(), `cnd-${Date.now()}.tmp`);
    await downloadEvent.saveAs(tmpPath);

    await this.validateDownload(tmpPath, ALLOWED_MIMES);

    const finalPath = this.buildFilePath(doc.name, 'pdf');
    await fs.mkdir(path.dirname(finalPath), { recursive: true });

    try {
      await fs.rename(tmpPath, finalPath);
    } catch {
      // Cross-device move fallback (e.g. tmp on different partition)
      await fs.copyFile(tmpPath, finalPath);
      await fs.unlink(tmpPath).catch(() => undefined);
    }

    const stat = await fs.stat(finalPath);

    this.emitStep({
      stepId: 'download',
      label: `Certidão salva: ${path.basename(finalPath)}`,
      status: 'success',
    });

    return {
      type: 'file',
      filePath: finalPath,
      mimeType: 'application/pdf',
      sizeBytes: stat.size,
    };
  }
}
