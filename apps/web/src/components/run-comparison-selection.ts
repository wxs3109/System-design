import type { SimulationRunRecord } from '@/lib/local-history'

export const selectInitialComparisonRuns = (runs: readonly SimulationRunRecord[], activeRunId?: string) => {
  const candidate = runs.find((run) => run.runId === activeRunId) ?? runs[0]
  const baseline = runs.find((run) => run.runId !== candidate?.runId)
  return { baselineId: baseline?.runId ?? '', candidateId: candidate?.runId ?? '' }
}
