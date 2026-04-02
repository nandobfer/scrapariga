/**
 * retry.prompt.ts — Prompt the user to retry after all automatic retries are exhausted.
 *
 * T016: After 3 failed attempts, ask "Tentar novamente? (s/n)"
 * Returns true if user chose to retry the full cycle.
 */

import terminal from 'terminal-kit';

const term = terminal.terminal;

export async function promptRetry(errorMessage: string): Promise<boolean> {
  term('\n');
  term.red(`❌ Falhou após todas as tentativas: ${errorMessage}\n`);
  term.white('   Tentar novamente? ');
  term.gray('(s/n) ');

  const yesNo = term.yesOrNo({ yes: ['y', 's'], no: ['n'] });
  const answer = await yesNo.promise;
  term('\n');
  return answer ?? false;
}
