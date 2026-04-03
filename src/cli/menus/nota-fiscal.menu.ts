/**
 * nota-fiscal.menu.ts — Submenu: CND, Comprovante de Pagamento, Todos, Voltar.
 *
 * T024 (US3): FR-005, FR-003 (number key selection), FR-014 (Todos)
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
  '1  Certidão Negativa de Débitos (CND)',
  '2  Comprovante de Pagamento',
  '3  Todos',
  '4  Voltar',
];

const PROVIDER_IDS = ['cnd', 'comprovante-pagamento'];

const MAPPING: SubMenuResult[] = [
  { action: 'provider', providerId: 'cnd' },
  { action: 'provider', providerId: 'comprovante-pagamento' },
  { action: 'all', providerIds: PROVIDER_IDS },
  { action: 'back' },
];

export async function showNotaFiscalMenu(): Promise<SubMenuResult> {
  term('\n');
  term.bold.white('  Nota Fiscal\n\n');

  return new Promise<SubMenuResult>((resolve) => {
    let numberSelected: SubMenuResult | null = null;

    const keyHandler = (name: string) => {
      const idx = parseInt(name, 10) - 1;
      if (!isNaN(idx) && idx >= 0 && idx < ITEMS.length) {
        numberSelected = MAPPING[idx];
        term.removeListener('key', keyHandler);
        menuController.stop(true);
      }
    };

    const menuController = term.singleColumnMenu(ITEMS, { cancelable: true }, (_err, res) => {
      term.removeListener('key', keyHandler);
      if (numberSelected) { term('\n'); resolve(numberSelected); return; }
      if (res.canceled) { term('\n'); process.exit(0); }
      resolve(MAPPING[res.selectedIndex]);
    }) as { stop: (erase: boolean) => void };

    term.on('key', keyHandler);
  });
}
