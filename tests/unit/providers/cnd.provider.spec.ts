/**
 * cnd.provider.spec.ts — Unit tests for CndProvider.
 *
 * The provider no longer uses a browser — it simply returns a ManualResult
 * with the URL and instructions for the user to access manually.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CndProvider } from '../../../src/providers/cnd/cnd.provider.js';
import type { BrowserService } from '../../../src/providers/base-scraper.js';
import { pino } from 'pino';
import { vi } from 'vitest';

const logger = pino({ level: 'silent' });

const mockBrowserService: BrowserService = {
  newPage: vi.fn(),
  close: vi.fn().mockResolvedValue(undefined),
};

describe('CndProvider', () => {
  let provider: CndProvider;

  beforeEach(() => {
    provider = new CndProvider(mockBrowserService, logger);
  });

  it('name is "cnd"', () => {
    expect(provider.name).toBe('cnd');
  });

  it('has exactly one requiredCredential: CNPJ (not sensitive)', () => {
    expect(provider.requiredCredentials).toHaveLength(1);
    const [cred] = provider.requiredCredentials;
    expect(cred.key).toBe('CNPJ');
    expect(cred.sensitive).toBe(false);
  });

  it('returns ManualResult with the CND URL', async () => {
    vi.spyOn(provider as object, 'copyTextToClipboard' as never).mockResolvedValue({ copied: true });
    const result = await provider.run({ CNPJ: '12345678000195' }, vi.fn());
    expect(result.type).toBe('manual');
    if (result.type === 'manual') {
      expect(result.url).toBe('https://servicos.receitafederal.gov.br/servico/certidoes/#/home/cnpj');
    }
  });

  it('formats the CNPJ in the result message', async () => {
    vi.spyOn(provider as object, 'copyTextToClipboard' as never).mockResolvedValue({ copied: true });
    const result = await provider.run({ CNPJ: '12345678000195' }, vi.fn());
    expect(result.type).toBe('manual');
    if (result.type === 'manual') {
      expect(result.message).toContain('12.345.678/0001-95');
    }
  });

  it('mentions clipboard copy success in the result message', async () => {
    vi.spyOn(provider as object, 'copyTextToClipboard' as never).mockResolvedValue({ copied: true });

    const result = await provider.run({ CNPJ: '12345678000195' }, vi.fn());

    expect(result.type).toBe('manual');
    if (result.type === 'manual') {
      expect(result.message).toContain('copiado para a sua area de transferencia');
    }
  });

  it('mentions clipboard fallback when copy fails', async () => {
    vi.spyOn(provider as object, 'copyTextToClipboard' as never).mockResolvedValue({ copied: false });

    const result = await provider.run({ CNPJ: '12345678000195' }, vi.fn());

    expect(result.type).toBe('manual');
    if (result.type === 'manual') {
      expect(result.message).toContain('Nao foi possivel copiar o CNPJ automaticamente');
      expect(result.message).toContain('12.345.678/0001-95');
    }
  });

  it('does not open a browser', async () => {
    vi.spyOn(provider as object, 'copyTextToClipboard' as never).mockResolvedValue({ copied: true });
    await provider.run({ CNPJ: '12345678000195' }, vi.fn());
    expect(mockBrowserService.newPage).not.toHaveBeenCalled();
  });
});
