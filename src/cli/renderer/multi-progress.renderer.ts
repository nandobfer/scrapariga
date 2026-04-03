/**
 * multi-progress.renderer.ts — Simple text-based parallel progress display.
 */

import terminal from 'terminal-kit';
import type { ProgressEvent } from '../../providers/interfaces.js';
import { getStepPercentage } from './step-percentages.js';

const term = terminal.terminal;

const PROVIDER_ICONS: Record<string, string> = {
  copel: '⚡',
  aluguel: '🏠',
  condominio: '🏢',
};

const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  copel: 'Conta de Luz',
  aluguel: 'Aluguel',
  condominio: 'Condomínio',
};

interface ProviderProgressState {
  name: string;
  displayName: string;
  icon: string;
  currentLabel: string;
  status: 'pending' | 'running' | 'success' | 'error' | 'warning';
  percentage: number;
}

export class MultiProgressRenderer {
  private states: Map<string, ProviderProgressState> = new Map();
  private providerOrder: string[] = [];
  private renderInterval: NodeJS.Timeout | null = null;
  private linesReserved = 0;

  /**
   * Initialize progress tracking for each provider.
   */
  init(providerNames: string[]): void {
    this.states.clear();
    this.providerOrder = providerNames;
    this.linesReserved = providerNames.length;

    term('\n');
    term.bold.white('  Executando em paralelo...\n\n');

    // Initialize states
    for (const name of providerNames) {
      const icon = PROVIDER_ICONS[name] ?? '📄';
      const displayName = PROVIDER_DISPLAY_NAMES[name] ?? name;

      this.states.set(name, {
        name,
        displayName,
        icon,
        currentLabel: 'Aguardando...',
        status: 'pending',
        percentage: 0,
      });
    }

    // Reserve space (print empty lines once)
    for (let i = 0; i < providerNames.length; i++) {
      term('\n');
    }

    // Initial render
    this.render();

    // Start periodic rendering (every 150ms)
    this.renderInterval = setInterval(() => this.render(), 150);
  }

  /**
   * Update progress for a specific provider.
   */
  update(providerName: string, event: ProgressEvent): void {
    const state = this.states.get(providerName);
    if (!state) return;

    const percentage = getStepPercentage(providerName, event.stepId);

    state.percentage = percentage;
    state.currentLabel = event.label;
    state.status = event.status;
  }

  /**
   * Render all progress bars by moving up and overwriting.
   */
  private render(): void {
    // Save cursor, move to start
    term.saveCursor();
    
    // Move cursor up to start of reserved area
    for (let i = 0; i < this.linesReserved; i++) {
      term.up(1);
    }
    term.column(1); // Move to start of line

    // Render each line
    for (const name of this.providerOrder) {
      const state = this.states.get(name);
      
      term.eraseLine();
      
      if (state) {
        // Build the line content
        const statusIcon = this.getStatusIcon(state.status);
        const progressBar = this.makeProgressBar(state.percentage);
        const pct = state.percentage.toString().padStart(3);
        const label = state.currentLabel.substring(0, 20).padEnd(20);

        term(`  ${state.icon} ${state.displayName.padEnd(15)} ${statusIcon} ${pct}% ${progressBar} ${label}`);
      }
      
      term.down(1);
      term.column(1);
    }
    
    term.restoreCursor();
  }

  /**
   * Clean up interval and add separator.
   */
  dispose(): void {
    if (this.renderInterval) {
      clearInterval(this.renderInterval);
      this.renderInterval = null;
    }

    // Move past the progress area
    term('\n');
    term.gray('─'.repeat(70));
    term('\n\n');
  }

  private getStatusIcon(status: ProviderProgressState['status']): string {
    switch (status) {
      case 'pending':
        return '⏳';
      case 'running':
        return '⏳';
      case 'success':
        return '✅';
      case 'error':
        return '❌';
      case 'warning':
        return '⚠️';
    }
  }

  private makeProgressBar(percentage: number): string {
    const barLength = 35;
    const filled = Math.round((percentage / 100) * barLength);
    const empty = barLength - filled;
    return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;
  }
}
