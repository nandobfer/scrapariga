/**
 * main.menu.ts — Main menu: Contas, Nota Fiscal, [Demo], Sair.
 *
 * FR-002: arrow-key navigation
 * FR-003: number key selection without Enter
 * T021: Demo entry visible only when NODE_ENV !== 'production'
 */

import terminal from 'terminal-kit';
import type { MenuItemType } from '../../providers/interfaces.js';

const term = terminal.terminal;

export interface MainMenuResult {
  action: MenuItemType;
  providerId?: string;
}

export async function showMainMenu(): Promise<MainMenuResult> {
  const showDemo = process.env['NODE_ENV'] !== 'production';

  const items = [
    '1  Contas',
    '2  Nota Fiscal',
    ...(showDemo ? ['3  Demo', '4  Sair'] : ['3  Sair']),
  ];

  const mapping: MainMenuResult[] = [
    { action: 'provider', providerId: '__contas__' },
    { action: 'provider', providerId: '__nota-fiscal__' },
    ...(showDemo
      ? [{ action: 'provider' as MenuItemType, providerId: 'demo' }, { action: 'exit' as MenuItemType }]
      : [{ action: 'exit' as MenuItemType }]),
  ];

  return new Promise<MainMenuResult>((resolve) => {
    // Number key shortcut handler
    const keyHandler = (name: string) => {
      const idx = parseInt(name, 10) - 1;
      if (!isNaN(idx) && idx >= 0 && idx < items.length) {
        term.removeListener('key', keyHandler);
        // Give terminal-kit time to clean up menu state
        setImmediate(() => resolve(mapping[idx]));
      }
    };

    term.on('key', keyHandler);

    void term.singleColumnMenu(items, { cancelable: false }, (_err, res) => {
      term.removeListener('key', keyHandler);
      resolve(mapping[res.selectedIndex]);
    });
  });
}
