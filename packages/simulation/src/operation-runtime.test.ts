import { describe, expect, it } from 'vitest'
import { createOrderSystemContractFixture, projectToScenario } from '@system-design/model'
import { runSimulation } from './engine'
import { reduceActionMetrics, reduceNodeMetrics, reduceOperationMetrics } from './telemetry/reducers'

const operationOnly = () => {
  const project = createOrderSystemContractFixture()
  project.experiments[0]!.operationWorkloads[0]!.phases = [{ id: 'test', startAtSeconds: 0, durationSeconds: 0.1, requestsPerSecond: 10, pattern: 'constant' }]
  project.experiments[0]!.simulation = { durationSeconds: 30, sampleIntervalMs: 1_000, maxRequests: 10, traceLimit: 10, maxHops: 64 }
  for (const node of project.topology.nodes) {
    if (node.type === 'service') node.config = { ...node.config, serviceTimeMs: 1, jitterMs: 0, errorRate: 0 }
    if (node.type === 'database') node.config = { ...node.config, queryTimeMs: 1, jitterMs: 0, errorRate: 0 }
    if (node.type === 'cache') node.config = { ...node.config, operationTimeMs: 1, jitterMs: 0, errorRate: 0 }
    if (node.type === 'stream') node.config = { ...node.config, publishTimeMs: 1, consumeTimeMs: 1, jitterMs: 0, errorRate: 0 }
  }
  return project
}

describe('operation-aware runtime', () => {
  it('executes named actions, emits context-rich telemetry, and replays deterministically', async () => {
    const project = operationOnly()
    const first = await runSimulation(project, 'operation-run')
    const replay = await runSimulation(structuredClone(project), 'operation-run')
    expect(first.summary).toMatchObject({ generatedRequests: 1, completedRequests: 1, failedRequests: 0 })
    expect(first.events.filter((event) => event.type === 'action-completed').map((event) => event.actionId).sort()).toEqual(['cache-order', 'call-api', 'consume-order', 'publish-order', 'write-order', 'write-order-items'])
    const operationCompleted = first.events.find((event) => event.type === 'operation-completed')!
    const publishCompleted = first.events.find((event) => event.type === 'action-completed' && event.actionId === 'publish-order')!
    expect(operationCompleted.timestampMs).toBeLessThanOrEqual(publishCompleted.timestampMs)
    expect(first.events.filter((event) => event.type === 'database-written')).toEqual(expect.arrayContaining([
      expect.objectContaining({ operationId: 'create-order', actionId: 'write-order', attributes: expect.objectContaining({ dataOperation: 'insert', recordsExamined: 1 }) }),
    ]))
    expect(first.events.find((event) => event.type === 'message-published')).toMatchObject({ attributes: { eventId: 'order-created@1' } })
    expect(first.spans.some((span) => span.operationId === 'create-order' && span.actionId === 'write-order')).toBe(true)
    expect(replay.events).toEqual(first.events)
  })

  it('makes a full scan slower than the same operation with an index lookup', async () => {
    const indexed = operationOnly()
    const indexedAction = indexed.definitions.interactions[0]!.actions[1]!
    if (indexedAction.kind !== 'data-access') throw new Error('Expected data action')
    indexedAction.operation = 'index-read'
    indexedAction.indexId = 'ix-customer'
    indexedAction.estimatedRows = 10
    const scan = structuredClone(indexed)
    const scanAction = scan.definitions.interactions[0]!.actions[1]!
    if (scanAction.kind !== 'data-access') throw new Error('Expected data action')
    scanAction.operation = 'scan'
    delete scanAction.indexId
    const [indexResult, scanResult] = await Promise.all([runSimulation(indexed, 'indexed-run'), runSimulation(scan, 'scan-run')])
    expect(scanResult.summary.latencyP95Ms).toBeGreaterThan(indexResult.summary.latencyP95Ms)
    const indexedRecords = Number(indexResult.events.find((event) => event.type === 'database-read' && event.actionId === 'write-order' && event.attributes.recordsExamined !== undefined)?.attributes.recordsExamined)
    const scannedRecords = Number(scanResult.events.find((event) => event.type === 'database-read' && event.actionId === 'write-order' && event.attributes.recordsExamined !== undefined)?.attributes.recordsExamined)
    expect(scannedRecords).toBeGreaterThan(indexedRecords)
  })

  it('keeps operation, action, and node metrics exact when detailed traces are disabled', async () => {
    const fullProject = operationOnly()
    fullProject.experiments[0]!.operationWorkloads[0]!.phases[0] = { id: 'test', startAtSeconds: 0, durationSeconds: 1, requestsPerSecond: 20, pattern: 'constant' }
    fullProject.experiments[0]!.simulation.traceLimit = 100
    fullProject.experiments[0]!.simulation.maxRequests = 100
    const sampledProject = structuredClone(fullProject)
    sampledProject.experiments[0]!.simulation.traceLimit = 0

    const [full, sampled] = await Promise.all([runSimulation(fullProject, 'full-operation-traces'), runSimulation(sampledProject, 'no-operation-traces')])

    expect(full.operations).toEqual(reduceOperationMetrics(full.events))
    expect(full.actions).toEqual(reduceActionMetrics(full.events))
    expect(full.nodes).toEqual(reduceNodeMetrics(full.events, projectToScenario(fullProject).nodes))
    expect(sampled.summary).toEqual(full.summary)
    expect(sampled.operations).toEqual(full.operations)
    expect(sampled.actions).toEqual(full.actions)
    expect(sampled.nodes).toEqual(full.nodes)
    expect(sampled.events.every((event) => event.requestId === undefined)).toBe(true)
  })

  it('executes cache hit and miss conditions, explicit writes, and deletes', async () => {
    const project = operationOnly()
    const interaction = project.definitions.interactions[0]!
    interaction.actions = [
      interaction.actions[0]!,
      { id: 'get-cache', kind: 'cache-access', dependsOn: ['call-api'], nodeId: 'orders-cache', operation: 'get', key: { cacheKeyId: 'order-cache-key', cacheKeyVersion: 1 } },
      { id: 'write-on-miss', kind: 'cache-access', dependsOn: ['get-cache'], condition: { actionId: 'get-cache', outcome: 'cache-miss' }, nodeId: 'orders-cache', operation: 'put', key: { cacheKeyId: 'order-cache-key', cacheKeyVersion: 1 } },
      { id: 'delete-after-write', kind: 'cache-access', dependsOn: ['write-on-miss'], nodeId: 'orders-cache', operation: 'delete', key: { cacheKeyId: 'order-cache-key', cacheKeyVersion: 1 } },
      { id: 'hit-only', kind: 'service-call', dependsOn: ['get-cache'], condition: { actionId: 'get-cache', outcome: 'cache-hit' }, sourceNodeId: 'orders-service', targetNodeId: 'fulfillment-worker' },
    ]
    project.topology.edges.push({ id: 'orders-to-worker-sync', source: 'orders-service', target: 'fulfillment-worker', sourcePort: 'out', targetPort: 'in', weight: 1, sourceSemantic: 'request', targetSemantic: 'request', routingMode: 'weighted-one' })

    const result = await runSimulation(project, 'cache-conditions')
    expect(result.events.some((event) => event.type === 'cache-miss' && event.actionId === 'get-cache')).toBe(true)
    expect(result.events.some((event) => event.type === 'cache-written' && event.actionId === 'write-on-miss')).toBe(true)
    expect(result.events.some((event) => event.type === 'cache-deleted' && event.actionId === 'delete-after-write')).toBe(true)
    expect(result.events.find((event) => event.type === 'action-skipped' && event.actionId === 'hit-only')).toBeDefined()
  })

  it('applies operation workload traffic spikes, hot keys, edge failures, and queue overload', async () => {
    const baseline = operationOnly()
    baseline.experiments[0]!.operationWorkloads[0]!.phases[0] = { id: 'test', startAtSeconds: 0, durationSeconds: 1, requestsPerSecond: 5, pattern: 'constant' }
    baseline.experiments[0]!.simulation = { durationSeconds: 2, sampleIntervalMs: 100, maxRequests: 100, traceLimit: 100, maxHops: 64 }
    const spiked = structuredClone(baseline)
    spiked.experiments[0]!.faults.push({ id: 'spike', type: 'traffic-spike', target: { kind: 'workload', id: 'order-operations' }, startAtSeconds: 0, durationSeconds: 1, factor: 2, enabled: true })
    const failed = structuredClone(baseline)
    failed.experiments[0]!.faults.push({ id: 'loss', type: 'packet-loss', target: { kind: 'edge', id: 'orders-to-db' }, startAtSeconds: 0, durationSeconds: 2, factor: 1, enabled: true })
    const overloaded = structuredClone(baseline)
    const service = overloaded.topology.nodes.find((node) => node.id === 'orders-service')!
    if (service.type !== 'service') throw new Error('Expected service')
    Object.assign(service.config, { replicas: 1, concurrencyPerReplica: 1, serviceTimeMs: 1_000, maxQueueSize: 0, jitterMs: 0 })

    const [baseResult, spikeResult, failedResult, overloadResult] = await Promise.all([
      runSimulation(baseline, 'operation-base'), runSimulation(spiked, 'operation-spike'), runSimulation(failed, 'operation-loss'), runSimulation(overloaded, 'operation-overload'),
    ])
    expect(spikeResult.summary.generatedRequests).toBeGreaterThan(baseResult.summary.generatedRequests)
    expect(failedResult.summary.failedRequests).toBeGreaterThan(0)
    expect(failedResult.events.some((event) => event.reason === 'packet_loss' && event.type === 'action-completed')).toBe(true)
    expect(overloadResult.events.some((event) => event.reason === 'queue_full' && event.type === 'action-completed')).toBe(true)
  })

  it('routes declared keys through database shards and applies payload-size cost', async () => {
    const uniform = operationOnly()
    uniform.experiments[0]!.operationWorkloads[0]!.phases[0] = { id: 'test', startAtSeconds: 0, durationSeconds: 1, requestsPerSecond: 20, pattern: 'constant' }
    uniform.experiments[0]!.simulation = { durationSeconds: 2, sampleIntervalMs: 100, maxRequests: 100, traceLimit: 100, maxHops: 64 }
    const uniformDatabase = uniform.topology.nodes.find((node) => node.id === 'orders-db')!
    if (uniformDatabase.type !== 'database') throw new Error('Expected database')
    uniformDatabase.config.shardCount = 4
    uniform.experiments[0]!.operationWorkloads[0]!.operationMix[0]!.keyDistribution = { kind: 'uniform', keySpaceSize: 1_000 }
    const hot = structuredClone(uniform)
    hot.experiments[0]!.operationWorkloads[0]!.operationMix[0]!.keyDistribution = { kind: 'hotspot', keySpaceSize: 1_000, hotKeyCount: 1, hotTrafficFraction: 1 }
    const large = structuredClone(uniform)
    large.experiments[0]!.operationWorkloads[0]!.operationMix[0]!.valueSizeDistribution = { kind: 'fixed', bytes: 1_048_576 }

    const [uniformResult, hotResult, largeResult] = await Promise.all([
      runSimulation(uniform, 'uniform-keys'), runSimulation(hot, 'hot-keys'), runSimulation(large, 'large-values'),
    ])
    const uniformShare = Number(uniformResult.nodes.find((node) => node.nodeId === 'orders-db')?.details.hottestShardShare)
    const hotShare = Number(hotResult.nodes.find((node) => node.nodeId === 'orders-db')?.details.hottestShardShare)
    expect(hotShare).toBeGreaterThan(uniformShare)
    expect(largeResult.summary.latencyP95Ms).toBeGreaterThan(uniformResult.summary.latencyP95Ms)
  })
})
