/**
 * progress.renderer.ts — Multi-task fixed-section progress UI.
 *
 * FR-014: Each provider run gets a fixed terminal section.
 * Uses terminal-kit cursor positioning (moveTo/saveCursor) so multiple
 * provider sections remain visible simultaneously during "Todos" execution.
 */

import terminal from 'terminal-kit';
import type { ProgressEvent } from '../../providers/interfaces.js';

const term = terminal.terminal;

const STATUS_EMOJI: Record<string, string> = {
  pending: '⏳',
  success: '✅',
  warning: '⚠️ ',
  error:   '❌',
};

export class ProgressRenderer {
  private sections: Map<string, number> = new Map(); // name → row
  private startRow = 0;

  /**
   * Reserve N terminal lines (one per provider) and record their row numbers.
   * Call this before starting any provider run.
   */
  init(providerNames: string[]): void {
    this.sections.clear();
    term.saveCursor();

    // Print a placeholder line for each provider
    for (const name of providerNames) {
      // Get current cursor row; terminal-kit rows are 1-based but we track by order
      term(`  ⏳ ${name}: aguardando...\n`);
    }

    // We'll track by offset from the first placeholder
    // Re-derive actual rows by counting back from current position
    // terminal-kit doesn't expose current row easily, so we use a simpler approach:
    // write all placeholders, save the final row, and work backwards
    const row = (term as unknown as { height: number }).height ?? 24;
    // Count back: after printing N lines we are at row currentRow,
    // so first section is at currentRow - N + 1
    const n = providerNames.length;
    // We print lines top-to-bottom; after writing them, cursor is below last line
    // We don't have a reliable way to get the exact row without term.getCursorLocation
    // Use a line-tracking strategy: track relative offsets
    for (let i = n - 1; i >= 0; i--) {
      this.sections.set(providerNames[i], row - (n - 1 - i));
    }
    this.startRow = row - n + 1;
  }

  /**
   * Update the fixed section for a given provider with the latest ProgressEvent.
   */
  update(providerName: string, event: ProgressEvent): void {
    const row = this.sections.get(providerName);
    if (row === undefined) return;

    const emoji = STATUS_EMOJI[event.status] ?? '⏳';
    const retryInfo =
      event.attempt !== undefined
        ? ` (tentativa ${event.attempt}/${event.maxAttempts ?? 3})`
        : '';
    const line = `  ${emoji} ${providerName}: [${event.stepId}] ${event.label}${retryInfo}`;

    // Move to the right row, clear the line, rewrite
    term.moveTo(1, row);
    term.eraseLine();

    switch (event.status) {
      case 'success': term.green(line); break;
      case 'warning': term.yellow(line); break;
      case 'error':   term.red(line); break;
      default:        term.white(line); break;
    }
  }

  /**
   * Move cursor below all sections and print a separator.
   */
  dispose(): void {
    const maxRow = Math.max(...this.sections.values(), this.startRow);
    term.moveTo(1, maxRow + 1);
    term.gray('─'.repeat(60) + '\n');
    this.sections.clear();
  }
}
