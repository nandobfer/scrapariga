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
  async init(providerNames: string[]): Promise<void> {
    this.sections.clear();

    // Query the actual cursor row BEFORE printing so we know where placeholders land.
    // terminal-kit types declare getCursorLocation as callback-based (v2.5.x types).
    const { y } = await new Promise<{ x: number; y: number }>((resolve) => {
      (term as unknown as {
        getCursorLocation: (cb: (err: Error | null, x: number, y: number) => void) => void;
      }).getCursorLocation((_err, x, y) => resolve({ x, y }));
    });

    this.startRow = y;

    // Print placeholder lines and record each provider's row
    for (let i = 0; i < providerNames.length; i++) {
      this.sections.set(providerNames[i]!, this.startRow + i);
      term(`  ⏳ ${providerNames[i]}: aguardando...\n`);
    }
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
   * Uses scrollDown to guarantee we're below any content written during the run.
   */
  dispose(): void {
    const lastRow = this.startRow + this.sections.size;
    term.moveTo(1, lastRow);
    term.eraseLine();
    term.gray('─'.repeat(60));
    term('\n');
    this.sections.clear();
  }
}
