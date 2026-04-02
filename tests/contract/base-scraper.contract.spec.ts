/**
 * base-scraper.contract.spec.ts — Contract tests for BaseScraper.
 *
 * T017 (US5): Verifies DemoProvider satisfies the BaseScraper contract:
 *   (a) instantiable
 *   (b) has name and requiredCredentials
 *   (c) run() completes and returns a result with type 'file'
 *   (d) emitProgress is called during run
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { BrowserService } from '../../src/providers/base-scraper.js';
import { DemoProvider } from '../../src/providers/demo/demo.provider.js';
import type { ProgressEvent } from '../../src/providers/interfaces.js';
import { pino } from 'pino';
import fs from 'node:fs/promises';

// Minimal BrowserService mock — DemoProvider overrides run() so this is never called
const mockBrowserService: BrowserService = {
  newPage: vi.fn(),
  close: vi.fn(),
};

const logger = pino({ level: 'silent' });

describe('BaseScraper contract — DemoProvider', () => {
  let provider: DemoProvider;
  const events: ProgressEvent[] = [];

  beforeEach(() => {
    provider = new DemoProvider(mockBrowserService, logger);
    events.length = 0;
    delete process.env['DEMO_FAIL_ON'];
  });

  afterEach(async () => {
    // Clean up any demo files created during tests
    await fs.rm('documents/documento-demo', { recursive: true, force: true });
  });

  it('(a) is instantiable', () => {
    expect(provider).toBeDefined();
  });

  it('(b) has name and requiredCredentials defined', () => {
    expect(typeof provider.name).toBe('string');
    expect(provider.name.length).toBeGreaterThan(0);
    expect(Array.isArray(provider.requiredCredentials)).toBe(true);
  });

  it('(c) run() returns a ScraperResult with type "file" on success', async () => {
    const result = await provider.run({}, (e) => events.push(e));
    expect(result.type).toBe('file');
  });

  it('(d) emitProgress is called for each step (login, fetch, download)', async () => {
    await provider.run({}, (e) => events.push(e));

    const stepIds = events.map((e) => e.stepId);
    expect(stepIds).toContain('login');
    expect(stepIds).toContain('fetch');
    expect(stepIds).toContain('download');
  });

  it('(e) each step emits at least a pending and a success event', async () => {
    await provider.run({}, (e) => events.push(e));

    for (const stepId of ['login', 'fetch', 'download']) {
      const stepEvents = events.filter((e) => e.stepId === stepId);
      expect(stepEvents.some((e) => e.status === 'pending')).toBe(true);
      expect(stepEvents.some((e) => e.status === 'success')).toBe(true);
    }
  });
});
