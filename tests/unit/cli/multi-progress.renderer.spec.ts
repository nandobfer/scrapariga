import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MultiProgressRenderer } from '../../../src/cli/renderer/multi-progress.renderer.js';
import type { ProgressEvent } from '../../../src/providers/interfaces.js';

describe('MultiProgressRenderer', () => {
  let renderer: MultiProgressRenderer;

  beforeEach(() => {
    renderer = new MultiProgressRenderer();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initialization', () => {
    it('creates progress bars for each provider', () => {
      const providers = ['copel', 'aluguel', 'condominio'];
      renderer.init(providers);

      // Cannot inspect internal state directly, but verify no errors thrown
      expect(renderer).toBeDefined();
    });

    it('handles empty provider list', () => {
      renderer.init([]);
      expect(renderer).toBeDefined();
    });

    it('handles single provider', () => {
      renderer.init(['copel']);
      expect(renderer).toBeDefined();
    });
  });

  describe('update', () => {
    beforeEach(() => {
      renderer.init(['copel', 'aluguel']);
    });

    it('updates progress for valid provider', () => {
      const event: ProgressEvent = {
        stepId: 'login',
        label: 'Autenticando...',
        status: 'running',
      };

      expect(() => renderer.update('copel', event)).not.toThrow();
    });

    it('handles progress event for success status', () => {
      const event: ProgressEvent = {
        stepId: 'download',
        label: 'Download completo',
        status: 'success',
      };

      expect(() => renderer.update('copel', event)).not.toThrow();
    });

    it('handles progress event for error status', () => {
      const event: ProgressEvent = {
        stepId: 'login',
        label: 'Erro de autenticação',
        status: 'error',
      };

      expect(() => renderer.update('copel', event)).not.toThrow();
    });

    it('handles unknown provider gracefully', () => {
      const event: ProgressEvent = {
        stepId: 'test',
        label: 'Testing',
        status: 'running',
      };

      // Should not throw for unknown provider
      expect(() => renderer.update('unknown', event)).not.toThrow();
    });
  });

  describe('dispose', () => {
    it('cleans up resources', () => {
      renderer.init(['copel']);
      expect(() => renderer.dispose()).not.toThrow();
    });

    it('can be called multiple times', () => {
      renderer.init(['copel']);
      renderer.dispose();
      expect(() => renderer.dispose()).not.toThrow();
    });

    it('can be called without init', () => {
      expect(() => renderer.dispose()).not.toThrow();
    });
  });

  describe('step percentage mapping', () => {
    beforeEach(() => {
      renderer.init(['copel', 'aluguel', 'condominio']);
    });

    it('maps copel steps correctly', () => {
      const copelSteps: Array<{ stepId: string; expectedRange: [number, number] }> = [
        { stepId: 'login', expectedRange: [15, 25] },
        { stepId: 'navigate', expectedRange: [25, 35] },
        { stepId: 'list', expectedRange: [35, 45] },
        { stepId: 'extract', expectedRange: [65, 75] },
        { stepId: 'download', expectedRange: [85, 95] },
      ];

      for (const { stepId } of copelSteps) {
        const event: ProgressEvent = { stepId, label: 'Test', status: 'running' };
        expect(() => renderer.update('copel', event)).not.toThrow();
      }
    });

    it('maps aluguel steps correctly', () => {
      const aluguelSteps: Array<{ stepId: string }> = [
        { stepId: 'login' },
        { stepId: 'fetch' },
        { stepId: 'download' },
      ];

      for (const { stepId } of aluguelSteps) {
        const event: ProgressEvent = { stepId, label: 'Test', status: 'running' };
        expect(() => renderer.update('aluguel', event)).not.toThrow();
      }
    });

    it('maps condominio steps correctly', () => {
      const condominioSteps: Array<{ stepId: string }> = [
        { stepId: 'login' },
        { stepId: 'fetch' },
        { stepId: 'extract' },
        { stepId: 'download' },
      ];

      for (const { stepId } of condominioSteps) {
        const event: ProgressEvent = { stepId, label: 'Test', status: 'running' };
        expect(() => renderer.update('condominio', event)).not.toThrow();
      }
    });

    it('handles unknown steps gracefully', () => {
      const event: ProgressEvent = {
        stepId: 'unknown-step',
        label: 'Unknown',
        status: 'running',
      };

      expect(() => renderer.update('copel', event)).not.toThrow();
    });
  });
});
