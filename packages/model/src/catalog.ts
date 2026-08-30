import type { ComponentNode, ComponentType, Position } from './schema'

export interface ComponentDefinition {
  type: ComponentType
  label: string
  description: string
  category: 'traffic' | 'network' | 'routing' | 'compute' | 'data' | 'async'
  color: string
  acceptsInput: boolean
  emitsOutput: boolean
}

export const componentCatalog = {
  traffic: {
    type: 'traffic', label: 'Traffic Generator', description: 'Produces a configurable request workload.',
    category: 'traffic', color: '#8b5cf6', acceptsInput: false, emitsOutput: true,
  },
  network: {
    type: 'network', label: 'Network Link', description: 'Adds transfer time, latency, jitter and packet loss.',
    category: 'network', color: '#06b6d4', acceptsInput: true, emitsOutput: true,
  },
  'load-balancer': {
    type: 'load-balancer', label: 'Load Balancer', description: 'Routes requests across weighted, round-robin or healthy targets.',
    category: 'routing', color: '#ec4899', acceptsInput: true, emitsOutput: true,
  },
  service: {
    type: 'service', label: 'Service', description: 'A replicated concurrent request processor.',
    category: 'compute', color: '#3b82f6', acceptsInput: true, emitsOutput: true,
  },
  queue: {
    type: 'queue', label: 'Queue', description: 'Buffers work and delivers it through consumers.',
    category: 'async', color: '#f59e0b', acceptsInput: true, emitsOutput: true,
  },
  cache: {
    type: 'cache', label: 'Cache', description: 'Stores key-aware entries with bounded capacity, TTL and deterministic eviction.',
    category: 'data', color: '#14b8a6', acceptsInput: true, emitsOutput: true,
  },
  stream: {
    type: 'stream', label: 'Stream', description: 'Partitions published messages and tracks consumer-group delivery lag.',
    category: 'async', color: '#f97316', acceptsInput: true, emitsOutput: true,
  },
  'object-storage': {
    type: 'object-storage', label: 'Object Storage', description: 'Models concurrent object reads, writes and byte throughput.',
    category: 'data', color: '#6366f1', acceptsInput: true, emitsOutput: true,
  },
  database: {
    type: 'database', label: 'Database', description: 'Routes keyed reads and writes across shards, primaries and replicas.',
    category: 'data', color: '#10b981', acceptsInput: true, emitsOutput: true,
  },
} satisfies Record<ComponentType, ComponentDefinition>

export const createNode = (type: ComponentType, id: string, position: Position, workloadId = `${id}-workload`): ComponentNode => {
  const name = componentCatalog[type].label
  switch (type) {
    case 'traffic': return { id, name, position, type, config: { workloadId } }
    case 'network': return { id, name, position, type, config: { latencyMs: 20, jitterMs: 2, bandwidthMbps: 100, parallelism: 1_000, packetLossRate: 0, maxQueueSize: 10_000 } }
    case 'load-balancer': return { id, name, position, type, config: { algorithm: 'weighted', capacity: 1_000, routingTimeMs: 0.2, maxQueueSize: 10_000, failureThreshold: 1, recoveryTimeMs: 5_000 } }
    case 'service': return { id, name, position, type, config: { replicas: 2, concurrencyPerReplica: 10, serviceTimeMs: 30, jitterMs: 5, errorRate: 0, maxQueueSize: 1_000 } }
    case 'queue': return { id, name, position, type, config: { consumers: 4, deliveryTimeMs: 10, jitterMs: 2, maxDepth: 10_000, errorRate: 0 } }
    case 'cache': return { id, name, position, type, config: { capacityEntries: 10_000, ttlMs: 60_000, evictionPolicy: 'lru', keySpaceSize: 100_000, hotKeyProbability: 0, maxConcurrentRequests: 1_000, operationTimeMs: 1, jitterMs: 0.2, errorRate: 0, maxQueueSize: 10_000 } }
    case 'stream': return { id, name, position, type, config: { partitions: 12, producerCapacity: 1_000, consumerGroups: 1, consumersPerGroup: 4, batchSize: 100, acknowledgement: 'explicit', publishTimeMs: 2, consumeTimeMs: 10, jitterMs: 1, maxDepth: 1_000_000, errorRate: 0 } }
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
