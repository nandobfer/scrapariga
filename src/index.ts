/**
 * index.ts — Entry point for the SCRAPARIGA CLI.
 *
 * Flow: renderSplash → while(true) { showMainMenu → dispatch }
 * US1: splash + main loop
 * US5: wired after DemoProvider is registered (T021)
 */

import 'dotenv/config';
import { spawnSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pino } from 'pino';
import { chromium } from 'playwright';
import { renderSplash } from './cli/renderer/splash.js';
import { showMainMenu } from './cli/menus/main.menu.js';
import { showContasMenu } from './cli/menus/contas.menu.js';
import { showNotaFiscalMenu } from './cli/menus/nota-fiscal.menu.js';
import { EnvService } from './core/env.service.js';
import { ProviderFactory } from './core/provider-factory.js';
import { ProgressRenderer } from './cli/renderer/progress.renderer.js';
import { ResultRenderer } from './cli/renderer/result.renderer.js';
import { promptRetry } from './cli/renderer/retry.prompt.js';
import { DemoProvider } from './providers/demo/demo.provider.js';
import { CndProvider } from './providers/cnd/cnd.provider.js';
import { AluguelProvider } from './providers/aluguel/aluguel.provider.js';
import { PlaywrightBrowserService } from './core/browser.service.js';
import terminal from 'terminal-kit';

const term = terminal.terminal;

// ─── Logger ────────────────────────────────────────────────────────────────

export const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  name: 'scrapariga',
  transport:
    process.env['NODE_ENV'] !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } }
      : undefined,
});

// ─── Services ──────────────────────────────────────────────────────────────

const envService = new EnvService();
const factory = new ProviderFactory();
const progressRenderer = new ProgressRenderer();
const resultRenderer = new ResultRenderer();

// ─── Register providers ────────────────────────────────────────────────────

if (process.env['NODE_ENV'] !== 'production') {
  factory.register('demo', () => {
    const browser = new PlaywrightBrowserService();
    return new DemoProvider(browser, logger);
  });
}

factory.register('cnd', () => new CndProvider(new PlaywrightBrowserService(), logger));

factory.register('aluguel', () => new AluguelProvider(new PlaywrightBrowserService(), logger));

// ─── Execution helper ──────────────────────────────────────────────────────

async function executeProvider(providerId: string): Promise<void> {
  const provider = factory.create(providerId);
  const credentials = await envService.promptMissing(provider.requiredCredentials);

  await progressRenderer.init([provider.name]);

  let result = await provider.run(credentials, (event) => {
    progressRenderer.update(provider.name, event);
  });

  progressRenderer.dispose();

  // Retry loop: if result is error and user wants to retry
  while (result.type === 'error') {
    const shouldRetry = await promptRetry(result.message);
    if (!shouldRetry) break;

    await progressRenderer.init([provider.name]);
    result = await provider.run(credentials, (event) => {
      progressRenderer.update(provider.name, event);
    });
    progressRenderer.dispose();
  }

  await resultRenderer.render(result);
}

async function executeTodos(providerIds: string[]): Promise<void> {
  const providers = providerIds.map((id) => factory.create(id));
  const names = providers.map((p) => p.name);

  // Collect all credentials before starting any provider
  const allCredentials: Record<string, Record<string, string>> = {};
  for (const provider of providers) {
    allCredentials[provider.name] = await envService.promptMissing(
      provider.requiredCredentials,
    );
  }

  await progressRenderer.init(names);

  const errors: Array<{ name: string; message: string }> = [];

  for (const provider of providers) {
    try {
      const result = await provider.run(allCredentials[provider.name], (event) => {
        progressRenderer.update(provider.name, event);
      });
      if (result.type === 'error') {
        errors.push({ name: provider.name, message: result.message });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      progressRenderer.update(provider.name, {
        stepId: 'run',
        label: message,
        status: 'error',
      });
      errors.push({ name: provider.name, message });
    }
  }

  progressRenderer.dispose();

  if (errors.length > 0) {
    term('\n');
    term.red('─── Erros durante a execução ───\n');
    for (const e of errors) {
      term.red(`  ❌ ${e.name}: ${e.message}\n`);
    }
    term('\n');
  }
}

// ─── Playwright health check ──────────────────────────────────────────────

async function checkPlaywright(): Promise<void> {
  const binaryPath = chromium.executablePath();
  const binaryMissing = !fs.existsSync(binaryPath);

  let libsMissing = false;
  if (!binaryMissing) {
    const ldd = spawnSync('ldd', [binaryPath], { encoding: 'utf-8' });
    const output = (ldd.stdout ?? '') + (ldd.stderr ?? '');
    libsMissing = output.includes('not found');
  }

  if (!binaryMissing && !libsMissing) return;

  if (binaryMissing) {
    term.yellow('\n⚠️  Playwright Chromium não encontrado. Executando setup...\n');
  } else {
    term.yellow('\n⚠️  Dependências do sistema para o Playwright estão faltando. Executando setup...\n');
  }

  const setupScript = path.resolve('scripts/setup-playwright.ts');
  await new Promise<void>((resolve, reject) => {
    const child = spawn('npx', ['tsx', setupScript], { stdio: 'inherit', shell: false });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`playwright:setup encerrou com código ${String(code)}`));
    });
  });
}

// ─── Main loop ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  await checkPlaywright();

  // Clean exit on Ctrl+C — works during menus AND during Playwright scraping.
  // process.on('SIGINT') is preferred over terminal-kit's key events because
  // Playwright keeps process handles alive that block the default SIGINT behaviour.
  process.on('SIGINT', () => {
    term.grabInput(false);
    term('\nAté logo!\n');
    process.exit(0);
  });

  // When terminal-kit has input grabbed (raw mode), Ctrl+C becomes
  // byte 0x03 in stdin — SIGINT is never dispatched. This catches it.
  term.on('key', (name: string) => {
    if (name === 'CTRL_C') {
      term.grabInput(false);
      term('\nAté logo!\n');
      process.exit(0);
    }
  });

  renderSplash();

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const choice = await showMainMenu();

    if (choice.action === 'exit') {
      term('\nAté logo!\n');
      term.processExit(0);
    }

    if (choice.providerId === '__contas__') {
      const sub = await showContasMenu();
      if (sub.action === 'back') continue;
      if (sub.action === 'all') {
        await executeTodos(sub.providerIds ?? []);
      } else if (sub.action === 'provider' && sub.providerId) {
        if (factory.has(sub.providerId)) {
          await executeProvider(sub.providerId);
        } else {
          term.yellow(`\nProvedor "${sub.providerId}" ainda não implementado.\n`);
          await new Promise<void>((r) => setTimeout(r, 1500));
        }
      }
      continue;
    }

    if (choice.providerId === '__nota-fiscal__') {
      const sub = await showNotaFiscalMenu();
      if (sub.action === 'back') continue;
      if (sub.action === 'all') {
        await executeTodos(sub.providerIds ?? []);
      } else if (sub.action === 'provider' && sub.providerId) {
        if (factory.has(sub.providerId)) {
          await executeProvider(sub.providerId);
        } else {
          term.yellow(`\nProvedor "${sub.providerId}" ainda não implementado.\n`);
          await new Promise<void>((r) => setTimeout(r, 1500));
        }
      }
      continue;
    }

    if (choice.action === 'provider' && choice.providerId) {
      await executeProvider(choice.providerId);
    }
  }
}

main().catch((err: unknown) => {
  logger.error({ err }, 'Fatal error');
  process.exit(1);
});
