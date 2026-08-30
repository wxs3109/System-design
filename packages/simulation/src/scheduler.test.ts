import { describe, expect, it } from 'vitest'
import { createRegisteredNode } from '@system-design/components'
import { createEmptyProject, createScheduledReportContractFixture, type ProjectFile, type SchedulerConfig } from '@system-design/model'
import { runSimulation } from './engine'

const connection = (id: string, source: string, target: string) => ({
  id, source, target, sourcePort: 'out', targetPort: 'in', weight: 1,
  sourceSemantic: 'request' as const, targetSemantic: 'request' as const, routingMode: 'weighted-one' as const,
})

const scheduledService = (id: string, config: Partial<SchedulerConfig> = {}, serviceTimeMs = 50): ProjectFile => {
  const project = createEmptyProject(id)
  project.name = 'Scheduled maintenance'
  const scheduler = createRegisteredNode('scheduler', 'scheduler', { x: 0, y: 0 })
  scheduler.config = { ...scheduler.config, ...config }
  const service = createRegisteredNode('service', 'worker', { x: 250, y: 0 })
  service.config = { ...service.config, replicas: 1, concurrencyPerReplica: 1, serviceTimeMs, jitterMs: 0, errorRate: 0, maxQueueSize: 10_000 }
  project.topology.nodes = [scheduler, service]
  project.topology.edges = [connection('release', 'scheduler', 'worker')]
  project.experiments[0]!.seed = `${id}-seed`
  project.experiments[0]!.simulation = { durationSeconds: 1, sampleIntervalMs: 100, maxRequests: 1_000, traceLimit: 1_000, maxHops: 20 }
  return project
}

const schedulerDetails = (result: Awaited<ReturnType<typeof runSimulation>>, nodeId = 'scheduler') => result.nodes.find((node) => node.nodeId === nodeId)!.details

describe('Scheduler runtime behavior', () => {
  it('releases periodic work without a Traffic workload and records conserved run state', async () => {
    const result = await runSimulation(scheduledService('periodic', { intervalMs: 200, concurrencyLimit: 2 }), 'periodic-run')
    const details = schedulerDetails(result)

    expect(result.summary).toMatchObject({ generatedRequests: 5, completedRequests: 5, failedRequests: 0 })
    expect(result.events.filter((event) => event.type === 'scheduler-tick')).toHaveLength(5)
    expect(result.events.filter((event) => event.type === 'scheduler-run-released')).toHaveLength(5)
    expect(details).toMatchObject({ releaseTicks: 5, scheduledRuns: 5, releasedRuns: 5, skippedRuns: 0, completedRuns: 5, activeRuns: 0 })
    expect(Number(details.scheduledRuns)).toBe(Number(details.releasedRuns) + Number(details.skippedRuns) + Number(details.pendingRuns))
  })

  it('makes batch size, concurrency and missed-run policy change measured outcomes', async () => {
    const base = scheduledService('overloaded-batch', { scheduleMode: 'batch', intervalMs: 100, batchSize: 3, concurrencyLimit: 1, missedRunPolicy: 'skip' }, 250)
    const catchUp = structuredClone(base)
    const catchUpScheduler = catchUp.topology.nodes.find((node) => node.type === 'scheduler')!
    catchUpScheduler.config = { ...catchUpScheduler.config, missedRunPolicy: 'catch-up', maxPendingRuns: 100 }

    const [skipping, catchingUp] = await Promise.all([runSimulation(base, 'skip-run'), runSimulation(catchUp, 'catch-up-run')])
    const skipped = schedulerDetails(skipping)
    const caught = schedulerDetails(catchingUp)

    expect(Number(skipped.skippedRuns)).toBeGreaterThan(0)
    expect(Number(skipped.maxActiveRuns)).toBe(1)
    expect(Number(caught.queuedRuns)).toBeGreaterThan(0)
    expect(Number(caught.catchUpRuns)).toBeGreaterThan(0)
    expect(Number(caught.releasedRuns)).toBeGreaterThan(Number(skipped.releasedRuns))
    expect(Number(caught.maxActiveRuns)).toBe(1)
    expect(Number(caught.scheduledRuns)).toBe(Number(caught.releasedRuns) + Number(caught.skippedRuns) + Number(caught.pendingRuns))
  })

  it('uses seeded, bounded release jitter and replays the same ordered event stream', async () => {
    const project = scheduledService('jitter', { intervalMs: 200, jitterMs: 75, concurrencyLimit: 10 })
    const first = await runSimulation(project, 'jitter-run')
    const replay = await runSimulation(structuredClone(project), 'jitter-run')
    const ticks = first.events.filter((event) => event.type === 'scheduler-tick')

    expect(replay.events).toEqual(first.events)
    expect(ticks.length).toBeGreaterThan(2)
    expect(ticks.some((event) => Number(event.attributes.jitterMs) !== 0)).toBe(true)
    expect(ticks.every((event) => Math.abs(Number(event.attributes.jitterMs)) <= 75)).toBe(true)
  })

  it('reuses the Scheduler in a multi-stage batch pipeline', async () => {
    const project = scheduledService('batch-pipeline', { scheduleMode: 'batch', intervalMs: 250, batchSize: 2, concurrencyLimit: 4 }, 10)
    const scheduler = project.topology.nodes[0]!
    const worker = project.topology.nodes[1]!
    const queue = createRegisteredNode('queue', 'queue', { x: 250, y: 0 })
    queue.config = { ...queue.config, consumers: 2, deliveryTimeMs: 5, jitterMs: 0, errorRate: 0 }
    worker.position = { x: 500, y: 0 }
    const database = createRegisteredNode('database', 'database', { x: 750, y: 0 })
    database.config = { ...database.config, queryTimeMs: 5, jitterMs: 0, errorRate: 0 }
    project.topology.nodes = [scheduler, queue, worker, database]
    project.topology.edges = [connection('to-queue', 'scheduler', 'queue'), connection('to-worker', 'queue', 'worker'), connection('to-database', 'worker', 'database')]

    const result = await runSimulation(project, 'batch-pipeline-run')

    expect(result.summary).toMatchObject({ generatedRequests: 8, completedRequests: 8, failedRequests: 0 })
    expect(result.nodes.find((node) => node.nodeId === 'database')?.processedRequests).toBe(8)
    expect(schedulerDetails(result)).toMatchObject({ releaseTicks: 4, releasedRuns: 8, completedRuns: 8 })
  })

  it('binds scheduled releases to a normal v3 operation and interaction plan', async () => {
    const project = createScheduledReportContractFixture()
    const result = await runSimulation(project, 'scheduled-report-run')

    expect(result.summary).toMatchObject({ generatedRequests: 4, completedRequests: 4, failedRequests: 0 })
    expect(result.operations).toEqual([expect.objectContaining({ operationId: 'build-order-report', generatedRequests: 4, completedRequests: 4 })])
    expect(result.actions).toEqual(expect.arrayContaining([expect.objectContaining({ actionId: 'scan-orders', completed: 4 })]))
    expect(result.events.filter((event) => event.type === 'scheduler-run-released').every((event) => event.attributes.workloadId === 'scheduled-report')).toBe(true)
    expect(result.events.filter((event) => event.type === 'operation-started')).toHaveLength(4)
    expect(schedulerDetails(result, 'report-scheduler')).toMatchObject({ scheduledRuns: 4, releasedRuns: 4, completedRuns: 4, activeRuns: 0 })
    expect(result.warnings).toContain('Operation workload scheduled-report uses Scheduler timing; its arrival phases are not executed.')
  })
})
