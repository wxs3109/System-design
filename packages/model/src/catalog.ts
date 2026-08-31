import type { ComponentNode, ComponentType, Position } from './schema'

export interface ComponentDefinition {
  type: ComponentType
  label: string
  description: string
  category: 'traffic' | 'automation' | 'network' | 'gateway' | 'service' | 'cache' | 'database' | 'object-storage' | 'messaging'
  color: string
  acceptsInput: boolean
  emitsOutput: boolean
}

export const componentCatalog = {
  traffic: {
    type: 'traffic', label: 'Traffic Generator', description: 'Produces a configurable request workload.',
    category: 'traffic', color: '#8b5cf6', acceptsInput: false, emitsOutput: true,
  },
  scheduler: {
    type: 'scheduler', label: 'Scheduler', description: 'Releases periodic and batch work with deterministic jitter and missed-run handling.',
    category: 'automation', color: '#d97706', acceptsInput: false, emitsOutput: true,
  },
  workflow: {
    type: 'workflow', label: 'Workflow', description: 'Persists multi-step executions with idempotency, bounded retry, timeout, and compensation.',
    category: 'automation', color: '#c2410c', acceptsInput: true, emitsOutput: true,
  },
  network: {
    type: 'network', label: 'Network Link', description: 'Adds transfer time, latency, jitter and packet loss.',
    category: 'network', color: '#06b6d4', acceptsInput: true, emitsOutput: true,
  },
  'load-balancer': {
    type: 'load-balancer', label: 'Load Balancer', description: 'Routes requests across weighted, round-robin or healthy targets.',
    category: 'gateway', color: '#ec4899', acceptsInput: true, emitsOutput: true,
  },
  'realtime-gateway': {
    type: 'realtime-gateway', label: 'Realtime Gateway', description: 'Maintains long-lived channel memberships and broadcasts with per-connection backpressure.',
    category: 'gateway', color: '#db2777', acceptsInput: true, emitsOutput: true,
  },
  service: {
    type: 'service', label: 'Service', description: 'A replicated concurrent request processor.',
    category: 'service', color: '#3b82f6', acceptsInput: true, emitsOutput: true,
  },
  queue: {
    type: 'queue', label: 'Queue', description: 'Buffers work and delivers it through consumers.',
    category: 'messaging', color: '#f59e0b', acceptsInput: true, emitsOutput: true,
  },
  cache: {
    type: 'cache', label: 'Cache', description: 'Stores key-aware entries with bounded capacity, TTL and deterministic eviction.',
    category: 'cache', color: '#14b8a6', acceptsInput: true, emitsOutput: true,
  },
  cdn: {
    type: 'cdn', label: 'CDN', description: 'Selects edge POPs and caches origin objects with bandwidth-aware delivery.',
    category: 'cache', color: '#0d9488', acceptsInput: true, emitsOutput: true,
  },
  'search-index': {
    type: 'search-index', label: 'Search Index', description: 'Indexes documents with refresh delay and fans queries across shard copies.',
    category: 'database', color: '#7c3aed', acceptsInput: true, emitsOutput: true,
  },
  stream: {
    type: 'stream', label: 'Stream', description: 'Partitions published messages and tracks consumer-group delivery lag.',
    category: 'messaging', color: '#f97316', acceptsInput: true, emitsOutput: true,
  },
  topic: {
    type: 'topic', label: 'Topic', description: 'Fans each publication into independently retained subscription backlogs.',
    category: 'messaging', color: '#ea580c', acceptsInput: true, emitsOutput: true,
  },
  'object-storage': {
    type: 'object-storage', label: 'Object Storage', description: 'Models concurrent object reads, writes and byte throughput.',
    category: 'object-storage', color: '#6366f1', acceptsInput: true, emitsOutput: true,
  },
  database: {
    type: 'database', label: 'Database', description: 'Routes keyed reads and writes across shards, primaries and replicas.',
    category: 'database', color: '#10b981', acceptsInput: true, emitsOutput: true,
  },
} satisfies Record<ComponentType, ComponentDefinition>

export const createNode = (type: ComponentType, id: string, position: Position, workloadId = `${id}-workload`): ComponentNode => {
  const name = componentCatalog[type].label
  switch (type) {
    case 'traffic': return { id, name, position, type, config: { workloadId } }
    case 'scheduler': return { id, name, position, type, config: { scheduleMode: 'periodic', intervalMs: 1_000, startAtMs: 0, batchSize: 1, jitterMs: 0, missedRunPolicy: 'skip', concurrencyLimit: 1, maxPendingRuns: 1_000, requestBytes: 1_024 } }
    case 'workflow': return { id, name, position, type, config: { maxConcurrentInstances: 1_000, persistenceTimeMs: 2, defaultStepTimeMs: 100, jitterMs: 1, errorRate: 0, maxQueueSize: 10_000 } }
    case 'network': return { id, name, position, type, config: { latencyMs: 20, jitterMs: 2, bandwidthMbps: 100, parallelism: 1_000, packetLossRate: 0, maxQueueSize: 10_000 } }
    case 'load-balancer': return { id, name, position, type, config: { algorithm: 'weighted', capacity: 1_000, routingTimeMs: 0.2, maxQueueSize: 10_000, failureThreshold: 1, recoveryTimeMs: 5_000 } }
    case 'realtime-gateway': return { id, name, position, type, config: { maxConnections: 100_000, connectionDurationMs: 60_000, maxChannelsPerConnection: 10, defaultChannelCount: 100, maxConcurrentMessages: 1_000, handshakeTimeMs: 2, broadcastBaseTimeMs: 1, fanOutTimePerConnectionMs: 0.01, defaultMessageBytes: 1_024, outboundBandwidthMbps: 10, slowConnectionFraction: 0, slowConnectionBandwidthMbps: 0.1, maxPendingBytesPerConnection: 1_048_576, overflowPolicy: 'drop-message', jitterMs: 0.5, errorRate: 0, maxQueueSize: 100_000 } }
    case 'service': return { id, name, position, type, config: { replicas: 2, concurrencyPerReplica: 10, serviceTimeMs: 30, jitterMs: 5, errorRate: 0, maxQueueSize: 1_000 } }
    case 'queue': return { id, name, position, type, config: { consumers: 4, deliveryTimeMs: 10, jitterMs: 2, maxDepth: 10_000, errorRate: 0 } }
    case 'cache': return { id, name, position, type, config: { capacityEntries: 10_000, ttlMs: 60_000, evictionPolicy: 'lru', keySpaceSize: 100_000, hotKeyProbability: 0, maxConcurrentRequests: 1_000, operationTimeMs: 1, jitterMs: 0.2, errorRate: 0, maxQueueSize: 10_000 } }
    case 'cdn': return { id, name, position, type, config: { popCount: 4, popSelection: 'consistent-hash', capacityEntriesPerPop: 10_000, ttlMs: 300_000, evictionPolicy: 'lru', keySpaceSize: 100_000, hotKeyProbability: 0, maxConcurrentRequests: 10_000, lookupTimeMs: 0.5, edgeLatencyMs: 10, edgeBandwidthMbps: 1_000, originRoundTripMs: 80, originBandwidthMbps: 500, defaultObjectSizeBytes: 1_048_576, jitterMs: 1, errorRate: 0, maxQueueSize: 100_000 } }
    case 'search-index': return { id, name, position, type, config: { shardCount: 6, replicasPerShard: 1, maxConcurrentRequestsPerCopy: 100, maxQueueSize: 100_000, writeRatio: 0.2, keySpaceSize: 1_000_000, hotKeyProbability: 0, indexingDelayMs: 200, refreshIntervalMs: 1_000, replicaRefreshDelayMs: 100, queryBaseTimeMs: 2, shardQueryTimeMs: 4, fanOutTimePerShardMs: 0.2, mergeTimePerCandidateMs: 0.01, defaultResultLimit: 20, indexWriteTimeMs: 3, indexingThroughputMbps: 500, jitterMs: 1, errorRate: 0 } }
    case 'stream': return { id, name, position, type, config: { partitions: 12, producerCapacity: 1_000, consumerGroups: 1, consumersPerGroup: 4, batchSize: 100, acknowledgement: 'explicit', publishTimeMs: 2, consumeTimeMs: 10, jitterMs: 1, maxDepth: 1_000_000, errorRate: 0 } }
    case 'topic': return { id, name, position, type, config: { subscriptionCount: 2, maxRetainedMessages: 1_000_000, retentionMs: 86_400_000, batchSize: 100, acknowledgement: 'explicit', publishCapacity: 1_000, publishTimeMs: 2, deliveryTimeMs: 10, jitterMs: 1, maxQueueSize: 1_000_000, errorRate: 0 } }
    case 'object-storage': return { id, name, position, type, config: { maxConcurrentRequests: 1_000, defaultObjectSizeBytes: 1_048_576, readRatio: 0.8, baseLatencyMs: 20, jitterMs: 3, readThroughputMbps: 1_000, writeThroughputMbps: 500, errorRate: 0.001, maxQueueSize: 100_000 } }
    case 'database': return { id, name, position, type, config: { maxConnections: 100, queryTimeMs: 12, jitterMs: 3, errorRate: 0.001, maxQueueSize: 10_000, shardCount: 1, replicasPerShard: 0, readPreference: 'primary', replicationDelayMs: 100, writeRatio: 0.2, keySpaceSize: 1_000_000, hotKeyProbability: 0 } }
  }
}

export const canConnect = (source: ComponentNode | undefined, target: ComponentNode | undefined): { valid: boolean; reason?: string } => {
  if (!source || !target) return { valid: false, reason: 'Both endpoints must exist.' }
  if (source.id === target.id) return { valid: false, reason: 'A node cannot connect directly to itself.' }
  if (!componentCatalog[source.type].emitsOutput) return { valid: false, reason: `${source.name} has no output port.` }
  if (!componentCatalog[target.type].acceptsInput) return { valid: false, reason: `${target.name} has no input port.` }
  return { valid: true }
}
