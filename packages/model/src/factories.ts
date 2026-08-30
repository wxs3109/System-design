import type { Scenario } from './schema'

export const createEmptyScenario = (id = 'untitled-system'): Scenario => ({
  schemaVersion: 1,
  id,
  name: 'Untitled system',
  seed: 'system-design',
  nodes: [],
  edges: [],
  workloads: [],
  faults: [],
  simulation: {
    durationSeconds: 30,
    sampleIntervalMs: 1_000,
    maxRequests: 100_000,
    traceLimit: 200,
    maxHops: 64,
  },
})
