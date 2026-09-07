import { beforeAll, describe, expect, it } from 'vitest'
import type { ProjectFile, SimulationResult } from '@system-design/model'
import { runSimulation } from '@system-design/simulation'
import { withExerciseParameter } from './exercise-project'
import { cachePressureExercise } from './cache-pressure'

const projectWithCapacity = (capacity: number) => withExerciseParameter(cachePressureExercise.createProject(), cachePressureExercise.parameters[0]!, capacity)
const runs = new Map<number, { project: ProjectFile; result: SimulationResult }>()

beforeAll(async () => {
  for (const capacity of [8, 32, 64, 128]) {
    const project = projectWithCapacity(capacity)
    runs.set(capacity, { project, result: await runSimulation(project, `cache-pressure-${capacity}`) })
  }
})

describe('cache pressure learning scenario', () => {
  it.each([8, 32])('exposes excessive database reads and latency with %i cache entries', (capacity) => {
    const { project, result } = runs.get(capacity)!
    const evaluation = cachePressureExercise.evaluate(project, result)
    expect(evaluation.status).toBe('fail')
    expect(evaluation.checks.find((check) => check.id === 'evidence')?.status).toBe('pass')
    expect(evaluation.checks.find((check) => check.id === 'cache-evidence')?.status).toBe('pass')
    expect(evaluation.checks.find((check) => check.id === 'cache-hits')?.status).toBe('fail')
    expect(evaluation.checks.find((check) => check.id === 'database-load')?.status).toBe('fail')
    expect(evaluation.metrics.cacheEvictions).toBeGreaterThan(0)
    expect(evaluation.metrics.databaseMaxQueue).toBeGreaterThan(0)
    expect(evaluation.metrics.latencyP95Ms).toBeGreaterThan(50)
    expect(result.summary.completedRequests).toBe(2_000)
    expect(result.warnings).toEqual([])
  })

  it.each([64, 128])('accepts %i entries from real hit, database and latency evidence', (capacity) => {
    const { project, result } = runs.get(capacity)!
    const evaluation = cachePressureExercise.evaluate(project, result)
    expect(evaluation.status).toBe('pass')
    expect(evaluation.metrics.cacheHitRate).toBeGreaterThanOrEqual(0.85)
    expect(evaluation.metrics.databaseReadRatio).toBeLessThanOrEqual(0.15)
    expect(evaluation.metrics.latencyP95Ms).toBeLessThanOrEqual(50)
    expect(evaluation.metrics.cacheEvictions).toBe(0)
    expect(result.summary).toMatchObject({ generatedRequests: 2_000, completedRequests: 2_000, failedRequests: 0 })
  })

  it('reduces actual database visits while retaining cold misses and the original key universe', () => {
    const baseline = runs.get(8)!
    const larger = runs.get(64)!
    const baselineEvaluation = cachePressureExercise.evaluate(baseline.project, baseline.result)
    const largerEvaluation = cachePressureExercise.evaluate(larger.project, larger.result)
    const reads = larger.result.events.filter((event) => event.type === 'database-read')
    const misses = larger.result.events.filter((event) => event.type === 'cache-miss')
    const hits = larger.result.events.filter((event) => event.type === 'cache-hit')
    expect(largerEvaluation.metrics.databaseReads).toBeLessThan(baselineEvaluation.metrics.databaseReads!)
    expect(largerEvaluation.metrics.databaseReads).toBe(reads.length)
    expect(reads.length).toBe(misses.length)
    expect(reads.length + hits.length).toBe(larger.result.summary.generatedRequests)
    expect(new Set(reads.map((event) => event.attributes.key)).size).toBe(64)
    // Successful miss results fill the cache; concurrent misses are not coalesced.
    expect(reads.length).toBeGreaterThan(64)
    expect(larger.result.events.find((event) => event.type === 'cache-miss')!.timestampMs).toBe(0)
    expect(larger.result.events.find((event) => event.type === 'cache-hit')!.timestampMs).toBeGreaterThan(reads[0]!.timestampMs)
    expect(larger.result.events.filter((event) => event.type === 'database-written')).toHaveLength(0)
  })

  it('does not require a unique capacity or claim that excess entries remove cold-start reads', () => {
    const first = runs.get(64)!
    const second = runs.get(128)!
    expect(cachePressureExercise.evaluate(first.project, first.result).status).toBe('pass')
    expect(cachePressureExercise.evaluate(second.project, second.result).status).toBe('pass')
    expect(cachePressureExercise.evaluate(first.project, first.result).metrics.databaseReads).toBe(
      cachePressureExercise.evaluate(second.project, second.result).metrics.databaseReads,
    )
  })

  it('reproduces the same events and learning evidence for the same configuration and seed', async () => {
    const { project, result } = runs.get(64)!
    const replay = await runSimulation(project, result.runId)
    expect({ ...replay, wallClockDurationMs: 0 }).toEqual({ ...result, wallClockDurationMs: 0 })
    expect(cachePressureExercise.evaluate(project, replay)).toEqual(cachePressureExercise.evaluate(project, result))
  })
})

describe('cache pressure evidence boundaries', () => {
  it.each([
    ['arrival rate', (project: ProjectFile) => { project.experiments[0]!.workloads[0]!.requestsPerSecond = 10 }],
    ['key universe', (project: ProjectFile) => { project.topology.nodes.find((node) => node.type === 'cache')!.config.keySpaceSize = 1 }],
    ['TTL', (project: ProjectFile) => { project.topology.nodes.find((node) => node.type === 'cache')!.config.ttlMs = 1_000 }],
    ['database capacity', (project: ProjectFile) => { project.topology.nodes.find((node) => node.type === 'database')!.config.maxConnections = 100 }],
    ['read demand', (project: ProjectFile) => { project.topology.nodes.find((node) => node.type === 'database')!.config.writeRatio = 1 }],
    ['miss route', (project: ProjectFile) => { project.topology.edges.pop() }],
  ] as const)('rejects changing the fixed %s', (_name, change) => {
    const project = projectWithCapacity(64)
    change(project)
    const evaluation = cachePressureExercise.evaluate(project, runs.get(64)!.result)
    expect(evaluation.status).toBe('fail')
    expect(evaluation.checks.find((check) => check.id === 'constraints')?.status).toBe('fail')
  })

  it('does not pass a larger cache without a run', () => {
    expect(cachePressureExercise.evaluate(projectWithCapacity(128)).status).toBe('inconclusive')
  })

  it('rejects reusing a passing run from another entry capacity even when request concurrency matches', () => {
    const evaluation = cachePressureExercise.evaluate(projectWithCapacity(128), runs.get(64)!.result)
    expect(evaluation.status).toBe('inconclusive')
    expect(evaluation.checks.find((check) => check.id === 'cache-evidence')?.status).toBe('inconclusive')
  })

  it.each([
    ['cache hits', (result: SimulationResult) => { result.events = result.events.filter((event) => event.type !== 'cache-hit') }],
    ['database reads', (result: SimulationResult) => { result.events = result.events.filter((event) => event.type !== 'database-read') }],
    ['reported hit rate', (result: SimulationResult) => { result.nodes.find((node) => node.nodeType === 'cache')!.details!.cacheHitRate = 1 }],
    ['reported cache occupancy', (result: SimulationResult) => { result.events.find((event) => event.type === 'node-snapshot' && event.nodeId === 'practice-cache')!.attributes.cacheOccupancy = 0 }],
    ['run identity', (result: SimulationResult) => { result.events[0]!.runId = 'another-run' }],
  ] as const)('does not pass inconsistent or missing %s', (_name, damage) => {
    const { project, result } = runs.get(64)!
    const incomplete = structuredClone(result)
    damage(incomplete)
    expect(cachePressureExercise.evaluate(project, incomplete).status).toBe('inconclusive')
  })

  it.each([
    ['request budget', (project: ProjectFile) => { project.experiments[0]!.simulation.maxRequests = 50 }],
    ['trace retention', (project: ProjectFile) => { project.experiments[0]!.simulation.traceLimit = 5 }],
    ['observation duration', (project: ProjectFile) => { project.experiments[0]!.simulation.durationSeconds = 1 }],
  ] as const)('does not pass real runs truncated by %s', async (_name, truncate) => {
    const expected = projectWithCapacity(64)
    const shortened = structuredClone(expected)
    truncate(shortened)
    const result = await runSimulation(shortened)
    expect(cachePressureExercise.evaluate(expected, result).status).toBe('inconclusive')
  })

  it('does not mistake failed database reads for a useful load reduction', async () => {
    const expected = projectWithCapacity(64)
    const failing = structuredClone(expected)
    failing.topology.nodes.find((node) => node.type === 'database')!.config.errorRate = 1
    const result = await runSimulation(failing)
    expect(result.summary.failedRequests).toBeGreaterThan(0)
    expect(cachePressureExercise.evaluate(expected, result).status).not.toBe('pass')
  })
})
