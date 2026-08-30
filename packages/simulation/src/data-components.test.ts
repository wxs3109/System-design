import { describe, expect, it } from 'vitest'
import { createRegisteredNode } from '@system-design/components'
import { createEmptyProject, type ProjectFile } from '@system-design/model'
import { runSimulation } from './engine'

const edge = (id: string, source: string, target: string, sourcePort = 'out', targetPort = 'in', routingMode: 'weighted-one' | 'async-publish' = 'weighted-one') => ({
  id, source, target, sourcePort, targetPort, weight: 1, routingMode,
  sourceSemantic: (sourcePort === 'publish' ? 'publish' : sourcePort === 'hit' ? 'hit' : sourcePort === 'miss' ? 'miss' : 'request') as 'request' | 'publish' | 'hit' | 'miss',
  targetSemantic: (targetPort === 'consume' ? 'consume' : 'request') as 'request' | 'consume',
})

const project = (id: string): ProjectFile => {
  const value = createEmptyProject(id)
  value.experiments[0]!.seed = `${id}-seed`
  value.experiments[0]!.simulation = { durationSeconds: 2, sampleIntervalMs: 250, maxRequests: 1_000, traceLimit: 20, maxHops: 20 }
  value.experiments[0]!.workloads = [{ id: 'load', name: 'Load', sourceNodeId: 'traffic', requestsPerSecond: 20, startAtSeconds: 0, durationSeconds: 1, pattern: 'constant', requestBytes: 1_024 }]
  value.topology.nodes = [createRegisteredNode('traffic', 'traffic', { x: 0, y: 0 }, 'load')]
  return value
}

describe('P1.3 executable data components', () => {
  it('warms a key-aware cache and sends hits away from the database', async () => {
    const value = project('cache-path')
    const cache = createRegisteredNode('cache', 'cache', { x: 100, y: 0 })
    cache.config = { ...cache.config, keySpaceSize: 1, capacityEntries: 1, ttlMs: 10_000, jitterMs: 0, operationTimeMs: 0.1 }
    const hit = createRegisteredNode('service', 'hit', { x: 200, y: -50 })
    const database = createRegisteredNode('database', 'database', { x: 200, y: 50 })
    database.config = { ...database.config, errorRate: 0, jitterMs: 0 }
    value.topology.nodes.push(cache, hit, database)
    value.topology.edges = [edge('entry', 'traffic', 'cache'), edge('hit', 'cache', 'hit', 'hit'), edge('miss', 'cache', 'database', 'miss')]

    const result = await runSimulation(value, 'cache-run')
    const cacheMetrics = result.nodes.find((node) => node.nodeId === 'cache')!
    expect(Number(cacheMetrics.details.cacheHitRate)).toBeGreaterThan(0.9)
    expect(result.nodes.find((node) => node.nodeId === 'database')?.processedRequests).toBe(1)
    expect(result.events.filter((event) => event.type === 'cache-miss')).toHaveLength(1)
  })

  it('does not populate a cache when its miss path fails', async () => {
    const value = project('cache-failed-fill')
    value.experiments[0]!.workloads[0] = { ...value.experiments[0]!.workloads[0]!, requestsPerSecond: 2, durationSeconds: 1 }
    const cache = createRegisteredNode('cache', 'cache', { x: 100, y: 0 })
    cache.config = { ...cache.config, keySpaceSize: 1, capacityEntries: 1, ttlMs: 10_000, jitterMs: 0, operationTimeMs: 0.1 }
    const hit = createRegisteredNode('service', 'hit', { x: 200, y: -50 })
    const database = createRegisteredNode('database', 'database', { x: 200, y: 50 })
    database.config = { ...database.config, errorRate: 1, jitterMs: 0 }
    value.topology.nodes.push(cache, hit, database)
    value.topology.edges = [edge('entry', 'traffic', 'cache'), edge('hit', 'cache', 'hit', 'hit'), edge('miss', 'cache', 'database', 'miss')]

    const result = await runSimulation(value, 'cache-failed-fill-run')
    expect(result.events.filter((event) => event.type === 'cache-hit')).toHaveLength(0)
    expect(result.events.filter((event) => event.type === 'cache-miss')).toHaveLength(result.summary.generatedRequests)
  })

  it('exposes retained stream lag and deterministic partition skew', async () => {
    const value = project('stream-path')
    const producer = createRegisteredNode('service', 'producer', { x: 100, y: 0 })
    const stream = createRegisteredNode('stream', 'stream', { x: 200, y: 0 })
    stream.config = { ...stream.config, partitions: 4, consumerGroups: 1, consumersPerGroup: 1, batchSize: 1, producerCapacity: 100, publishTimeMs: 0.1, consumeTimeMs: 2_000, jitterMs: 0 }
    const consumer = createRegisteredNode('service', 'consumer', { x: 300, y: 0 })
    value.topology.nodes.push(producer, stream, consumer)
    value.topology.edges = [edge('entry', 'traffic', 'producer'), edge('publish', 'producer', 'stream', 'publish', 'consume', 'async-publish'), edge('consume', 'stream', 'consumer', 'publish', 'consume', 'async-publish')]

    const result = await runSimulation(value, 'stream-run')
    const details = result.nodes.find((node) => node.nodeId === 'stream')!.details
    expect(Number(details.streamPublished)).toBe(result.summary.generatedRequests)
    expect(Number(details.consumerLag)).toBeGreaterThan(0)
    expect(result.events.filter((event) => event.type === 'stream-record-appended')).toHaveLength(result.summary.generatedRequests)
  })

  it('lets stream capacity and backpressure change producer outcomes', async () => {
    const value = project('stream-backpressure')
    value.experiments[0]!.workloads[0] = { ...value.experiments[0]!.workloads[0]!, requestsPerSecond: 100, durationSeconds: 1 }
    const producer = createRegisteredNode('service', 'producer', { x: 100, y: 0 })
    const stream = createRegisteredNode('stream', 'stream', { x: 200, y: 0 })
    stream.config = { ...stream.config, producerCapacity: 100, publishTimeMs: 50, consumeTimeMs: 1_000, consumersPerGroup: 1, batchSize: 1, maxDepth: 100, jitterMs: 0 }
    value.topology.nodes.push(producer, stream)
    value.topology.edges = [edge('entry', 'traffic', 'producer'), edge('publish', 'producer', 'stream', 'publish', 'consume', 'async-publish')]
    const bounded = structuredClone(value)
    bounded.topology.policies = [{ id: 'pressure', type: 'backpressure', version: 1, target: { kind: 'edge', id: 'publish' }, order: 0, enabled: true, config: { maxInFlight: 2, overflow: 'reject' } }]

    const [baseline, pressured] = await Promise.all([runSimulation(value, 'stream-baseline'), runSimulation(bounded, 'stream-pressure')])
    expect(pressured.events.filter((event) => event.reason === 'backpressure').length).toBeGreaterThan(0)
    expect(Number(pressured.nodes.find((node) => node.nodeId === 'stream')!.details.streamPublished)).toBeLessThan(Number(baseline.nodes.find((node) => node.nodeId === 'stream')!.details.streamPublished))
    expect(pressured.summary.completedRequests).toBe(pressured.summary.generatedRequests)
  })

  it('records object reads and writes with successful byte throughput', async () => {
    const value = project('object-path')
    const storage = createRegisteredNode('object-storage', 'objects', { x: 100, y: 0 })
    storage.config = { ...storage.config, readRatio: 1, defaultObjectSizeBytes: 2_048, errorRate: 0, jitterMs: 0 }
    value.topology.nodes.push(storage)
    value.topology.edges = [edge('entry', 'traffic', 'objects')]

    const result = await runSimulation(value, 'object-run')
    const details = result.nodes.find((node) => node.nodeId === 'objects')!.details
    expect(Number(details.objectReads)).toBe(result.summary.generatedRequests)
    expect(Number(details.objectReadBytes)).toBe(result.summary.generatedRequests * 2_048)
    expect(Number(details.byteThroughputPerSecond)).toBeGreaterThan(0)
    expect(result.events.filter((event) => event.type === 'object-read').every((event) => event.bytes === 2_048)).toBe(true)
  })

  it('routes a hot workload to one shard and reports replica freshness', async () => {
    const value = project('database-path')
    const database = createRegisteredNode('database', 'database', { x: 100, y: 0 })
    database.config = { ...database.config, shardCount: 4, replicasPerShard: 2, readPreference: 'replica-preferred', replicationDelayMs: 100, writeRatio: 0.5, keySpaceSize: 1, hotKeyProbability: 1, errorRate: 0, jitterMs: 0 }
    value.topology.nodes.push(database)
    value.topology.edges = [edge('entry', 'traffic', 'database')]

    const first = await runSimulation(value, 'database-run')
    const replay = await runSimulation(structuredClone(value), 'database-run')
    const details = first.nodes.find((node) => node.nodeId === 'database')!.details
    expect(Number(details.hottestShardShare)).toBe(1)
    expect(Number(details.replicaReads)).toBeGreaterThan(0)
    expect(first.events.some((event) => event.type === 'database-read' && Number(event.attributes.staleVersions) > 0)).toBe(true)
    expect(replay.events).toEqual(first.events)
  })
})
