/**
 * test-cnd-provider.ts — Manual E2E runner for CndProvider (dev only).
 *
 * Run: npx tsx scripts/test-cnd-provider.ts
 */
import 'dotenv/config';
import { pino } from 'pino';
import { CndProvider } from '../src/providers/cnd/cnd.provider.js';
import { PlaywrightBrowserService } from '../src/core/browser.service.js';

async function main(): Promise<void> {
  const logger = pino({ level: 'info' });
  const provider = new CndProvider(new PlaywrightBrowserService(), logger);

  const result = await provider.run({ CNPJ: process.env['CNPJ'] ?? '' }, (e) => {
    process.stdout.write(`[progress] ${e.status.padEnd(7)} ${e.label}\n`);
  });

  process.stdout.write(`\n=== RESULT ===\n${JSON.stringify(result, null, 2)}\n`);
}

main().catch((err) => {
  console.error('FAILED', err);
  process.exit(1);
});
