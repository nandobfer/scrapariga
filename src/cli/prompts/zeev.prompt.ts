/**
 * zeev.prompt.ts — Preflight da CLI para o provider Zeev.
 *
 * Resolve (ou solicita) os dois anexos que o usuário informa/baixa fora do
 * fluxo do navegador:
 *   - NFS-e: mais recente de `documents/nfse/` (mês atual); senão, prompt.
 *   - CND:   mais recente de `documents/cnd/` (ou do output do CndProvider);
 *            senão, executa o CndProvider e usa o PDF baixado; por fim, prompt.
 */

import path from 'node:path';
import { spawn } from 'node:child_process';
import terminal from 'terminal-kit';
import type { Logger } from 'pino';
import {
  NFSE_DIR,
  CND_DIR,
  resolveLatestNfsePdf,
  resolveLatestCndPdf,
} from '../../providers/zeev/nfse-files.js';
import { CndProvider } from '../../providers/cnd/cnd.provider.js';
import { PlaywrightBrowserService } from '../../core/browser.service.js';

const term = terminal.terminal;

export interface ZeevPaths {
  nfsePath: string;
  cndPath: string;
}

/**
 * Returns the NFS-e and CND paths for the Zeev submission, or undefined when the
 * user cancels an interactive prompt.
 */
export async function prepareZeevPaths(
  credentials: Record<string, string>,
  logger: Logger,
): Promise<ZeevPaths | undefined> {
  const nfsePath = await resolveNfsePath();
  if (!nfsePath) return undefined;

  const cndPath = await resolveCndPath(credentials, logger);
  if (!cndPath) return undefined;

  return { nfsePath, cndPath };
}

// ─── NFS-e ────────────────────────────────────────────────────────────────────

async function resolveNfsePath(): Promise<string | undefined> {
  const found = await resolveLatestNfsePdf();
  if (found) {
    term.green(`\n  📄 NFS-e: ${found}\n`);
    return found;
  }

  term.yellow(`\n  Nenhum PDF da NFS-e do mês atual em ${NFSE_DIR}\n`);
  return promptPath('Caminho do PDF da NFS-e');
}

// ─── CND ──────────────────────────────────────────────────────────────────────

async function resolveCndPath(
  credentials: Record<string, string>,
  logger: Logger,
): Promise<string | undefined> {
  const found = await resolveLatestCndPdf();
  if (found) {
    term.green(`\n  📄 CND: ${found}\n`);
    return found;
  }

  term.yellow(`\n  Nenhuma CND encontrada. Baixando a certidão...\n`);

  const provider = new CndProvider(new PlaywrightBrowserService(), logger);
  const result = await provider.run({ CNPJ: credentials['CNPJ'] ?? '' }, () => undefined);

  if (result.type === 'file') {
    term.green(`\n  📄 CND baixada: ${result.filePath}\n`);
    return result.filePath;
  }

  if (result.type === 'manual') {
    term.white(`\n  ${result.message}\n`);
    openExternal(result.url);
  } else if (result.type === 'error') {
    term.red(`\n  Falha ao baixar a CND: ${result.message}\n`);
  }

  term.yellow(`\n  Salve o PDF da CND em ${CND_DIR} e informe o caminho.\n`);
  return promptPath('Caminho do PDF da CND');
}

// ─── Prompt / helpers ─────────────────────────────────────────────────────────

async function promptPath(label: string): Promise<string | undefined> {
  term.bold(`\n  ${label}\n`);
  term.gray('  (deixe vazio para cancelar)\n');
  term('  > ');

  const value = await new Promise<string>((resolve, reject) => {
    term.inputField({}, (err, input) => {
      if (err || input === undefined) {
        reject(err ?? new Error('Input cancelado'));
        return;
      }
      resolve(input);
    });
  });
  term('\n');

  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return path.resolve(expandHome(trimmed));
}

function expandHome(p: string): string {
  const home = process.env['HOME'] ?? '';
  if (p === '~') return home;
  if (p.startsWith('~/')) return path.join(home, p.slice(2));
  return p;
}

function openExternal(url: string): void {
  const bin = process.platform === 'darwin' ? 'open' : 'xdg-open';
  try {
    spawn(bin, [url], { detached: true, stdio: 'ignore' }).unref();
  } catch {
    // Best-effort: the URL is also printed to the terminal.
  }
}
