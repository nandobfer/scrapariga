/**
 * nfse-files.spec.ts — Unit tests for NFS-e / CND PDF resolution.
 *
 * node:fs/promises is fully mocked so no real files are touched.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('node:fs/promises', () => ({
  default: {
    readdir: vi.fn(),
    stat: vi.fn(),
  },
}));

const fsMock = (await import('node:fs/promises')).default as unknown as {
  readdir: ReturnType<typeof vi.fn>;
  stat: ReturnType<typeof vi.fn>;
};

const { resolveLatestNfsePdf, resolveLatestCndPdf } = await import(
  '../../../../src/providers/zeev/nfse-files.js'
);

const NOW = new Date('2026-10-06T12:00:00Z');
const oct = (day: number) => new Date(`2026-10-${String(day).padStart(2, '0')}T10:00:00Z`).getTime();
const sep = (day: number) => new Date(`2026-09-${String(day).padStart(2, '0')}T10:00:00Z`).getTime();

const file = (mtimeMs: number) => ({ isFile: () => true, mtimeMs });

beforeEach(() => {
  fsMock.readdir.mockReset();
  fsMock.stat.mockReset();
});

describe('resolveLatestNfsePdf', () => {
  it('returns the newest PDF modified in the current month', async () => {
    fsMock.readdir.mockImplementation(async (dir: string) => {
      if (dir.endsWith('nfse')) return ['a.pdf', 'b.pdf', 'last-month.pdf'];
      throw new Error('ENOENT');
    });
    fsMock.stat.mockImplementation(async (p: string) => {
      if (p.endsWith('a.pdf')) return file(oct(1));
      if (p.endsWith('b.pdf')) return file(oct(5));
      if (p.endsWith('last-month.pdf')) return file(sep(30));
      throw new Error('ENOENT');
    });

    await expect(resolveLatestNfsePdf(NOW)).resolves.toContain('b.pdf');
  });

  it('returns undefined when only older-month files exist', async () => {
    fsMock.readdir.mockImplementation(async (dir: string) =>
      dir.endsWith('nfse') ? ['last-month.pdf'] : (() => { throw new Error('ENOENT'); })(),
    );
    fsMock.stat.mockResolvedValue(file(sep(30)));

    await expect(resolveLatestNfsePdf(NOW)).resolves.toBeUndefined();
  });

  it('ignores non-pdf entries and unreadable files', async () => {
    fsMock.readdir.mockResolvedValue(['notes.txt', 'good.pdf', 'locked.pdf']);
    fsMock.stat.mockImplementation(async (p: string) => {
      if (p.endsWith('good.pdf')) return file(oct(3));
      throw new Error('EACCES');
    });

    await expect(resolveLatestNfsePdf(NOW)).resolves.toContain('good.pdf');
  });

  it('returns undefined when the directory does not exist', async () => {
    fsMock.readdir.mockRejectedValue(new Error('ENOENT'));
    await expect(resolveLatestNfsePdf(NOW)).resolves.toBeUndefined();
  });
});

describe('resolveLatestCndPdf', () => {
  it('picks the newest PDF across documents/cnd and the provider output dir', async () => {
    fsMock.readdir.mockImplementation(async (dir: string) => {
      if (dir.endsWith('cnd')) return ['manual.pdf'];
      if (dir.endsWith('certidao-negativa-debitos')) return ['provider.pdf'];
      throw new Error('ENOENT');
    });
    fsMock.stat.mockImplementation(async (p: string) => {
      if (p.endsWith('manual.pdf')) return file(oct(1));
      if (p.endsWith('provider.pdf')) return file(oct(4));
      throw new Error('ENOENT');
    });

    await expect(resolveLatestCndPdf()).resolves.toContain('provider.pdf');
  });

  it('returns undefined when no CND PDF exists anywhere', async () => {
    fsMock.readdir.mockRejectedValue(new Error('ENOENT'));
    await expect(resolveLatestCndPdf()).resolves.toBeUndefined();
  });
});
