/**
 * contas.menu.ts — Submenu: Conta de Luz, Aluguel, Condomínio, Todos, Voltar.
 *
 * T022 (US2): FR-004, FR-003 (number key selection), FR-014 (Todos)
 */

import terminal from 'terminal-kit';
import type { MenuItemType } from '../../providers/interfaces.js';

const term = terminal.terminal;

export interface SubMenuResult {
  action: MenuItemType | 'back';
  providerId?: string;
  providerIds?: string[];
}

const ITEMS = [
  '1  Conta de Luz',
  '2  Aluguel',
  '3  Condomínio',
  '4  Todos',
  '5  Voltar',
];

const PROVIDER_IDS = ['copel', 'aluguel', 'condominio'];

const MAPPING: SubMenuResult[] = [
  { action: 'provider', providerId: 'copel' },
  { action: 'provider', providerId: 'aluguel' },
  { action: 'provider', providerId: 'condominio' },
  { action: 'all', providerIds: PROVIDER_IDS },
  { action: 'back' },
];

export async function showContasMenu(): Promise<SubMenuResult> {
  term('\n');
  term.bold.white('  Contas\n\n');

  return new Promise<SubMenuResult>((resolve) => {
    const keyHandler = (name: string) => {
      const idx = parseInt(name, 10) - 1;
      if (!isNaN(idx) && idx >= 0 && idx < ITEMS.length) {
        term.removeListener('key', keyHandler);
        setImmediate(() => resolve(MAPPING[idx]));
      }
    };

    term.on('key', keyHandler);

    void term.singleColumnMenu(ITEMS, { cancelable: true }, (_err, res) => {
      term.removeListener('key', keyHandler);
      if (res.canceled) { term('\n'); process.exit(0); }
      resolve(MAPPING[res.selectedIndex]);
    });
  });
}
