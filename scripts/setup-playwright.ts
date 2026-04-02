#!/usr/bin/env tsx
/**
 * scripts/setup-playwright.ts
 *
 * Ensures Playwright's Chromium binary is downloaded and all required
 * OS-level shared libraries are present.
 *
 * Steps:
 *   1. Check if the Chromium binary exists — download it if not.
 *   2. Use `ldd` to detect missing shared libraries.
 *   3. If libs are missing, run `sudo node playwright install-deps chromium`.
 *      sudo handles authentication natively on the TTY (uses session cache when
 *      available, otherwise shows its own prompt — no password capturing needed).
 *
 * Usage:
 *   npm run playwright:setup
 *   npx tsx scripts/setup-playwright.ts
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

// ─── 1. Check / install Chromium binary ───────────────────────────────────

const execPath = chromium.executablePath();

if (!fs.existsSync(execPath)) {
  console.log('Playwright Chromium not found. Downloading...\n');
  const install = spawnSync(process.execPath, [
    path.resolve('node_modules', '.bin', 'playwright'),
    'install',
    'chromium',
  ], { stdio: 'inherit', shell: false });
  if (install.status !== 0) {
    process.stderr.write('\n❌  playwright install chromium failed.\n');
    process.exit(install.status ?? 1);
  }
} else {
  console.log(`✓ Chromium already installed at:\n  ${execPath}`);
}

// ─── 2. Detect missing system libraries via ldd ────────────────────────────

const binaryPath = chromium.executablePath();
const ldd = spawnSync('ldd', [binaryPath], { encoding: 'utf-8' });
const lddOutput = (ldd.stdout ?? '') + (ldd.stderr ?? '');

const missingLibs = lddOutput
  .split('\n')
  .filter((line) => line.includes('not found'))
  .map((line) => line.trim().split(/\s/)[0] ?? '')
  .filter(Boolean);

if (missingLibs.length === 0) {
  console.log('\n✓ All system libraries present. Playwright is ready.');
  process.exit(0);
}

console.log('\n⚠️  Missing system libraries detected:');
for (const lib of missingLibs) {
  console.log(`     ${lib}  →  not found`);
}
console.log('\n  Installing via apt (sudo required)...\n');

// ─── 3. Install OS dependencies — let sudo handle auth on the TTY ─────────

// Use absolute paths: sudo's restricted PATH doesn't include nvm/node binaries.
const nodeBin = process.execPath;
const playwrightBin = path.resolve('node_modules', '.bin', 'playwright');

const deps = spawnSync('sudo', [nodeBin, playwrightBin, 'install-deps', 'chromium'], {
  stdio: 'inherit', // sudo prompts directly on the TTY; no password capture needed
});

if (deps.status !== 0) {
  process.stderr.write('\n❌  Failed to install system dependencies.\n');
  process.stderr.write(`    Try manually: sudo ${nodeBin} ${playwrightBin} install-deps chromium\n`);
  process.exit(deps.status ?? 1);
}

console.log('\n✓ System dependencies installed. Playwright is ready to use.');
