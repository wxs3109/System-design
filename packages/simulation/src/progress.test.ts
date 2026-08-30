import { describe, expect, it } from 'vitest'
import { createEmptyScenario, createNode } from '@system-design/model'
import { runSimulation } from './engine'

describe('runtime progress batching', () => {
  it('emits bounded ordered event batches before the immutable result', async () => {
    const scenario = createEmptyScenario('progress')
    scenario.simulation.durationSeconds = 1
    scenario.nodes = [createNode('traffic', 'traffic', { x: 0, y: 0 }, 'load'), createNode('service', 'service', { x: 1, y: 0 })]
    scenario.edges = [{ id: 'edge', source: 'traffic', target: 'service', sourcePort: 'out', targetPort: 'in', weight: 1 }]
    scenario.workloads = [{ id: 'load', name: 'Load', sourceNodeId: 'traffic', requestsPerSecond: 10, startAtSeconds: 0, durationSeconds: 0.5, pattern: 'constant', requestBytes: 100 }]
    const batches: number[][] = []
    const progressRuns: string[] = []
    const result = await runSimulation(scenario, 'progress-run', { eventBatchSize: 10, onProgress: (progress) => { batches.push(progress.events.map((event) => event.sequence)); progressRuns.push(progress.runId) } })
    expect(batches.length).toBeGreaterThan(1)
    expect(batches.every((batch) => batch.length <= 10)).toBe(true)
    expect(batches.flat()).toEqual(result.events.map((event) => event.sequence))
    expect(progressRuns.every((runId) => runId === result.runId)).toBe(true)
    expect(result.events.map((event) => event.sequence)).toEqual([...result.events.keys()])
  })
})
