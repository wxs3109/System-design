import { describe, expect, it } from 'vitest'
import type { SimulationRunRecord } from '@/lib/local-history'
import { selectInitialComparisonRuns } from './run-comparison-selection'

const run = (runId: string) => ({ runId } as SimulationRunRecord)

describe('run comparison selection', () => {
  it('uses the active result as candidate and a different run as baseline', () => {
    expect(selectInitialComparisonRuns([run('latest'), run('older')], 'latest')).toEqual({ baselineId: 'older', candidateId: 'latest' })
  })

  it('falls back safely when history has fewer than two runs', () => {
    expect(selectInitialComparisonRuns([run('only')])).toEqual({ baselineId: '', candidateId: 'only' })
    expect(selectInitialComparisonRuns([])).toEqual({ baselineId: '', candidateId: '' })
  })
})
