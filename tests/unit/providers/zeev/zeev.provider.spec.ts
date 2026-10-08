/**
 * zeev.provider.spec.ts — Unit tests for ZeevProvider.
 *
 * Browser interaction is stubbed at the provider-method level (openBrowser,
 * openAndLogin, fillForm, attachFiles, submit), so no real Playwright runs.
 * PDF parsing uses the real exemplo-nf.pdf when present.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { pino } from 'pino';
import type { Page } from 'playwright';
import { ZeevProvider } from '../../../../src/providers/zeev/zeev.provider.js';
import type { BrowserService } from '../../../../src/providers/base-scraper.js';

const logger = pino({ level: 'silent' });

// The Zeev URL is now env-only (no hardcoded default).
process.env['SIPAL_ZEEV_URL'] = 'https://example.test/request?c=test';

const mockBrowserService: BrowserService = {
  newPage: vi.fn(),
  newPersistentPage: vi.fn(),
  close: vi.fn().mockResolvedValue(undefined),
};

const EXAMPLE_PDF = path.resolve(process.cwd(), 'exemplo-nf.pdf');
const hasExample = fs.existsSync(EXAMPLE_PDF);

function makeProvider(): ZeevProvider {
  return new ZeevProvider(mockBrowserService, logger);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ZeevProvider', () => {
  it('name is "zeev"', () => {
    expect(makeProvider().name).toBe('zeev');
  });

  it('declares the credentials required for the submission', () => {
    const provider = makeProvider();
    const keys = provider.requiredCredentials.map((c) => c.key);

    expect(keys).toEqual(
      expect.arrayContaining([
        'SIPAL_MICROSOFT_EMAIL',
        'SIPAL_MICROSOFT_PASSWORD',
        'SIPAL_GESTOR_APROVADOR',
        'CNPJ',
        'RAZAO_SOCIAL',
        'RCLONE_REMOTE',
        'RCLONE_COMPROVANTE_FOLDER',
      ]),
    );
    expect(
      provider.requiredCredentials.find((c) => c.key === 'SIPAL_MICROSOFT_PASSWORD')?.sensitive,
    ).toBe(true);
  });

  it('returns an error when the NFS-e path is missing', async () => {
    const result = await makeProvider().run({}, vi.fn());
    expect(result.type).toBe('error');
    if (result.type === 'error') expect(result.message).toMatch(/NFS-e/);
  });
});

describe.skipIf(!hasExample)('ZeevProvider.run (exemplo-nf.pdf)', () => {
  it('returns an error when the CND path is missing', async () => {
    const provider = makeProvider();
    vi.spyOn(provider as never, 'assertReadablePdf').mockResolvedValue(undefined as never);
    vi.spyOn(provider as never, 'fetchComprovante').mockResolvedValue(
      '/tmp/comprovante.png' as never,
    );

    const result = await provider.run({ NFSE_PATH: EXAMPLE_PDF }, vi.fn());

    expect(result.type).toBe('error');
    if (result.type === 'error') expect(result.message).toMatch(/CND/);
  });

  it('orchestrates the full pipeline and returns a success message', async () => {
    const provider = makeProvider();
    const fakePage = { close: vi.fn().mockResolvedValue(undefined) };

    vi.spyOn(provider as never, 'assertReadablePdf').mockResolvedValue(undefined as never);
    vi.spyOn(provider as never, 'fetchComprovante').mockResolvedValue(
      '/tmp/comprovante.png' as never,
    );
    const openBrowser = vi
      .spyOn(provider as never, 'openBrowser')
      .mockResolvedValue(fakePage as never);
    const openAndLogin = vi
      .spyOn(provider as never, 'openAndLogin')
      .mockResolvedValue(undefined as never);
    const fillForm = vi
      .spyOn(provider as never, 'fillForm')
      .mockResolvedValue(undefined as never);
    const attachFiles = vi
      .spyOn(provider as never, 'attachFiles')
      .mockResolvedValue(undefined as never);
    const submit = vi.spyOn(provider as never, 'submit').mockResolvedValue(true as never);

    const result = await provider.run(
      { NFSE_PATH: EXAMPLE_PDF, CND_PATH: '/tmp/cnd.pdf' },
      vi.fn(),
    );

    expect(result.type).toBe('message');
    if (result.type === 'message') expect(result.message).toContain('19');

    expect(openBrowser).toHaveBeenCalledTimes(1);
    expect(openAndLogin).toHaveBeenCalledTimes(1);
    expect(fillForm).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledTimes(1);

    // Attachments are passed in order: NFS-e, comprovante, CND.
    expect(attachFiles).toHaveBeenCalledWith(fakePage, [
      EXAMPLE_PDF,
      '/tmp/comprovante.png',
      '/tmp/cnd.pdf',
    ]);

    expect(fakePage.close).toHaveBeenCalled();
    expect(mockBrowserService.close).toHaveBeenCalled();
  });
});

describe('ZeevProvider.submit (manual handoff)', () => {
  it('does not click and returns true when the form is left (submitted)', async () => {
    const provider = makeProvider();
    const evaluate = vi
      .fn()
      .mockResolvedValueOnce('/request?c=abc') // initial location
      .mockResolvedValueOnce({ gone: true, navigated: false, success: false });
    const fakePage = {
      isClosed: () => false,
      evaluate,
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
    } as unknown as Page;

    const submit = (provider as unknown as { submit(p: Page): Promise<boolean> }).submit.bind(
      provider,
    );
    await expect(submit(fakePage)).resolves.toBe(true);
  });

  it('returns false when nothing happens before the timeout', async () => {
    const provider = makeProvider();
    const evaluate = vi
      .fn()
      .mockResolvedValueOnce('/request?c=abc')
      .mockResolvedValue({ gone: false, navigated: false, success: false });
    const fakePage = {
      isClosed: () => false,
      evaluate,
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
    } as unknown as Page;

    process.env['ZEEV_SUBMIT_TIMEOUT_MS'] = '1';
    const submit = (provider as unknown as { submit(p: Page): Promise<boolean> }).submit.bind(
      provider,
    );
    await expect(submit(fakePage)).resolves.toBe(false);
    delete process.env['ZEEV_SUBMIT_TIMEOUT_MS'];
  });
});
