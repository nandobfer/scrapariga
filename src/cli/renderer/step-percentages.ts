/**
 * step-percentages.ts — Maps provider stepIds to completion percentages.
 *
 * Used by MultiProgressRenderer to convert progress events into
 * percentage values for progress bars.
 */

export const STEP_PERCENTAGES: Record<string, Record<string, number>> = {
  copel: {
    login: 15,
    navigate: 25,
    list: 35,
    select: 50,
    extract: 65,
    download: 85,
    complete: 100,
  },
  aluguel: {
    login: 25,
    fetch: 55,
    download: 85,
    complete: 100,
  },
  condominio: {
    login: 20,
    fetch: 50,
    extract: 70,
    download: 85,
    complete: 100,
  },
};

/**
 * Get the percentage for a given provider and stepId.
 * Returns 100 if stepId is not found (assume complete).
 */
export function getStepPercentage(providerName: string, stepId: string): number {
  const providerSteps = STEP_PERCENTAGES[providerName];
  if (!providerSteps) return 100;
  return providerSteps[stepId] ?? 100;
}
