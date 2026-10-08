/**
 * cnd.provider.spec.ts — Unit tests for CndProvider.
 *
 * Covers both flows:
 *   - Assisted (WSL + Windows Chrome): drive the real Windows Chrome over CDP
 *     and save the PDF as a FileResult.
 *   - Manual fallback: copy the CNPJ and return the link as a ManualResult.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { CndProvider } from '../../../src/providers/cnd/cnd.provider.js';
import type { BrowserService } from '../../../src/providers/base-scraper.js';
import { pino } from 'pino';

const logger = pino({ level: 'silent' });

const mockBrowserService: BrowserService = {
  newPage: vi.fn(),
  close: vi.fn().mockResolvedValue(undefined),
};

type Loose = Record<string, unknown>;
const loose = (p: CndProvider): Loose => p as unknown as Loose;

/** A minimal but valid PDF header so file-type detects application/pdf. */
const PDF_BUFFER = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n');

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

  // ─── Manual fallback ─────────────────────────────────────────────────────────

  describe('manual fallback (no Windows Chrome)', () => {
    beforeEach(() => {
      vi.spyOn(loose(provider), 'resolveWindowsPaths' as never).mockResolvedValue(
        undefined as never,
      );
    });

    it('returns ManualResult with the CND URL', async () => {
      vi.spyOn(loose(provider), 'copyTextToClipboard' as never).mockResolvedValue({
        copied: true,
      } as never);
      const result = await provider.run({ CNPJ: '12345678000195' }, vi.fn());
      expect(result.type).toBe('manual');
      if (result.type === 'manual') {
        expect(result.url).toBe(
          'https://servicos.receitafederal.gov.br/servico/certidoes/#/home/cnpj',
        );
      }
    });

    it('formats the CNPJ in the result message', async () => {
      vi.spyOn(loose(provider), 'copyTextToClipboard' as never).mockResolvedValue({
        copied: true,
      } as never);
      const result = await provider.run({ CNPJ: '12345678000195' }, vi.fn());
      expect(result.type).toBe('manual');
      if (result.type === 'manual') {
        expect(result.message).toContain('12.345.678/0001-95');
      }
    });

    it('mentions clipboard copy success in the result message', async () => {
      vi.spyOn(loose(provider), 'copyTextToClipboard' as never).mockResolvedValue({
        copied: true,
      } as never);
      const result = await provider.run({ CNPJ: '12345678000195' }, vi.fn());
      expect(result.type).toBe('manual');
      if (result.type === 'manual') {
        expect(result.message).toContain('copiado para a sua area de transferencia');
      }
    });

    it('mentions the clipboard fallback when copy fails', async () => {
      vi.spyOn(loose(provider), 'copyTextToClipboard' as never).mockResolvedValue({
        copied: false,
      } as never);
      const result = await provider.run({ CNPJ: '12345678000195' }, vi.fn());
      expect(result.type).toBe('manual');
      if (result.type === 'manual') {
        expect(result.message).toContain('Nao foi possivel copiar o CNPJ automaticamente');
        expect(result.message).toContain('12.345.678/0001-95');
      }
    });

    it('does not open a browser', async () => {
      vi.spyOn(loose(provider), 'copyTextToClipboard' as never).mockResolvedValue({
        copied: true,
      } as never);
      await provider.run({ CNPJ: '12345678000195' }, vi.fn());
      expect(mockBrowserService.newPage).not.toHaveBeenCalled();
    });
  });

  // ─── Assisted flow (Windows Chrome over CDP) ─────────────────────────────────

  describe('assisted flow (Windows Chrome available)', () => {
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = await (await import('node:fs/promises')).mkdtemp(
        path.join(os.tmpdir(), 'cnd-spec-'),
      );

      vi.spyOn(loose(provider), 'resolveWindowsPaths' as never).mockResolvedValue({
        winTemp: 'C:\\Temp',
        wslTemp: tmpDir,
        chromeExe: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      } as never);
      vi.spyOn(loose(provider), 'installHelper' as never).mockResolvedValue(undefined as never);
      vi.spyOn(loose(provider), 'launchWindowsChrome' as never).mockResolvedValue(undefined as never);
      vi.spyOn(loose(provider), 'waitForCdp' as never).mockResolvedValue(undefined as never);
      vi.spyOn(loose(provider), 'closeWindowsChrome' as never).mockResolvedValue(undefined as never);
      vi.spyOn(loose(provider), 'openDocument' as never).mockResolvedValue(undefined as never);
      vi.spyOn(loose(provider), 'buildFilePath' as never).mockReturnValue(
        path.join(tmpDir, 'certidao.pdf') as never,
      );
    });

    it('saves the downloaded PDF and returns a FileResult', async () => {
      vi.spyOn(loose(provider), 'runHelper' as never).mockResolvedValue({
        ok: true,
        filePath: 'C:\\Temp\\scrapariga-cnd\\certidao.pdf',
        size: PDF_BUFFER.byteLength,
      } as never);
      vi.spyOn(loose(provider), 'readWindowsFile' as never).mockResolvedValue(
        PDF_BUFFER as never,
      );

      const result = await provider.run({ CNPJ: '12345678000195' }, vi.fn());

      expect(result.type).toBe('file');
      if (result.type === 'file') {
        expect(result.mimeType).toBe('application/pdf');
        expect(result.sizeBytes).toBe(PDF_BUFFER.byteLength);
        expect(result.filePath).toContain('certidao.pdf');
      }
    });

    it('returns an ErrorResult when the captcha is rejected (023)', async () => {
      vi.spyOn(loose(provider), 'runHelper' as never).mockResolvedValue({
        ok: false,
        errorCode: '023',
        message: 'captcha',
      } as never);

      const result = await provider.run({ CNPJ: '12345678000195' }, vi.fn());

      expect(result.type).toBe('error');
      if (result.type === 'error') {
        expect(result.message.toLowerCase()).toContain('captcha');
      }
    });

    it('closes the Chrome instance even when the helper fails', async () => {
      const closeSpy = vi
        .spyOn(loose(provider), 'closeWindowsChrome' as never)
        .mockResolvedValue(undefined as never);
      vi.spyOn(loose(provider), 'runHelper' as never).mockResolvedValue({
        ok: false,
        errorCode: '023',
      } as never);

      await provider.run({ CNPJ: '12345678000195' }, vi.fn());

      expect(closeSpy).toHaveBeenCalled();
    });
  });
});
