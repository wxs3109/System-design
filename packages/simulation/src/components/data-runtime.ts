import type { ComponentNode, EventStatus, RuntimeEventType } from '@system-design/model'
import type { CompiledOperationAction } from '../compiler/operation-plan'
import { CdnState, ObjectStorageState, PartitionedStreamState, ShardedDatabaseState, VirtualCacheState } from './data-state'
import { SearchIndexState, type SearchRefreshResult } from './search-state'
import { TopicState, type TopicExpiredDelivery, type TopicMessage } from './topic-state'

export interface StatefulRequest {
  id: number
  spanId: string
  bytes: number
  key?: string
  operation?: 'read' | 'write'
  outgoingPort?: string
  hotKeyProbabilityOverride?: number
  operationAction?: CompiledOperationAction
  payloadBytes?: number
  cdnOutcome?: 'hit' | 'miss'
  cdnPop?: number
  searchCandidateCount?: number
  searchFanOut?: number
  searchResultCount?: number
  searchStale?: boolean
  searchVisibilityLagMs?: number
  incomingRoutingMode?: 'weighted-one' | 'fan-out' | 'async-publish'
  incomingEdgeId?: string
  topicSubscriptionId?: string
  topicMessageId?: number
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
  patch?: Partial<Pick<StatefulRequest, 'key' | 'operation' | 'outgoingPort' | 'cdnOutcome' | 'cdnPop' | 'searchCandidateCount' | 'searchFanOut' | 'searchResultCount' | 'searchStale' | 'searchVisibilityLagMs' | 'topicSubscriptionId' | 'topicMessageId' | 'bytes'>>
  events?: ComponentDomainEvent[]
}

export interface ComponentDeliveryDecision extends ComponentStateDecision { deliver: boolean }

export interface ComponentStateRuntime {
  begin(request: StatefulRequest, nowMs: number, random: () => number): ComponentStateDecision
  complete(request: StatefulRequest, success: boolean, nowMs: number): ComponentDomainEvent[]
  prepareDelivery?(request: StatefulRequest, subscriptionId: string, nowMs: number): ComponentDeliveryDecision
  dependencyComplete?(request: StatefulRequest, success: boolean, nowMs: number): ComponentDomainEvent[]
  snapshot(nowMs: number): ComponentStateSnapshot
  outcome?(request: StatefulRequest): 'hit' | 'miss' | undefined
}

const token = (request: StatefulRequest) => `${request.id}:${request.spanId}`
const generatedKey = (request: StatefulRequest, keySpaceSize: number, hotKeyProbability: number, random: () => number) =>
  request.key ?? (random() < hotKeyProbability ? 'hot:0' : `key:${Math.floor(random() * keySpaceSize)}`)

export class CacheRuntime implements ComponentStateRuntime {
  private readonly cache
  private readonly pending = new Map<string, { key: string; operation: 'get' | 'put' | 'delete'; outcome: 'hit' | 'miss' }>()

  constructor(private readonly node: Extract<ComponentNode, { type: 'cache' }>) {
    this.cache = new VirtualCacheState(node.config)
  }

  begin(request: StatefulRequest, nowMs: number, random: () => number): ComponentStateDecision {
    const key = generatedKey(request, this.node.config.keySpaceSize, request.hotKeyProbabilityOverride ?? this.node.config.hotKeyProbability, random)
    const declared = request.operationAction?.cache?.operation
    if (declared === 'put') {
      this.pending.set(token(request), { key, operation: declared, outcome: 'hit' })
      return { patch: { key, operation: 'write', outgoingPort: 'hit' } }
    }
    if (declared === 'delete') {
      this.pending.set(token(request), { key, operation: declared, outcome: 'hit' })
      return { patch: { key, operation: 'write', outgoingPort: 'hit' } }
    }
    const read = this.cache.read(key, nowMs)
    const miss = read.outcome !== 'hit'
    this.pending.set(token(request), { key, operation: 'get', outcome: miss ? 'miss' : 'hit' })
    const common = { key, ...(read.outcome === 'hit' ? { ageMs: read.ageMs } : {}) }
    return {
      patch: { key, operation: 'read', outgoingPort: miss ? 'miss' : 'hit' },
      events: read.outcome === 'expired'
        ? [{ type: 'cache-expired', status: 'ok', attributes: common }, { type: 'cache-miss', status: 'ok', attributes: common }]
        : [{ type: read.outcome === 'hit' ? 'cache-hit' : 'cache-miss', status: 'ok', attributes: common }],
    }
  }

  complete(request: StatefulRequest, success: boolean, _nowMs: number): ComponentDomainEvent[] {
    const pending = this.pending.get(token(request))
    if (success && pending?.operation === 'put') { this.cache.write(pending.key, _nowMs, (request.operationAction?.cache?.ttlSeconds ?? this.node.config.ttlMs / 1_000) * 1_000); this.pending.delete(token(request)); return [{ type: 'cache-written', status: 'ok', attributes: { key: pending.key } }] }
    if (pending?.operation === 'delete') { const deleted = success && this.cache.delete(pending.key, _nowMs); this.pending.delete(token(request)); return [{ type: 'cache-deleted', status: 'ok', attributes: { key: pending.key, deleted } }] }
    if (!success) this.pending.delete(token(request))
    return []
  }

  outcome(request: StatefulRequest) {
    const pending = this.pending.get(token(request))
    if (request.operationAction?.cache) this.pending.delete(token(request))
    return pending?.outcome
  }

  dependencyComplete(request: StatefulRequest, success: boolean, nowMs: number): ComponentDomainEvent[] {
    const pending = this.pending.get(token(request))
    this.pending.delete(token(request))
    if (!success || pending?.operation !== 'get' || pending.outcome !== 'miss') return []
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

export class CdnRuntime implements ComponentStateRuntime {
  private readonly cdn
  private readonly pending = new Map<string, { key: string; pop: number; outcome: 'hit' | 'miss'; bytes: number }>()

  constructor(private readonly node: Extract<ComponentNode, { type: 'cdn' }>) {
    this.cdn = new CdnState({
      popCount: node.config.popCount, popSelection: node.config.popSelection, capacityEntries: node.config.capacityEntriesPerPop,
      ttlMs: node.config.ttlMs, evictionPolicy: node.config.evictionPolicy,
    })
  }

  begin(request: StatefulRequest, nowMs: number, random: () => number): ComponentStateDecision {
    const key = generatedKey(request, this.node.config.keySpaceSize, request.hotKeyProbabilityOverride ?? this.node.config.hotKeyProbability, random)
    const bytes = request.payloadBytes ?? this.node.config.defaultObjectSizeBytes
    const read = this.cdn.read(key, bytes, nowMs)
    const outcome = read.outcome === 'hit' ? 'hit' as const : 'miss' as const
    this.pending.set(token(request), { key, pop: read.pop, outcome, bytes })
    const attributes = { key, pop: read.pop, selection: this.node.config.popSelection, ...(read.ageMs === undefined ? {} : { ageMs: read.ageMs }) }
    return {
      patch: { key, operation: 'read', outgoingPort: outcome, cdnOutcome: outcome, cdnPop: read.pop, bytes },
      events: [
        { type: 'cdn-pop-selected', status: 'ok', attributes },
        { type: outcome === 'hit' ? 'cdn-cache-hit' : 'cdn-cache-miss', status: 'ok', bytes, attributes },
      ],
    }
  }

  complete(request: StatefulRequest, success: boolean): ComponentDomainEvent[] {
    if (!success) this.pending.delete(token(request))
    return []
  }

  dependencyComplete(request: StatefulRequest, success: boolean, nowMs: number): ComponentDomainEvent[] {
    const pending = this.pending.get(token(request))
    this.pending.delete(token(request))
    if (!success || !pending) return []
    this.cdn.recordDelivery(pending.bytes)
    if (pending.outcome !== 'miss') return []
    const write = this.cdn.fill(pending.pop, pending.key, pending.bytes, nowMs)
    return [
      { type: 'cdn-origin-fetch', status: 'ok', bytes: pending.bytes, attributes: { key: pending.key, pop: pending.pop, originFetch: true } },
      ...(write.evictedKey === undefined ? [] : [{ type: 'cache-evicted' as const, status: 'ok' as const, attributes: { key: write.evictedKey, pop: pending.pop } }]),
    ]
  }

  snapshot(nowMs: number): ComponentStateSnapshot {
    const expired = this.cdn.expire(nowMs)
    const value = this.cdn.snapshot(nowMs)
    return {
      metrics: {
        cdnRequests: value.requests, cdnHits: value.hits, cdnMisses: value.misses, cdnHitRate: value.hitRate, cdnOriginFetches: value.originFetches,
        cdnBytesServed: value.edgeBytes, cdnOriginBytes: value.originBytes, cdnEvictions: value.evictions, cdnExpirations: value.expirations, cdnEntries: value.entries,
        popRequestImbalance: value.popRequestImbalance, ...indexedMetrics('requestsByPop', value.requestsByPop),
      },
      events: expired.map(({ pop, key }) => ({ type: 'cache-expired', status: 'ok', attributes: { key, pop } })),
    }
  }
}

class SearchIndexRuntime implements ComponentStateRuntime {
  private readonly indexes = new Map<string, SearchIndexState>()
  private readonly pending = new Map<string, {
    key: string
    operation: 'read' | 'write'
    search: SearchIndexState
    mutationOperation?: 'insert' | 'update' | 'delete'
    query?: ReturnType<SearchIndexState['query']>
    resultLimit?: number
    bytes: number
  }>()

  constructor(private readonly node: Extract<ComponentNode, { type: 'search-index' }>) {}

  begin(request: StatefulRequest, nowMs: number, random: () => number): ComponentStateDecision {
    const key = generatedKey(request, this.node.config.keySpaceSize, request.hotKeyProbabilityOverride ?? this.node.config.hotKeyProbability, random)
    const dataOperation = request.operationAction?.data?.operation
    const operation = request.operation ?? (dataOperation && ['insert', 'update', 'delete'].includes(dataOperation)
      ? 'write'
      : request.incomingRoutingMode === 'async-publish' || random() < this.node.config.writeRatio ? 'write' : 'read')
    const bytes = request.payloadBytes ?? request.bytes
    const search = this.indexFor(request)
    if (operation === 'write') {
      const mutationOperation = dataOperation === 'delete' ? 'delete' as const : dataOperation === 'update' ? 'update' as const : 'insert' as const
      this.pending.set(token(request), { key, operation, search, mutationOperation, bytes })
      return { patch: { key, operation, outgoingPort: 'out', bytes } }
    }
    const resultLimit = Math.max(1, request.operationAction?.data?.estimatedRows ?? this.node.config.defaultResultLimit)
    const query = search.query(key, resultLimit, nowMs)
    this.pending.set(token(request), { key, operation, search, query, resultLimit, bytes })
    return {
      patch: {
        key, operation, outgoingPort: 'out', searchCandidateCount: query.candidateCount, searchFanOut: query.fanOut,
        searchResultCount: query.resultCount, searchStale: query.stale, searchVisibilityLagMs: query.visibilityLagMs,
      },
      events: [
        ...this.refreshEvents(query.refresh),
        { type: 'search-query-fan-out', status: 'ok', attributes: { key, fanOut: query.fanOut, primaryCopies: query.routes.filter((route) => route.role === 'primary').length, replicaCopies: query.routes.filter((route) => route.role === 'replica').length, candidates: query.candidateCount, resultLimit } },
      ],
    }
  }

  complete(request: StatefulRequest, success: boolean, nowMs: number): ComponentDomainEvent[] {
    const pending = this.pending.get(token(request))
    this.pending.delete(token(request))
    if (!pending) return []
    if (!success) return []
    if (pending.operation === 'write') {
      const accepted = pending.search.accept(pending.key, pending.mutationOperation ?? 'insert', nowMs)
      return [
        ...this.refreshEvents(accepted.refresh),
        { type: 'search-index-write-accepted', status: 'ok', bytes: pending.bytes, attributes: { key: pending.key, operation: accepted.mutation.operation, shard: accepted.mutation.shard, version: accepted.mutation.version, visibleAtMs: accepted.mutation.visibleAtMs, replicaVisibleAtMs: accepted.mutation.replicaVisibleAtMs } },
      ]
    }
    const query = pending.query!
    return [{ type: 'search-query-completed', status: 'ok', attributes: { key: pending.key, stale: query.stale, visible: query.visible, resultCount: query.resultCount, resultLimit: pending.resultLimit ?? query.resultCount, candidates: query.candidateCount, fanOut: query.fanOut, latestVersion: query.latestVersion, visibleVersion: query.visibleVersion, visibilityLagMs: query.visibilityLagMs } }]
  }

  snapshot(nowMs: number): ComponentStateSnapshot {
    const values = [...this.indexes.values()].map((search) => search.snapshot(nowMs))
    const sum = (select: (value: (typeof values)[number]) => number) => values.reduce((total, value) => total + select(value), 0)
    const queries = sum((value) => value.queries)
    const staleQueries = sum((value) => value.staleQueries)
    const queriesByShard = Array.from({ length: this.node.config.shardCount }, (_, shard) => values.reduce((total, value) => total + (value.queriesByShard[shard] ?? 0), 0))
    return {
      metrics: {
        searchStaleQueryRate: queries === 0 ? 0 : staleQueries / queries, searchPendingMutations: sum((value) => value.pendingMutations), searchReplicaRefreshBacklog: sum((value) => value.replicaRefreshBacklog),
        searchIndexWrites: sum((value) => value.acceptedWrites), searchIndexedMutations: sum((value) => value.indexedMutations), searchVisibleDocuments: sum((value) => value.visibleDocuments), searchQueries: queries, searchStaleQueries: staleQueries, searchShardSearches: sum((value) => value.shardSearches),
        searchCandidatesMerged: sum((value) => value.candidatesMerged), searchPrimaryShardQueries: sum((value) => value.primaryShardQueries), searchReplicaShardQueries: sum((value) => value.replicaShardQueries), searchMaxRefreshLagMs: Math.max(0, ...values.map((value) => value.maximumRefreshLagMs)),
        ...indexedMetrics('searchQueriesByShard', queriesByShard),
      },
      events: values.flatMap((value) => this.refreshEvents(value.refresh)),
    }
  }

  private indexFor(request: StatefulRequest) {
    const data = request.operationAction?.data
    const id = data ? `${data.modelId}:${data.objectId}` : '__capacity__'
    let search = this.indexes.get(id)
    if (!search) {
      search = new SearchIndexState({
        shardCount: this.node.config.shardCount, replicasPerShard: this.node.config.replicasPerShard, indexingDelayMs: this.node.config.indexingDelayMs,
        refreshIntervalMs: this.node.config.refreshIntervalMs, replicaRefreshDelayMs: this.node.config.replicaRefreshDelayMs,
        initialDocumentCount: data?.cardinality ?? this.node.config.keySpaceSize,
      })
      this.indexes.set(id, search)
    }
    return search
  }

  private refreshEvents(refresh: SearchRefreshResult): ComponentDomainEvent[] {
    if (refresh.primary.length === 0 && refresh.replicas.length === 0) return []
    const indexed = refresh.primary.map((mutation) => ({ type: 'search-document-indexed' as const, status: 'ok' as const, attributes: { key: mutation.key, operation: mutation.operation, shard: mutation.shard, version: mutation.version, visibleAtMs: mutation.visibleAtMs } }))
    const primary = refresh.primary.length === 0 ? [] : [{ type: 'search-index-refreshed' as const, status: 'ok' as const, attributes: { mutations: refresh.primary.length, shards: new Set(refresh.primary.map((mutation) => mutation.shard)).size, refreshBoundaryMs: Math.max(...refresh.primary.map((mutation) => mutation.visibleAtMs)) } }]
    const replicas = refresh.replicas.map(({ mutation, replica }) => ({ type: 'search-replica-refreshed' as const, status: 'ok' as const, attributes: { key: mutation.key, shard: mutation.shard, replica, version: mutation.version, visibleAtMs: mutation.replicaVisibleAtMs } }))
    return [...indexed, ...primary, ...replicas]
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

class TopicRuntime implements ComponentStateRuntime {
  private readonly topic
  private readonly subscriptionIds
  private readonly pending = new Map<string, { key: string; bytes: number }>()
  private readonly inFlight = new Map<string, Map<string, number[]>>()

  constructor(private readonly node: Extract<ComponentNode, { type: 'topic' }>) {
    this.subscriptionIds = Array.from({ length: node.config.subscriptionCount }, (_, index) => `subscription:${index}`)
    this.topic = new TopicState({ subscriptionIds: this.subscriptionIds, retentionMs: node.config.retentionMs, maxRetainedMessages: node.config.maxRetainedMessages })
  }

  begin(request: StatefulRequest, nowMs: number): ComponentStateDecision {
    const key = request.key ?? (request.operationAction?.event ? `${request.operationAction.event.eventId}:${request.id}` : `message:${request.id}`)
    this.pending.set(token(request), { key, bytes: request.bytes })
    return { patch: { key, outgoingPort: 'publish' }, events: this.expirationEvents(this.topic.expire(nowMs)) }
  }

  complete(request: StatefulRequest, success: boolean, nowMs: number): ComponentDomainEvent[] {
    const requestToken = token(request)
    const pending = this.pending.get(requestToken)
    this.pending.delete(requestToken)
    if (!pending || !success) return []
    const published = this.topic.publish(pending.key, pending.bytes, nowMs)
    return [
      ...this.expirationEvents(published.expired),
      { type: 'topic-message-published', status: 'ok', bytes: pending.bytes, attributes: { messageId: published.message.id, key: pending.key, fanOut: published.fanOut, expiresAtMs: published.message.expiresAtMs } },
    ]
  }

  prepareDelivery(request: StatefulRequest, subscriptionId: string, nowMs: number): ComponentDeliveryDecision {
    const deliveryToken = this.deliveryToken(request, subscriptionId)
    if (this.inFlight.has(deliveryToken)) return { deliver: false }
    const delivery = this.topic.deliver(subscriptionId, this.node.config.batchSize, nowMs)
    const ids = delivery.deliveries.map((item) => item.message.id)
    const deliveryBytes = delivery.deliveries.reduce((total, item) => total + item.message.bytes, 0)
    const events: ComponentDomainEvent[] = [
      ...this.expirationEvents(delivery.expired),
      ...delivery.deliveries.map((item) => this.deliveryEvent(item.subscriptionId, item.message, item.attempt)),
    ]
    if (ids.length === 0) return { deliver: false, events }
    if (this.node.config.acknowledgement === 'auto') {
      const acknowledged = this.topic.acknowledge(subscriptionId, ids, nowMs)
      events.push(...this.expirationEvents(acknowledged.expired), ...acknowledged.acknowledged.map((message) => this.acknowledgementEvent(subscriptionId, message)))
    } else this.inFlight.set(deliveryToken, new Map([[subscriptionId, ids]]))
    return { deliver: true, patch: { topicSubscriptionId: subscriptionId, topicMessageId: ids[0]!, bytes: deliveryBytes }, events }
  }

  dependencyComplete(request: StatefulRequest, success: boolean, nowMs: number): ComponentDomainEvent[] {
    const subscriptionId = request.topicSubscriptionId
    if (!subscriptionId) return []
    const requestToken = this.deliveryToken(request, subscriptionId)
    const batches = this.inFlight.get(requestToken)
    const messageIds = batches?.get(subscriptionId)
    if (!messageIds || messageIds.length === 0) return []
    batches!.delete(subscriptionId)
    if (batches!.size === 0) this.inFlight.delete(requestToken)
    if (!success) return this.expirationEvents(this.topic.release(subscriptionId, messageIds, nowMs))
    const acknowledged = this.topic.acknowledge(subscriptionId, messageIds, nowMs)
    return [...this.expirationEvents(acknowledged.expired), ...acknowledged.acknowledged.map((message) => this.acknowledgementEvent(subscriptionId, message))]
  }

  snapshot(nowMs: number): ComponentStateSnapshot {
    const value = this.topic.snapshot(nowMs)
    return {
      metrics: {
        topicPublished: value.published, topicPublishedBytes: value.publishedBytes, topicFanOutCopies: value.fanOutCopies, topicRetainedMessages: value.retainedMessages,
        topicSubscriptionBacklog: value.totalBacklog, topicMaximumSubscriptionBacklog: value.maximumSubscriptionBacklog, topicDelivered: value.delivered,
        topicAcknowledged: value.acknowledged, topicExpiredMessages: value.expiredMessages, topicTimeExpiredMessages: value.timeExpiredMessages,
        topicCapacityExpiredMessages: value.capacityExpiredMessages, topicExpiredDeliveries: value.expiredDeliveries,
        ...indexedMetrics('subscriptionBacklog', value.subscriptions.map((subscription) => subscription.backlog)),
        ...indexedMetrics('subscriptionInFlight', value.subscriptions.map((subscription) => subscription.inFlight)),
        ...indexedMetrics('subscriptionOldestAgeMs', value.subscriptions.map((subscription) => subscription.oldestUnacknowledgedAgeMs)),
      },
      events: this.expirationEvents(value.expired),
    }
  }

  private deliveryEvent(subscriptionId: string, message: TopicMessage, attempt: number): ComponentDomainEvent {
    return { type: 'topic-message-delivered', status: 'ok', bytes: message.bytes, attributes: { subscriptionId, messageId: message.id, key: message.key, attempt } }
  }

  private acknowledgementEvent(subscriptionId: string, message: TopicMessage): ComponentDomainEvent {
    return { type: 'topic-message-acknowledged', status: 'ok', bytes: message.bytes, attributes: { subscriptionId, messageId: message.id, key: message.key } }
  }

  private expirationEvents(expired: readonly TopicExpiredDelivery[]): ComponentDomainEvent[] {
    return expired.map(({ subscriptionId, message, wasInFlight, cause }) => ({ type: 'topic-message-expired', status: 'ok', bytes: message.bytes, attributes: { subscriptionId, messageId: message.id, key: message.key, wasInFlight, cause } }))
  }

  private deliveryToken(request: StatefulRequest, subscriptionId: string) {
    return `${request.id}:${subscriptionId}`
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
    case 'cdn': return new CdnRuntime(node)
    case 'search-index': return new SearchIndexRuntime(node)
    case 'stream': return new StreamRuntime(node)
    case 'topic': return new TopicRuntime(node)
    case 'object-storage': return new ObjectStorageRuntime(node)
    case 'database': return node.componentVersion === 2 ? new DatabaseRuntime(node) : undefined
    default: return undefined
  }
}
