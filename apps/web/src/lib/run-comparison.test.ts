import { describe, expect, it } from 'vitest'
import { createEmptyProject, createOrderSystemContractFixture, type ProjectFile, type SimulationResult, type TimeSeriesPoint } from '@system-design/model'
import type { SimulationRunRecord } from './local-history'
import { alignComparisonSeries, assessRunComparability, compareSimulationRuns } from './run-comparison'

const point = (timeSeconds: number, throughputPerSecond: number, latencyP95Ms = 10): TimeSeriesPoint => ({
  timeSeconds, throughputPerSecond, latencyP95Ms, completedRequests: throughputPerSecond * timeSeconds, failedRequests: 0, queuedRequests: 1,
})

const result = (runId: string, scenarioId: string, seed: string, throughput: number): SimulationResult => ({
  runId, scenarioId, seed, simulatedDurationMs: 2_000, wallClockDurationMs: 1,
  summary: {
    generatedRequests: 20, completedRequests: 18, failedRequests: 2, throughputPerSecond: throughput,
    errorRate: 0.1, latencyP50Ms: 8, latencyP95Ms: 12, latencyP99Ms: 16,
  },
  nodes: [{
    nodeId: 'service', nodeName: 'Service', nodeType: 'service', processedRequests: 18, failedRequests: 2,
    utilization: 0.75, averageQueueLength: 2, maxQueueLength: 4, details: { cacheHitRate: 0.8, consumerLag: 3 },
  }],
  timeSeries: [point(1, throughput - 1), point(2, throughput + 1)],
  traces: [], events: [], spans: [], warnings: [],
})

const run = (runId: string, project: ProjectFile, throughput: number): SimulationRunRecord => ({
  runId, projectId: project.id, projectRevisionId: `${runId}-revision`, experimentId: project.activeExperimentId, createdAt: 1,
  projectSnapshot: structuredClone(project), result: result(runId, project.id, project.experiments[0]!.seed, throughput),
})

describe('run comparison', () => {
  it('allows topology changes while locking the exact experiment and seed', () => {
    const baselineProject = createEmptyProject('comparison-project')
    const candidateProject = structuredClone(baselineProject)
    candidateProject.name = 'Candidate design'
    candidateProject.topology.groups.push({ id: 'candidate-region', name: 'Candidate region', kind: 'region', nodeIds: [] })

    const comparison = compareSimulationRuns(run('baseline', baselineProject, 8), run('candidate', candidateProject, 10))
    expect(comparison.comparability).toEqual({ comparable: true, issues: [] })
    expect(comparison.metrics.find((metric) => metric.key === 'throughputPerSecond')).toMatchObject({
      baseline: 8, candidate: 10, delta: 2, deltaPercent: 0.25,
    })
    expect(comparison.metrics.find((metric) => metric.key === 'cacheHitRate')).toMatchObject({ baseline: 0.8, candidate: 0.8, delta: 0 })
    expect(comparison.series.throughputPerSecond).toEqual([
      { timeSeconds: 1, baseline: 7, candidate: 9, delta: 2 },
      { timeSeconds: 2, baseline: 9, candidate: 11, delta: 2 },
    ])
  })

  it('reports every experiment incompatibility and never calculates misleading deltas', () => {
    const baselineProject = createEmptyProject('comparison-project')
    const candidateProject = structuredClone(baselineProject)
    const experiment = candidateProject.experiments[0]!
    experiment.seed = 'different-seed'
    experiment.workloads.push({ id: 'workload', name: 'Load', sourceNodeId: 'traffic', requestsPerSecond: 10, startAtSeconds: 0, durationSeconds: 1, pattern: 'constant', requestBytes: 1 })
    experiment.faults.push({ id: 'fault', target: { kind: 'node', id: 'service' }, type: 'node-down', startAtSeconds: 1, durationSeconds: 1, enabled: true })
    experiment.simulation.durationSeconds = 40

    const comparison = compareSimulationRuns(run('baseline', baselineProject, 8), run('candidate', candidateProject, 10))
    expect(comparison.comparability.comparable).toBe(false)
    expect(comparison.comparability.issues.map((issue) => issue.code)).toEqual([
      'seed-mismatch', 'workload-mismatch', 'fault-mismatch', 'simulation-mismatch',
    ])
    expect(comparison.metrics).toEqual([])
    expect(comparison.series.throughputPerSecond).toEqual([])
  })

  it('locks operation-level workload mixes for business-aware runs', () => {
    const baselineProject = createOrderSystemContractFixture()
    const candidateProject = structuredClone(baselineProject)
    candidateProject.experiments[0]!.operationWorkloads[0]!.phases[1]!.requestsPerSecond = 200

    const comparison = assessRunComparability(run('baseline', baselineProject, 8), run('candidate', candidateProject, 10))
    expect(comparison).toEqual({
      comparable: false,
      issues: [{ code: 'workload-mismatch', message: 'Workload definitions differ.' }],
    })
  })

  it('rejects same-run, legacy and tampered result snapshots explicitly', () => {
    const project = createEmptyProject('comparison-project')
    const saved = run('baseline', project, 8)
    expect(assessRunComparability(saved, saved).issues.map((issue) => issue.code)).toEqual(['same-run'])

    const legacy: SimulationRunRecord = run('legacy', project, 8)
    delete legacy.projectSnapshot
    expect(assessRunComparability(saved, legacy).issues.map((issue) => issue.code)).toEqual(['missing-snapshot'])

    const tampered = run('tampered', project, 8)
    tampered.result.seed = 'not-the-experiment-seed'
    expect(assessRunComparability(saved, tampered).issues.map((issue) => issue.code)).toEqual(['result-seed-mismatch'])
  })

  it('aligns series by virtual timestamp instead of array position', () => {
    expect(alignComparisonSeries([point(1, 10), point(2, 20)], [point(2, 25), point(3, 30)], 'throughputPerSecond')).toEqual([
      { timeSeconds: 2, baseline: 20, candidate: 25, delta: 5 },
    ])
  })
})
