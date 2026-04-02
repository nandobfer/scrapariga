/**
 * splash.ts — ASCII art splash screen using figlet + terminal-kit colors.
 *
 * FR-001: SCRAPARIGA displayed in large ASCII art, colored, before any menu.
 */

import figlet from 'figlet';
import terminal from 'terminal-kit';

const term = terminal.terminal;

export function renderSplash(): void {
  term.clear();

  const art = figlet.textSync('SCRAPARIGA', { font: 'Big' });
  term.cyan(art + '\n');
  term.gray('  automação de documentos e contas\n\n');
}
