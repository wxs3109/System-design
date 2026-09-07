import { describe, expect, it } from 'vitest'
import type { SimulationResult } from '@system-design/model'
import { runSimulation } from '@system-design/simulation'
import { databaseBottleneckExercise } from './database-bottleneck'
import { withExerciseParameter } from './exercise-project'

const projectWith = (replicas: number, connections: number) => {
  let project = databaseBottleneckExercise.createProject('database-exercise-attempt')
  project = withExerciseParameter(project, databaseBottleneckExercise.parameters[0]!, replicas)
  return withExerciseParameter(project, databaseBottleneckExercise.parameters[1]!, connections)
}

const arrivalQueue = (result: SimulationResult, nodeId: string) => Math.max(...result.events
  .filter((event) => event.type === 'node-snapshot' && event.nodeId === nodeId && event.timestampMs > 0 && event.timestampMs < 6_000)
  .map((event) => Number(event.attributes.queueLength)))

describe('database bottleneck exercise', () => {
  it('creates independent projects and declares both adjustable resources', () => {
    const first = databaseBottleneckExercise.createProject('first-database-attempt')
    const second = databaseBottleneckExercise.createProject('second-database-attempt')
    first.topology.nodes[2]!.config.maxConnections = 16

    expect(second.topology.nodes[2]!.config.maxConnections).toBe(4)
    expect(second.id).toBe('second-database-attempt')
    expect(databaseBottleneckExercise.parameters.map((parameter) => parameter.id)).toEqual(['service-replicas', 'database-connections'])
    expect(databaseBottleneckExercise.flow).toEqual(['流量', 'API Service', 'Database'])
  })

  it('locates baseline accumulation in the database and proves that extra Service replicas do not improve it', async () => {
    const baseline = await runSimulation(projectWith(1, 4), 'db-baseline')
    const moreService = await runSimulation(projectWith(4, 4), 'more-service')

    expect(baseline.summary.completedRequests).toBe(600)
    expect(baseline.summary.failedRequests).toBe(0)
    expect(baseline.timeSeries.at(-1)?.queuedRequests).toBe(0)
    expect(arrivalQueue(baseline, 'db-practice-service')).toBe(0)
    expect(arrivalQueue(baseline, 'db-practice-database')).toBeGreaterThan(300)
    expect(baseline.summary.latencyP95Ms).toBeGreaterThan(1_000)
    expect(moreService.summary).toEqual(baseline.summary)
    expect(arrivalQueue(moreService, 'db-practice-database')).toBe(arrivalQueue(baseline, 'db-practice-database'))
    expect(databaseBottleneckExercise.evaluate(projectWith(1, 4), baseline).status).toBe('fail')
    expect(databaseBottleneckExercise.evaluate(projectWith(4, 4), moreService).status).toBe('fail')
  })

  it.each([[1, 12], [2, 12], [4, 12], [1, 16], [2, 16], [4, 16]])('meets SLOs with %i Service replicas and %i database connections', async (replicas, connections) => {
    const project = projectWith(replicas, connections)
    const result = await runSimulation(project, `db-${replicas}-${connections}`)

    expect(result.summary.completedRequests).toBe(600)
    expect(result.summary.failedRequests).toBe(0)
    expect(arrivalQueue(result, 'db-practice-database')).toBe(0)
    expect(arrivalQueue(result, 'db-practice-service')).toBe(0)
    expect(result.summary.latencyP95Ms).toBe(120)
    expect(databaseBottleneckExercise.evaluate(project, result).status).toBe('pass')
  })

  it.each([[1, 8], [2, 4], [2, 8], [4, 8]])('keeps %i Service replicas and %i database connections below the required capacity', async (replicas, connections) => {
    const project = projectWith(replicas, connections)
    const result = await runSimulation(project, `insufficient-${replicas}-${connections}`)

    expect(result.summary.completedRequests).toBe(600)
    expect(result.summary.failedRequests).toBe(0)
    expect(databaseBottleneckExercise.evaluate(project, result).status).toBe('fail')
  })

  it.each(['arrival-rate', 'query-time', 'service-time'] as const)('rejects changing the fixed %s', async (change) => {
    const project = projectWith(1, 12)
    if (change === 'arrival-rate') project.experiments[0]!.workloads[0]!.requestsPerSecond = 10
    else if (change === 'query-time') project.topology.nodes[2]!.config.queryTimeMs = 10
    else project.topology.nodes[1]!.config.serviceTimeMs = 1
    const result = await runSimulation(project, `changed-${change}`)

    expect(result.summary.failedRequests).toBe(0)
    const evaluation = databaseBottleneckExercise.evaluate(project, result)
    expect(evaluation.status).toBe('fail')
    expect(evaluation.checks.find((check) => check.id === 'constraints')?.status).toBe('fail')
  })

  it('cannot pass a truncated low-volume result even if it drains without failures', async () => {
    const original = projectWith(1, 12)
    const truncated = structuredClone(original)
    truncated.experiments[0]!.simulation.maxRequests = 100
    const result = await runSimulation(truncated, 'database-truncated')

    expect(result.summary.completedRequests).toBe(100)
    expect(result.summary.failedRequests).toBe(0)
    expect(result.timeSeries.at(-1)?.queuedRequests).toBe(0)
    expect(databaseBottleneckExercise.evaluate(truncated, result).status).not.toBe('pass')
    expect(databaseBottleneckExercise.evaluate(original, result).status).toBe('inconclusive')
  })

  it('requires complete evidence tied to both resource settings, scenario and seed', async () => {
    const project = projectWith(1, 12)
    const result = await runSimulation(project, 'database-complete')
    const incomplete: SimulationResult[] = [
      { ...result, scenarioId: 'different-project' },
      { ...result, seed: 'different-seed' },
      { ...result, timeSeries: result.timeSeries.slice(1) },
      { ...result, events: result.events.filter((event) => event.type !== 'node-snapshot') },
      { ...result, events: result.events.filter((event) => event.attributes.terminal !== true) },
      { ...result, summary: { ...result.summary, completedRequests: result.summary.completedRequests - 1 } },
    ]
    expect(databaseBottleneckExercise.evaluate(project).status).toBe('inconclusive')
    for (const partial of incomplete) expect(databaseBottleneckExercise.evaluate(project, partial).status).toBe('inconclusive')
    expect(databaseBottleneckExercise.evaluate(projectWith(1, 16), result).status).toBe('inconclusive')
    expect(databaseBottleneckExercise.evaluate(projectWith(2, 12), result).status).toBe('inconclusive')

    const moved = structuredClone(project)
    moved.topology.nodes[2]!.position = { x: 999, y: 1 }
    moved.topology.nodes[1]!.name = 'Renamed API'
    expect(databaseBottleneckExercise.evaluate(moved, result).status).toBe('pass')
  })
})
