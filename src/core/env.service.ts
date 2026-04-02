/**
 * env.service.ts — Environment variable read/write + interactive credential collection.
 *
 * Security (Constitution Principle IV):
 *   - Sensitive fields are NEVER logged as raw values.
 *   - pino `redact` masks credential keys in all log output.
 *   - Atomic .env write: write to .env.tmp → rename to .env (prevents corruption on Ctrl+C).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import terminal from 'terminal-kit';
import { pino } from 'pino';
import type { EnvCredential } from '../providers/interfaces.js';

// dotenv is a CommonJS module; use createRequire for ESM compatibility
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const dotenv = require('dotenv') as { config: (opts: { path: string }) => void };

const ENV_PATH = path.resolve(process.cwd(), '.env');
const ENV_TMP_PATH = path.resolve(process.cwd(), '.env.tmp');

const term = terminal.terminal;

export class EnvService {
  private readonly logger = pino({
    name: 'EnvService',
    level: process.env['LOG_LEVEL'] ?? 'info',
    redact: {
      paths: ['credential.value', 'value', 'rawValue'],
      censor: '[REDACTED]',
    },
  });

  constructor() {
    // Load .env into process.env on construction
    dotenv.config({ path: ENV_PATH });
  }

  /**
   * Read a value from process.env.
   * Returns undefined if not set or empty.
   */
  get(key: string): string | undefined {
    const val = process.env[key];
    return val && val.length > 0 ? val : undefined;
  }

  /**
   * Write a key=value pair to .env atomically.
   * If the key already exists, it is updated in place.
   * If the key is new, it is appended.
   * Uses write-to-tmp + rename to avoid corruption on interrupt.
   */
  async set(key: string, value: string): Promise<void> {
    let content = '';
    try {
      content = await fs.readFile(ENV_PATH, 'utf8');
    } catch {
      // .env does not exist yet — start empty
    }

    const keyRegex = new RegExp(`^${key}=.*$`, 'm');
    if (keyRegex.test(content)) {
      content = content.replace(keyRegex, `${key}=${value}`);
    } else {
      content = content.endsWith('\n') || content === ''
        ? `${content}${key}=${value}\n`
        : `${content}\n${key}=${value}\n`;
    }

    await fs.writeFile(ENV_TMP_PATH, content, 'utf8');
    await fs.rename(ENV_TMP_PATH, ENV_PATH);

    // Update the live process environment so subsequent reads see the new value
    process.env[key] = value;

    this.logger.info({ key }, 'Credential persisted to .env');
  }

  /**
   * Check which credentials from the list are missing in the current environment,
   * prompt the user interactively for each missing value, and persist all answers.
   *
   * Sensitive credentials use masked input (terminal-kit inputField with echoChar: '*').
   */
  async promptMissing(credentials: EnvCredential[]): Promise<Record<string, string>> {
    const result: Record<string, string> = {};

    for (const cred of credentials) {
      const existing = this.get(cred.key);
      if (existing) {
        result[cred.key] = existing;
        continue;
      }

      term.bold(`\n${cred.label}\n`);
      term.gray(`  ${cred.description}\n`);
      term(`  ${cred.key}: `);

      const value = await new Promise<string>((resolve, reject) => {
        term.inputField(
          { echoChar: cred.sensitive ? '*' : true },
          (err, input) => {
            if (err || input === undefined) {
              reject(new Error('Input cancelled'));
              return;
            }
            resolve(input);
          },
        );
      });

      term('\n');
      await this.set(cred.key, value);
      result[cred.key] = value;
    }

    return result;
  }
}
