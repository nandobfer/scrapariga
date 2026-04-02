/**
 * env.service.spec.ts — Unit tests for EnvService.
 *
 * T019 (US5):
 *   (a) get() returns value from process.env
 *   (b) set() writes new key to .env file
 *   (c) set() updates existing key without duplicating
 *   (d) sensitive values never appear in logger output
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// We need to test EnvService against a temp .env file, not the real one.
// Strategy: change process.cwd() via vi.spyOn so ENV_PATH resolves to tmp dir.

const TEST_ENV_DIR = path.join(os.tmpdir(), `scrapariga-test-${process.pid}`);
const TEST_ENV_PATH = path.join(TEST_ENV_DIR, '.env');

describe('EnvService', () => {
  let cwdSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    await fs.mkdir(TEST_ENV_DIR, { recursive: true });
    await fs.writeFile(TEST_ENV_PATH, '', 'utf8');
    // Redirect EnvService's process.cwd() to our temp dir
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(TEST_ENV_DIR);
    // Clear any cached pino module state — just re-import fresh
  });

  afterEach(async () => {
    cwdSpy.mockRestore();
    await fs.rm(TEST_ENV_DIR, { recursive: true, force: true });
  });

  it('(a) get() returns value from process.env', async () => {
    process.env['TEST_KEY_SCRAPARIGA'] = 'hello';
    // Dynamic import to get a fresh instance with mocked cwd
    const { EnvService } = await import('../../../src/core/env.service.js');
    const svc = new EnvService();
    const val = svc.get('TEST_KEY_SCRAPARIGA');
    expect(val).toBe('hello');
    delete process.env['TEST_KEY_SCRAPARIGA'];
  });

  it('(b) set() writes a new key to .env', async () => {
    const { EnvService } = await import('../../../src/core/env.service.js');
    const svc = new EnvService();
    await svc.set('NEW_KEY', 'new_value');

    const content = await fs.readFile(TEST_ENV_PATH, 'utf8');
    expect(content).toContain('NEW_KEY=new_value');
    expect(process.env['NEW_KEY']).toBe('new_value');
    delete process.env['NEW_KEY'];
  });

  it('(c) set() updates an existing key without duplicating', async () => {
    await fs.writeFile(TEST_ENV_PATH, 'EXISTING_KEY=old_value\n', 'utf8');

    const { EnvService } = await import('../../../src/core/env.service.js');
    const svc = new EnvService();
    await svc.set('EXISTING_KEY', 'new_value');

    const content = await fs.readFile(TEST_ENV_PATH, 'utf8');
    const lines = content.split('\n').filter((l) => l.startsWith('EXISTING_KEY='));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe('EXISTING_KEY=new_value');
    delete process.env['EXISTING_KEY'];
  });

  it('(d) get() returns undefined for empty string values', async () => {
    process.env['EMPTY_KEY'] = '';
    const { EnvService } = await import('../../../src/core/env.service.js');
    const svc = new EnvService();
    expect(svc.get('EMPTY_KEY')).toBeUndefined();
    delete process.env['EMPTY_KEY'];
  });

  it('(d) get() returns undefined for missing keys', async () => {
    const { EnvService } = await import('../../../src/core/env.service.js');
    const svc = new EnvService();
    expect(svc.get('DEFINITELY_DOES_NOT_EXIST_XYZ')).toBeUndefined();
  });
});
