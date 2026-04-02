/**
 * demo.provider.spec.ts — Unit tests for DemoProvider.
 *
 * T018 (US5):
 *   (a) normal run emits ProgressEvents with correct statuses
 *   (b) DEMO_FAIL_ON=download causes error result
 *   (c) mock BrowserService is used (no real Playwright)
 *   (d) ScraperResult is FileResult with path in expected format
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DemoProvider } from '../../../src/providers/demo/demo.provider.js';
import type { BrowserService } from '../../../src/providers/base-scraper.js';
import type { ProgressEvent } from '../../../src/providers/interfaces.js';
import { pino } from 'pino';
import fs from 'node:fs/promises';

const mockBrowserService: BrowserService = {
  newPage: vi.fn(),
  close: vi.fn(),
};

const logger = pino({ level: 'silent' });

describe('DemoProvider', () => {
  let provider: DemoProvider;

  beforeEach(() => {
    provider = new DemoProvider(mockBrowserService, logger);
    delete process.env['DEMO_FAIL_ON'];
  });

  afterEach(async () => {
    await fs.rm('documents/documento-demo', { recursive: true, force: true });
  });

  describe('normal execution', () => {
    it('(a) emits pending then success for each step', async () => {
      const events: ProgressEvent[] = [];
      await provider.run({}, (e) => events.push(e));

      for (const stepId of ['login', 'fetch', 'download']) {
        const stepEvents = events.filter((e) => e.stepId === stepId);
        const statuses = stepEvents.map((e) => e.status);
        expect(statuses).toContain('pending');
        expect(statuses).toContain('success');
      }
    });

    it('(c) never calls BrowserService (no real Playwright)', async () => {
      await provider.run({}, () => undefined);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockBrowserService.newPage).not.toHaveBeenCalled();
    });

    it('(d) returns FileResult with path matching ./documents/<slug>/<date>.pdf', async () => {
      const result = await provider.run({}, () => undefined);
      expect(result.type).toBe('file');

      if (result.type === 'file') {
        const normalized = result.filePath.replace(/\\/g, '/');
        expect(normalized).toContain('documents/documento-demo/');
        expect(normalized).toMatch(/\d{4}-\d{2}-\d{2}\.pdf$/);
      }
    });

    it('creates the PDF file on disk', async () => {
      const result = await provider.run({}, () => undefined);
      if (result.type === 'file') {
        const stat = await fs.stat(result.filePath);
        expect(stat.isFile()).toBe(true);
        expect(result.sizeBytes).toBeGreaterThan(0);
      }
    });
  });

  describe('DEMO_FAIL_ON env var', () => {
    it('(b) DEMO_FAIL_ON=download returns ErrorResult', async () => {
      process.env['DEMO_FAIL_ON'] = 'download';
      const result = await provider.run({}, () => undefined);
      expect(result.type).toBe('error');
      if (result.type === 'error') {
        expect(result.message).toContain('DEMO_FAIL_ON=download');
      }
    });

    it('DEMO_FAIL_ON=login returns ErrorResult', async () => {
      process.env['DEMO_FAIL_ON'] = 'login';
      const result = await provider.run({}, () => undefined);
      expect(result.type).toBe('error');
    });

    it('DEMO_FAIL_ON=fetch returns ErrorResult', async () => {
      process.env['DEMO_FAIL_ON'] = 'fetch';
      const result = await provider.run({}, () => undefined);
      expect(result.type).toBe('error');
    });
  });

  it('requiredCredentials is an empty array', () => {
    expect(provider.requiredCredentials).toEqual([]);
  });
});
