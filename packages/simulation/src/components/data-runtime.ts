import type { ComponentNode, EventStatus, RuntimeEventType } from '@system-design/model'
import { ObjectStorageState, PartitionedStreamState, ShardedDatabaseState, VirtualCacheState } from './data-state'

export interface StatefulRequest {
  id: number
  spanId: string
  bytes: number
  key?: string
  operation?: 'read' | 'write'
  outgoingPort?: string
  hotKeyProbabilityOverride?: number
}

export interface ComponentDomainEvent {
  type: RuntimeEventType
  status: EventStatus
  bytes?: number
  attributes?: Record<string, string | number | boolean>
}

export interface ComponentStateSnapshot {
  metrics: Record<string, string | number | boolean>
  events?: ComponentDomainEvent[]
}

export interface ComponentStateDecision {
  patch?: Partial<Pick<StatefulRequest, 'key' | 'operation' | 'outgoingPort'>>
  events?: ComponentDomainEvent[]
}

export interface ComponentStateRuntime {
  begin(request: StatefulRequest, nowMs: number, random: () => number): ComponentStateDecision
  complete(request: StatefulRequest, success: boolean, nowMs: number): ComponentDomainEvent[]
  dependencyComplete?(request: StatefulRequest, success: boolean, nowMs: number): ComponentDomainEvent[]
  snapshot(nowMs: number): ComponentStateSnapshot
}

const token = (request: StatefulRequest) => `${request.id}:${request.spanId}`
const generatedKey = (request: StatefulRequest, keySpaceSize: number, hotKeyProbability: number, random: () => number) =>
  request.key ?? (random() < hotKeyProbability ? 'hot:0' : `key:${Math.floor(random() * keySpaceSize)}`)

class CacheRuntime implements ComponentStateRuntime {
  private readonly cache
  private readonly pending = new Map<string, { key: string; fill: boolean }>()

  constructor(private readonly node: Extract<ComponentNode, { type: 'cache' }>) {
    this.cache = new VirtualCacheState(node.config)
  }

  begin(request: StatefulRequest, nowMs: number, random: () => number): ComponentStateDecision {
    const key = generatedKey(request, this.node.config.keySpaceSize, request.hotKeyProbabilityOverride ?? this.node.config.hotKeyProbability, random)
    const read = this.cache.read(key, nowMs)
    const fill = read.outcome !== 'hit'
    this.pending.set(token(request), { key, fill })
    const common = { key, ...(read.outcome === 'hit' ? { ageMs: read.ageMs } : {}) }
    return {
      patch: { key, operation: 'read', outgoingPort: fill ? 'miss' : 'hit' },
      events: read.outcome === 'expired'
        ? [{ type: 'cache-expired', status: 'ok', attributes: common }, { type: 'cache-miss', status: 'ok', attributes: common }]
        : [{ type: read.outcome === 'hit' ? 'cache-hit' : 'cache-miss', status: 'ok', attributes: common }],
    }
  }

  complete(request: StatefulRequest, success: boolean, _nowMs: number): ComponentDomainEvent[] {
    const pending = this.pending.get(token(request))
    if (!success || !pending?.fill || request.outgoingPort !== 'miss') this.pending.delete(token(request))
    return []
  }

  dependencyComplete(request: StatefulRequest, success: boolean, nowMs: number): ComponentDomainEvent[] {
    const pending = this.pending.get(token(request))
    this.pending.delete(token(request))
    if (!success || !pending?.fill) return []
    const write = this.cache.write(pending.key, nowMs)
    return write.evictedKey === undefined ? [] : [{ type: 'cache-evicted', status: 'ok', attributes: { key: write.evictedKey } }]
  }

  snapshot(nowMs: number): ComponentStateSnapshot {
    const expiredKeys = this.cache.expire(nowMs)
    const value = this.cache.snapshot(nowMs)
    return {
      metrics: { cacheHitRate: value.hitRate, cacheHits: value.hits, cacheMisses: value.misses, cacheEvictions: value.evictions, cacheExpirations: value.expirations, cacheEntries: value.entries, cacheOccupancy: value.occupancy },
      events: expiredKeys.map((key) => ({ type: 'cache-expired', status: 'ok', attributes: { key } })),
    }
  }
}

class StreamRuntime implements ComponentStateRuntime {
  private readonly stream

  constructor(private readonly node: Extract<ComponentNode, { type: 'stream' }>) {
    this.stream = new PartitionedStreamState(node.config.partitions)
  }

  begin(request: StatefulRequest, nowMs: number): ComponentStateDecision {
    const key = request.key ?? `message:${request.id}`
    const message = this.stream.publish(key, request.bytes, nowMs)
    const events: ComponentDomainEvent[] = [{ type: 'stream-record-appended', status: 'ok', attributes: { key, partition: message.partition, offset: message.offset, consumerLag: this.maximumLag() } }]
    if (this.node.config.acknowledgement === 'auto') events.push(this.consume(nowMs))
    return { patch: { key, outgoingPort: 'publish' }, events }
  }

  complete(_request: StatefulRequest, success: boolean, nowMs: number): ComponentDomainEvent[] {
    if (!success || this.node.config.acknowledgement === 'auto') return []
    return [this.consume(nowMs)]
  }

  snapshot(): ComponentStateSnapshot {
    const value = this.stream.snapshot('group-0')
    return { metrics: { streamPublished: value.published, streamConsumed: value.consumed, streamAcknowledged: value.acknowledged, consumerLag: this.maximumLag(), partitionImbalance: value.partitionImbalance, ...indexedMetrics('recordsByPartition', value.publishedByPartition) } }
  }

  private maximumLag() {
    let maximum = 0
    for (let index = 0; index < this.node.config.consumerGroups; index += 1) maximum = Math.max(maximum, this.stream.lag(`group-${index}`))
    return maximum
  }

  private consume(nowMs: number): ComponentDomainEvent {
    let consumed = 0
    for (let index = 0; index < this.node.config.consumerGroups; index += 1) {
      const group = `group-${index}`
      const batch = this.stream.consume(group, this.node.config.batchSize, nowMs)
      this.stream.acknowledge(group, batch, nowMs)
      consumed += batch.length
    }
    return { type: 'stream-record-consumed', status: 'ok', attributes: { consumed, consumerLag: this.maximumLag() } }
  }
}

class ObjectStorageRuntime implements ComponentStateRuntime {
  private readonly storage = new ObjectStorageState()
  private readonly pending = new Map<string, { operation: 'read' | 'write'; bytes: number }>()

  constructor(private readonly node: Extract<ComponentNode, { type: 'object-storage' }>) {}

  begin(request: StatefulRequest, _nowMs: number, random: () => number): ComponentStateDecision {
    const operation = request.operation ?? (random() < this.node.config.readRatio ? 'read' : 'write')
    const bytes = this.node.config.defaultObjectSizeBytes
    this.pending.set(token(request), { operation, bytes })
    return { patch: { operation, outgoingPort: 'out' } }
  }

  complete(request: StatefulRequest, success: boolean, nowMs: number): ComponentDomainEvent[] {
    const value = this.pending.get(token(request))
    this.pending.delete(token(request))
    if (!value) return []
    this.storage.record(value.operation, value.bytes, success, nowMs)
    return [{ type: value.operation === 'read' ? 'object-read' : 'object-written', status: success ? 'ok' : 'error', bytes: value.bytes, attributes: { bytes: value.bytes } }]
  }

  snapshot(nowMs: number): ComponentStateSnapshot {
    const value = this.storage.snapshot(nowMs)
    return { metrics: { objectOperations: value.operations, objectReads: value.reads, objectWrites: value.writes, objectFailures: value.failedOperations, objectReadBytes: value.readBytes, objectWrittenBytes: value.writtenBytes, byteThroughputPerSecond: value.byteThroughputPerSecond } }
  }
}

class DatabaseRuntime implements ComponentStateRuntime {
  private readonly database
  private readonly pending = new Map<string, { key: string; operation: 'read' | 'write'; route?: ReturnType<ShardedDatabaseState['read']> }>()

  constructor(private readonly node: Extract<ComponentNode, { type: 'database' }>) {
    this.database = new ShardedDatabaseState(node.config)
  }

  begin(request: StatefulRequest, nowMs: number, random: () => number): ComponentStateDecision {
    const key = generatedKey(request, this.node.config.keySpaceSize, request.hotKeyProbabilityOverride ?? this.node.config.hotKeyProbability, random)
    const operation = request.operation ?? (random() < this.node.config.writeRatio ? 'write' : 'read')
    const route = operation === 'read' ? this.database.read(key, nowMs) : undefined
    this.pending.set(token(request), { key, operation, ...(route === undefined ? {} : { route }) })
    return { patch: { key, operation, outgoingPort: 'out' } }
  }

  complete(request: StatefulRequest, success: boolean, nowMs: number): ComponentDomainEvent[] {
    const pending = this.pending.get(token(request))
    this.pending.delete(token(request))
    if (!pending) return []
    const route = pending.operation === 'write' && success ? this.database.write(pending.key, nowMs) : pending.route
    const attributes = route ? { key: pending.key, shard: route.shard, role: route.role, staleVersions: route.staleVersions, replicaLagMs: route.replicaLagMs } : { key: pending.key, shard: this.database.shardForKey(pending.key), role: 'primary' }
    return [{ type: pending.operation === 'read' ? 'database-read' : 'database-written', status: success ? 'ok' : 'error', attributes }]
  }

  snapshot(nowMs: number): ComponentStateSnapshot {
    const value = this.database.snapshot(nowMs)
    return { metrics: { databaseWrites: value.writes, primaryReads: value.primaryReads, replicaReads: value.replicaReads, hottestShardShare: value.hottestShardShare, maxReplicaLagVersions: value.maxReplicaLagVersions, maxReplicaLagMs: value.maxReplicaLagMs, ...indexedMetrics('requestsByShard', value.requestsByShard) } }
  }
}

const indexedMetrics = (prefix: string, values: readonly number[]) => Object.fromEntries(
  values.slice(0, 16).map((value, index) => [`${prefix}${index}`, value]),
)

export const createComponentStateRuntime = (node: ComponentNode): ComponentStateRuntime | undefined => {
  switch (node.type) {
    case 'cache': return new CacheRuntime(node)
    case 'stream': return new StreamRuntime(node)
    case 'object-storage': return new ObjectStorageRuntime(node)
    case 'database': return node.componentVersion === 2 ? new DatabaseRuntime(node) : undefined
    default: return undefined
  }
}
