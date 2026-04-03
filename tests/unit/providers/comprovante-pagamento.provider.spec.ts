/**
 * comprovante-pagamento.provider.spec.ts — Unit tests for ComprovantePagamentoProvider.
 *
 * All external I/O is mocked:
 *   - rclone-sdk (createRCDClient)
 *   - child_process.spawn (rclone daemon)
 *   - fetch (daemon ping)
 *   - fs.mkdirSync, fs.statSync
 *   - BaseScraper.openDocument
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pino } from 'pino';
import type { BrowserService } from '../../../src/core/browser.service.js';

// ── Mocks ────────────────────────────────────────────────────────────────────

// Mock node:child_process before importing the provider
const mockKill = vi.fn();
const mockSpawn = vi.fn(() => ({ kill: mockKill, pid: 12345 }));
vi.mock('node:child_process', () => ({ spawn: mockSpawn }));

// Mock rclone-sdk
const mockPost = vi.fn();
vi.mock('rclone-sdk', () => ({
  default: vi.fn(() => ({ POST: mockPost })),
}));

// Mock node:fs (only the methods the provider calls)
vi.mock('node:fs', () => ({
  default: {
    mkdirSync: vi.fn(),
    statSync: vi.fn(() => ({ size: 98765 })),
  },
}));

// Import AFTER mocks are declared
const { ComprovantePagamentoProvider } = await import(
  '../../../src/providers/comprovante-pagamento/comprovante-pagamento.provider.js'
);

// ── Helpers ──────────────────────────────────────────────────────────────────

const mockBrowserService: BrowserService = { newPage: vi.fn(), close: vi.fn() };
const logger = pino({ level: 'silent' });

const DEFAULT_CREDENTIALS = {
  RCLONE_REMOTE: 'gdrive',
  RCLONE_COMPROVANTE_FOLDER: 'Documentos/Comprovantes',
};

/** Returns a provider instance with openDocument stubbed out */
function makeProvider() {
  const p = new ComprovantePagamentoProvider(mockBrowserService, logger);
  vi.spyOn(p as never, 'openDocument').mockResolvedValue(undefined);
  return p;
}

/** Preset mockPost for a successful list + copyfile flow */
function setupHappyPath(fileNames: string[]) {
  mockPost.mockImplementation((path: string) => {
    if (path === '/rc/noop') return Promise.resolve({ response: { ok: true } });
    if (path === '/operations/list') {
      return Promise.resolve({
        data: {
          list: fileNames.map((n) => ({ Name: n, IsDir: false, Path: n })),
        },
        error: undefined,
      });
    }
    if (path === '/operations/copyfile') {
      return Promise.resolve({ data: {}, error: undefined });
    }
    return Promise.resolve({ data: {}, error: undefined });
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('ComprovantePagamentoProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // By default, ping returns false (daemon not running) so provider spawns one
    global.fetch = vi.fn().mockRejectedValueOnce(new Error('ECONNREFUSED')).mockResolvedValue({
      ok: true,
    } as Response);
  });

  describe('happy path — daemon not running, single file', () => {
    it('spawns rclone daemon and kills it after run', async () => {
      setupHappyPath(['2026-03-20.png']);
      const provider = makeProvider();

      const result = await provider.run(DEFAULT_CREDENTIALS, () => undefined);

      expect(mockSpawn).toHaveBeenCalledWith(
        'rclone',
        ['rcd', '--rc-no-auth', '--rc-addr=localhost:5572'],
        expect.any(Object),
      );
      expect(mockKill).toHaveBeenCalled();
      expect(result.type).toBe('file');
    });

    it('returns FileResult with correct path and sizeBytes', async () => {
      setupHappyPath(['2026-03-20.png']);
      const provider = makeProvider();

      const result = await provider.run(DEFAULT_CREDENTIALS, () => undefined);

      expect(result.type).toBe('file');
      if (result.type === 'file') {
        expect(result.filePath).toContain('comprovante-pagamento');
        expect(result.filePath).toContain('2026-03-20.png');
        expect(result.mimeType).toBe('image/png');
        expect(result.sizeBytes).toBe(98765);
      }
    });

    it('emits pending → success progress events for all steps', async () => {
      setupHappyPath(['2026-03-20.png']);
      const provider = makeProvider();
      const events: Array<{ stepId: string; status: string }> = [];

      await provider.run(DEFAULT_CREDENTIALS, (e) => events.push(e));

      for (const stepId of ['connect', 'fetch', 'download']) {
        const byStep = events.filter((e) => e.stepId === stepId);
        expect(byStep.some((e) => e.status === 'pending')).toBe(true);
        expect(byStep.some((e) => e.status === 'success')).toBe(true);
      }
    });
  });

  describe('multiple files — picks the most recent', () => {
    it('selects the file with the latest date when multiple exist', async () => {
      setupHappyPath(['2026-01-15.png', '2026-03-20.png', '2025-12-01.png']);
      const provider = makeProvider();

      const result = await provider.run(DEFAULT_CREDENTIALS, () => undefined);

      expect(result.type).toBe('file');
      if (result.type === 'file') {
        expect(result.filePath).toContain('2026-03-20.png');
      }
    });
  });

  describe('daemon already running — does not spawn or kill', () => {
    it('reuses existing daemon without spawning a new one', async () => {
      // Ping succeeds immediately (daemon already up)
      global.fetch = vi.fn().mockResolvedValue({ ok: true } as Response);
      setupHappyPath(['2026-03-20.png']);
      const provider = makeProvider();

      await provider.run(DEFAULT_CREDENTIALS, () => undefined);

      expect(mockSpawn).not.toHaveBeenCalled();
      expect(mockKill).not.toHaveBeenCalled();
    });
  });

  describe('no files found', () => {
    it('returns ErrorResult with descriptive message', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: true } as Response);
      mockPost.mockImplementation((path: string) => {
        if (path === '/operations/list') {
          return Promise.resolve({ data: { list: [] }, error: undefined });
        }
        return Promise.resolve({ data: {}, error: undefined });
      });

      const provider = makeProvider();
      const result = await provider.run(DEFAULT_CREDENTIALS, () => undefined);

      expect(result.type).toBe('error');
      if (result.type === 'error') {
        expect(result.message).toMatch(/nenhum comprovante/i);
      }
    });

    it('kills the daemon even when an error occurs', async () => {
      // Daemon not running → will spawn
      global.fetch = vi.fn().mockRejectedValueOnce(new Error('ECONNREFUSED')).mockResolvedValue({
        ok: true,
      } as Response);
      mockPost.mockImplementation((path: string) => {
        if (path === '/operations/list') {
          return Promise.resolve({ data: { list: [] }, error: undefined });
        }
        return Promise.resolve({ data: {}, error: undefined });
      });

      const provider = makeProvider();
      await provider.run(DEFAULT_CREDENTIALS, () => undefined);

      expect(mockKill).toHaveBeenCalled();
    });
  });

  describe('list API error', () => {
    it('returns ErrorResult when operations/list returns an error', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: true } as Response);
      mockPost.mockImplementation((path: string) => {
        if (path === '/operations/list') {
          return Promise.resolve({ data: undefined, error: { error: 'permission denied' } });
        }
        return Promise.resolve({ data: {}, error: undefined });
      });

      const provider = makeProvider();
      const result = await provider.run(DEFAULT_CREDENTIALS, () => undefined);

      expect(result.type).toBe('error');
      if (result.type === 'error') {
        expect(result.message).toMatch(/erro ao listar/i);
      }
    });
  });
});
