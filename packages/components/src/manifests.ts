import { z } from 'zod'
import {
  backpressurePolicyConfigSchema,
  cacheConfigSchema,
  circuitBreakerPolicyConfigSchema,
  databaseConfigSchema,
  databaseV1ConfigSchema,
  loadBalancerConfigSchema,
  networkConfigSchema,
  objectStorageConfigSchema,
  queueConfigSchema,
  retryPolicyConfigSchema,
  schedulerConfigSchema,
  serviceConfigSchema,
  streamConfigSchema,
  timeoutPolicyConfigSchema,
  tokenBucketPolicyConfigSchema,
  type ComponentNode,
  type ComponentType,
  type Position,
} from '@system-design/model'
import { ComponentCatalog, ComponentCategoryRegistry, ComponentPresetRegistry, ComponentRegistry, PolicyRegistry, type BuiltInComponentNode, type ComponentCategoryManifest, type ComponentManifest, type ComponentPresetManifest, type PolicyManifest } from './registry'

const requestInput = { id: 'in', label: 'Request', direction: 'input', semantic: 'request', multiple: true } as const
const requestOutput = { id: 'out', label: 'Request', direction: 'output', semantic: 'request', multiple: true } as const
const messageInput = { id: 'consume', label: 'Consume', direction: 'input', semantic: 'consume', multiple: true } as const
const messageOutput = { id: 'publish', label: 'Publish', direction: 'output', semantic: 'publish', multiple: true } as const
const cacheHitOutput = { id: 'hit', label: 'Hit', direction: 'output', semantic: 'hit', multiple: true } as const
const cacheMissOutput = { id: 'miss', label: 'Miss', direction: 'output', semantic: 'miss', multiple: true } as const

export const builtInComponentCategoryManifests = [
  { id: 'traffic', label: 'Traffic', description: 'Request and workload sources.', iconToken: 'globe', color: '#8b5cf6', order: 10 },
  { id: 'automation', label: 'Automation', description: 'Scheduled and orchestrated work releases.', iconToken: 'calendar-clock', color: '#d97706', order: 15 },
  { id: 'network', label: 'Network', description: 'Transfer boundaries and network conditions.', iconToken: 'activity', color: '#06b6d4', order: 20 },
  { id: 'gateway', label: 'Gateway & Routing', description: 'Request routing and distribution boundaries.', iconToken: 'git-fork', color: '#ec4899', order: 30 },
  { id: 'service', label: 'Service', description: 'Synchronous and background request processing.', iconToken: 'server', color: '#3b82f6', order: 40 },
  { id: 'cache', label: 'Cache', description: 'Key-aware cached data and eviction.', iconToken: 'hard-drive', color: '#14b8a6', order: 50 },
  { id: 'database', label: 'Database', description: 'Persistent keyed data, shards, and replicas.', iconToken: 'database', color: '#10b981', order: 60 },
  { id: 'object-storage', label: 'Object Storage', description: 'Large-object reads, writes, and byte throughput.', iconToken: 'archive', color: '#6366f1', order: 70 },
  { id: 'messaging', label: 'Messaging', description: 'Queues, streams, and asynchronous delivery.', iconToken: 'layers', color: '#f59e0b', order: 80 },
] as const satisfies readonly ComponentCategoryManifest[]

export const componentCategoryRegistry = new ComponentCategoryRegistry(builtInComponentCategoryManifests)

export const builtInComponentManifests = [
  {
    type: 'traffic', version: 1, label: 'Traffic Generator', description: 'Produces a configurable request workload.', category: 'traffic', iconToken: 'globe', color: '#8b5cf6',
    configSchema: z.object({}), createDefaultConfig: () => ({}), configFields: [], ports: [requestOutput],
    capabilities: ['workload-source'], emittedMetrics: ['generated-requests'], supportedFaults: [], runtimeBehavior: 'traffic-v1',
    describeConfig: () => 'workload source',
  },
  {
    type: 'scheduler', version: 1, label: 'Scheduler', description: 'Releases periodic batches and applies deterministic jitter, missed-run policy, and concurrency limits.', category: 'automation', iconToken: 'calendar-clock', color: '#d97706',
    configSchema: schedulerConfigSchema, createDefaultConfig: () => ({ scheduleMode: 'periodic', intervalMs: 1_000, startAtMs: 0, batchSize: 1, jitterMs: 0, missedRunPolicy: 'skip', concurrencyLimit: 1, maxPendingRuns: 1_000, requestBytes: 1_024 }),
    configFields: [
      { kind: 'select', key: 'scheduleMode', label: 'Schedule mode', options: [{ value: 'periodic', label: 'Periodic' }, { value: 'batch', label: 'Batch' }] },
      { kind: 'number', key: 'intervalMs', label: 'Interval (ms)', min: 0.001, step: 100 },
      { kind: 'number', key: 'startAtMs', label: 'Start at (ms)', min: 0, step: 100 },
      { kind: 'number', key: 'batchSize', label: 'Runs / interval', min: 1, step: 1 },
      { kind: 'number', key: 'jitterMs', label: 'Release jitter (ms)', min: 0, step: 10, description: 'Maximum deterministic offset before or after each scheduled release.' },
      { kind: 'select', key: 'missedRunPolicy', label: 'Missed-run policy', options: [{ value: 'skip', label: 'Skip' }, { value: 'catch-up', label: 'Catch up' }] },
      { kind: 'number', key: 'concurrencyLimit', label: 'Concurrent runs', min: 1, step: 1 },
      { kind: 'number', key: 'maxPendingRuns', label: 'Pending-run limit', min: 0, step: 1 },
      { kind: 'number', key: 'requestBytes', label: 'Run payload (bytes)', min: 1, step: 1_024 },
    ], ports: [requestOutput], capabilities: ['workload-source', 'scheduling', 'batch-release', 'missed-run-policy'], emittedMetrics: ['scheduled-runs', 'released-runs', 'queued-runs', 'skipped-runs', 'active-runs'], supportedFaults: [], runtimeBehavior: 'scheduler-v1',
    describeConfig: (config) => `${config.scheduleMode === 'batch' ? config.batchSize : 1} run${config.scheduleMode === 'batch' && config.batchSize !== 1 ? 's' : ''} every ${config.intervalMs} ms · ${config.concurrencyLimit} concurrent · ${config.missedRunPolicy}`,
  },
  {
    type: 'network', version: 1, label: 'Network Link', description: 'Adds transfer time, latency, jitter and packet loss.', category: 'network', iconToken: 'activity', color: '#06b6d4',
    configSchema: networkConfigSchema, createDefaultConfig: () => ({ latencyMs: 20, jitterMs: 2, bandwidthMbps: 100, parallelism: 1_000, packetLossRate: 0, maxQueueSize: 10_000 }),
    configFields: [
      { kind: 'number', key: 'latencyMs', label: 'Latency (ms)', min: 0, step: 1 },
      { kind: 'number', key: 'jitterMs', label: 'Jitter (ms)', min: 0, step: 1 },
      { kind: 'number', key: 'bandwidthMbps', label: 'Bandwidth (Mbps)', min: 0.1, step: 10 },
      { kind: 'number', key: 'parallelism', label: 'Parallelism', min: 1, step: 1 },
      { kind: 'number', key: 'packetLossRate', label: 'Packet loss (0–1)', min: 0, max: 1, step: 0.001 },
      { kind: 'number', key: 'maxQueueSize', label: 'Max queue', min: 0, step: 1 },
    ], ports: [requestInput, requestOutput], capabilities: ['network'], emittedMetrics: ['latency', 'utilization', 'queue'], supportedFaults: ['node-down', 'latency-spike', 'capacity-drop', 'bandwidth-drop', 'packet-loss', 'region-outage'], runtimeBehavior: 'network-v1',
    describeConfig: (config) => `${config.latencyMs} ms · ${config.bandwidthMbps} Mbps`,
  },
  {
    type: 'load-balancer', version: 1, label: 'Load Balancer', description: 'Selects a target using weighted, round-robin or health-aware routing.', category: 'gateway', iconToken: 'git-fork', color: '#ec4899',
    configSchema: loadBalancerConfigSchema, createDefaultConfig: () => ({ algorithm: 'weighted', capacity: 1_000, routingTimeMs: 0.2, maxQueueSize: 10_000, failureThreshold: 1, recoveryTimeMs: 5_000 }),
    configFields: [
      { kind: 'select', key: 'algorithm', label: 'Routing algorithm', options: [
        { value: 'weighted', label: 'Weighted' },
        { value: 'round-robin', label: 'Round robin' },
        { value: 'health-aware', label: 'Health aware' },
      ] },
      { kind: 'number', key: 'capacity', label: 'Concurrent requests', min: 1, step: 1 },
      { kind: 'number', key: 'routingTimeMs', label: 'Routing time (ms)', min: 0.001, step: 0.1 },
      { kind: 'number', key: 'maxQueueSize', label: 'Max queue', min: 0, step: 1 },
      { kind: 'number', key: 'failureThreshold', label: 'Failures before unhealthy', min: 1, step: 1 },
      { kind: 'number', key: 'recoveryTimeMs', label: 'Health recovery (ms)', min: 0, step: 100 },
    ], ports: [requestInput, requestOutput], capabilities: ['routing', 'load-balancing', 'health-aware-routing'], emittedMetrics: ['latency', 'utilization', 'queue', 'requests-per-target', 'target-imbalance'], supportedFaults: ['node-down', 'latency-spike', 'capacity-drop'], runtimeBehavior: 'load-balancer-v1',
    describeConfig: (config) => `${config.algorithm} · ${config.capacity} concurrent`,
  },
  {
    type: 'service', version: 1, label: 'Service', description: 'A replicated concurrent request processor. Project API contracts remain descriptive until the operation-aware runtime.', category: 'service', iconToken: 'server', color: '#3b82f6',
    configSchema: serviceConfigSchema, createDefaultConfig: () => ({ replicas: 2, concurrencyPerReplica: 10, serviceTimeMs: 30, jitterMs: 5, errorRate: 0, maxQueueSize: 1_000 }),
    configFields: [
      { kind: 'number', key: 'replicas', label: 'Replicas', min: 1, step: 1 },
      { kind: 'number', key: 'concurrencyPerReplica', label: 'Concurrency / replica', min: 1, step: 1 },
      { kind: 'number', key: 'serviceTimeMs', label: 'Service time (ms)', min: 0.1, step: 1 },
      { kind: 'number', key: 'jitterMs', label: 'Jitter (ms)', min: 0, step: 1 },
      { kind: 'number', key: 'maxQueueSize', label: 'Max queue', min: 0, step: 1 },
      { kind: 'number', key: 'errorRate', label: 'Error rate (0–1)', min: 0, max: 1, step: 0.001 },
    ], ports: [requestInput, messageInput, requestOutput, messageOutput], capabilities: ['compute', 'asynchronous-delivery'], emittedMetrics: ['latency', 'utilization', 'queue'], supportedFaults: ['node-down', 'latency-spike', 'capacity-drop'], runtimeBehavior: 'service-v1',
    describeConfig: (config) => `${config.replicas} × ${config.concurrencyPerReplica} concurrent`,
  },
  {
    type: 'queue', version: 1, label: 'Queue', description: 'Buffers work and delivers it through consumers.', category: 'messaging', iconToken: 'layers', color: '#f59e0b',
    configSchema: queueConfigSchema, createDefaultConfig: () => ({ consumers: 4, deliveryTimeMs: 10, jitterMs: 2, maxDepth: 10_000, errorRate: 0 }),
    configFields: [
      { kind: 'number', key: 'consumers', label: 'Consumers', min: 1, step: 1 },
      { kind: 'number', key: 'deliveryTimeMs', label: 'Delivery time (ms)', min: 0.1, step: 1 },
      { kind: 'number', key: 'jitterMs', label: 'Jitter (ms)', min: 0, step: 1 },
      { kind: 'number', key: 'maxDepth', label: 'Max depth', min: 1, step: 1 },
      { kind: 'number', key: 'errorRate', label: 'Error rate (0–1)', min: 0, max: 1, step: 0.001 },
    ], ports: [requestInput, messageInput, requestOutput, messageOutput], capabilities: ['buffering', 'asynchronous-delivery'], emittedMetrics: ['latency', 'utilization', 'queue'], supportedFaults: ['node-down', 'latency-spike', 'capacity-drop'], runtimeBehavior: 'queue-v1',
    describeConfig: (config) => `${config.consumers} consumers · ${config.maxDepth} max`,
  },
  {
    type: 'cache', version: 1, label: 'Cache', description: 'Stores key-aware entries with bounded capacity, virtual-time TTL and deterministic eviction.', category: 'cache', iconToken: 'hard-drive', color: '#14b8a6',
    configSchema: cacheConfigSchema, createDefaultConfig: () => ({ capacityEntries: 10_000, ttlMs: 60_000, evictionPolicy: 'lru', keySpaceSize: 100_000, hotKeyProbability: 0, maxConcurrentRequests: 1_000, operationTimeMs: 1, jitterMs: 0.2, errorRate: 0, maxQueueSize: 10_000 }),
    configFields: [
      { kind: 'number', key: 'capacityEntries', label: 'Capacity (entries)', min: 1, step: 1 },
      { kind: 'number', key: 'ttlMs', label: 'TTL (ms)', min: 0.001, step: 100 },
      { kind: 'select', key: 'evictionPolicy', label: 'Eviction policy', options: [{ value: 'lru', label: 'LRU' }, { value: 'fifo', label: 'FIFO' }] },
      { kind: 'number', key: 'keySpaceSize', label: 'Key space', min: 1, step: 1 },
      { kind: 'number', key: 'hotKeyProbability', label: 'Hot-key probability (0–1)', min: 0, max: 1, step: 0.05 },
      { kind: 'number', key: 'maxConcurrentRequests', label: 'Concurrent requests', min: 1, step: 1 },
      { kind: 'number', key: 'operationTimeMs', label: 'Operation time (ms)', min: 0.001, step: 0.1 },
      { kind: 'number', key: 'jitterMs', label: 'Jitter (ms)', min: 0, step: 0.1 },
      { kind: 'number', key: 'maxQueueSize', label: 'Max queue', min: 0, step: 1 },
      { kind: 'number', key: 'errorRate', label: 'Error rate (0–1)', min: 0, max: 1, step: 0.001 },
    ], ports: [requestInput, cacheHitOutput, cacheMissOutput], capabilities: ['storage', 'caching', 'key-routing'], emittedMetrics: ['latency', 'utilization', 'queue', 'cache-hit-rate', 'cache-evictions', 'cache-occupancy'], supportedFaults: ['node-down', 'latency-spike', 'capacity-drop'], runtimeBehavior: 'cache-v1',
    describeConfig: (config) => `${config.capacityEntries} entries · ${config.ttlMs} ms TTL · ${String(config.evictionPolicy).toUpperCase()}`,
  },
  {
    type: 'stream', version: 1, label: 'Stream', description: 'Partitions messages and tracks acknowledged delivery independently for each consumer group.', category: 'messaging', iconToken: 'radio-tower', color: '#f97316',
    configSchema: streamConfigSchema, createDefaultConfig: () => ({ partitions: 12, producerCapacity: 1_000, consumerGroups: 1, consumersPerGroup: 4, batchSize: 100, acknowledgement: 'explicit', publishTimeMs: 2, consumeTimeMs: 10, jitterMs: 1, maxDepth: 1_000_000, errorRate: 0 }),
    configFields: [
      { kind: 'number', key: 'partitions', label: 'Partitions', min: 1, step: 1 },
      { kind: 'number', key: 'producerCapacity', label: 'Producer capacity', min: 1, step: 1 },
      { kind: 'number', key: 'consumerGroups', label: 'Consumer groups', min: 1, step: 1 },
      { kind: 'number', key: 'consumersPerGroup', label: 'Consumers / group', min: 1, step: 1 },
      { kind: 'number', key: 'batchSize', label: 'Batch size', min: 1, step: 1 },
      { kind: 'select', key: 'acknowledgement', label: 'Acknowledgement', options: [{ value: 'auto', label: 'Auto' }, { value: 'explicit', label: 'Explicit' }] },
      { kind: 'number', key: 'publishTimeMs', label: 'Publish time (ms)', min: 0.001, step: 0.1 },
      { kind: 'number', key: 'consumeTimeMs', label: 'Consume time (ms)', min: 0.001, step: 0.1 },
      { kind: 'number', key: 'jitterMs', label: 'Jitter (ms)', min: 0, step: 0.1 },
      { kind: 'number', key: 'maxDepth', label: 'Max producer queue', min: 1, step: 1 },
      { kind: 'number', key: 'errorRate', label: 'Error rate (0–1)', min: 0, max: 1, step: 0.001 },
    ], ports: [messageInput, messageOutput], capabilities: ['buffering', 'streaming', 'partitioning', 'consumer-groups', 'asynchronous-delivery'], emittedMetrics: ['publish-rate', 'consumer-rate', 'consumer-lag', 'partition-imbalance', 'utilization'], supportedFaults: ['node-down', 'latency-spike', 'capacity-drop'], runtimeBehavior: 'stream-v1',
    describeConfig: (config) => `${config.partitions} partitions · ${config.consumerGroups} groups · batch ${config.batchSize}`,
  },
  {
    type: 'object-storage', version: 1, label: 'Object Storage', description: 'Models bounded object reads and writes with byte-dependent transfer time.', category: 'object-storage', iconToken: 'archive', color: '#6366f1',
    configSchema: objectStorageConfigSchema, createDefaultConfig: () => ({ maxConcurrentRequests: 1_000, defaultObjectSizeBytes: 1_048_576, readRatio: 0.8, baseLatencyMs: 20, jitterMs: 3, readThroughputMbps: 1_000, writeThroughputMbps: 500, errorRate: 0.001, maxQueueSize: 100_000 }),
    configFields: [
      { kind: 'number', key: 'maxConcurrentRequests', label: 'Concurrent requests', min: 1, step: 1 },
      { kind: 'number', key: 'defaultObjectSizeBytes', label: 'Object size (bytes)', min: 1, step: 1_024 },
      { kind: 'number', key: 'readRatio', label: 'Read ratio (0–1)', min: 0, max: 1, step: 0.05 },
      { kind: 'number', key: 'baseLatencyMs', label: 'Base latency (ms)', min: 0.001, step: 1 },
      { kind: 'number', key: 'jitterMs', label: 'Jitter (ms)', min: 0, step: 1 },
      { kind: 'number', key: 'readThroughputMbps', label: 'Read throughput (Mbps)', min: 0.001, step: 10 },
      { kind: 'number', key: 'writeThroughputMbps', label: 'Write throughput (Mbps)', min: 0.001, step: 10 },
      { kind: 'number', key: 'maxQueueSize', label: 'Max queue', min: 0, step: 1 },
      { kind: 'number', key: 'errorRate', label: 'Error rate (0–1)', min: 0, max: 1, step: 0.001 },
    ], ports: [requestInput, messageInput, requestOutput], capabilities: ['storage', 'object-storage', 'byte-throughput', 'asynchronous-delivery'], emittedMetrics: ['operations', 'bytes', 'latency', 'utilization', 'queue'], supportedFaults: ['node-down', 'latency-spike', 'capacity-drop'], runtimeBehavior: 'object-storage-v1',
    describeConfig: (config) => `${config.maxConcurrentRequests} concurrent · ${config.readThroughputMbps}/${config.writeThroughputMbps} Mbps read/write`,
  },
  {
    type: 'database', version: 1, label: 'Capacity Database', description: 'A bounded connection pool and query resource.', category: 'database', iconToken: 'database', color: '#10b981',
    configSchema: databaseV1ConfigSchema, createDefaultConfig: () => ({ maxConnections: 100, queryTimeMs: 12, jitterMs: 3, errorRate: 0.001, maxQueueSize: 10_000 }),
    configFields: [
      { kind: 'number', key: 'maxConnections', label: 'Max connections', min: 1, step: 1 },
      { kind: 'number', key: 'queryTimeMs', label: 'Query time (ms)', min: 0.1, step: 1 },
      { kind: 'number', key: 'jitterMs', label: 'Jitter (ms)', min: 0, step: 1 },
      { kind: 'number', key: 'maxQueueSize', label: 'Max queue', min: 0, step: 1 },
      { kind: 'number', key: 'errorRate', label: 'Error rate (0–1)', min: 0, max: 1, step: 0.001 },
    ], ports: [requestInput, requestOutput], capabilities: ['storage'], emittedMetrics: ['latency', 'utilization', 'queue'], supportedFaults: ['node-down', 'latency-spike', 'capacity-drop'], runtimeBehavior: 'database-v1',
    describeConfig: (config) => `${config.maxConnections} connections · ${config.queryTimeMs} ms`,
  },
  {
    type: 'database', version: 2, label: 'Database', description: 'Routes generic keyed reads and writes across shards and replicas. Project data models remain descriptive until the operation-aware runtime.', category: 'database', iconToken: 'database', color: '#10b981',
    configSchema: databaseConfigSchema, createDefaultConfig: () => ({ maxConnections: 100, queryTimeMs: 12, jitterMs: 3, errorRate: 0.001, maxQueueSize: 10_000, shardCount: 1, replicasPerShard: 0, readPreference: 'primary', replicationDelayMs: 100, writeRatio: 0.2, keySpaceSize: 1_000_000, hotKeyProbability: 0 }),
    configFields: [
      { kind: 'number', key: 'maxConnections', label: 'Connections / node', min: 1, step: 1 },
      { kind: 'number', key: 'queryTimeMs', label: 'Query time (ms)', min: 0.1, step: 1 },
      { kind: 'number', key: 'jitterMs', label: 'Jitter (ms)', min: 0, step: 1 },
      { kind: 'number', key: 'maxQueueSize', label: 'Max queue', min: 0, step: 1 },
      { kind: 'number', key: 'errorRate', label: 'Error rate (0–1)', min: 0, max: 1, step: 0.001 },
      { kind: 'number', key: 'shardCount', label: 'Shards', min: 1, step: 1 },
      { kind: 'number', key: 'replicasPerShard', label: 'Replicas / shard', min: 0, step: 1 },
      { kind: 'select', key: 'readPreference', label: 'Read preference', options: [{ value: 'primary', label: 'Primary' }, { value: 'replica-preferred', label: 'Replica preferred' }, { value: 'replica-only', label: 'Replica only' }] },
      { kind: 'number', key: 'replicationDelayMs', label: 'Replication delay (ms)', min: 0, step: 10 },
      { kind: 'number', key: 'writeRatio', label: 'Write ratio (0–1)', min: 0, max: 1, step: 0.05 },
      { kind: 'number', key: 'keySpaceSize', label: 'Key space', min: 1, step: 1 },
      { kind: 'number', key: 'hotKeyProbability', label: 'Hot-key probability (0–1)', min: 0, max: 1, step: 0.05 },
    ], ports: [requestInput, requestOutput], capabilities: ['storage', 'sharding', 'replication', 'key-routing'], emittedMetrics: ['latency', 'utilization', 'queue', 'requests-per-shard', 'hot-shard-ratio', 'replica-lag'], supportedFaults: ['node-down', 'latency-spike', 'capacity-drop'], runtimeBehavior: 'database-v2',
    describeConfig: (config) => `${config.shardCount} shards · ${config.replicasPerShard} replicas / shard · ${config.readPreference}`,
  },
] as const satisfies readonly ComponentManifest[]

export const componentRegistry = new ComponentRegistry(builtInComponentManifests)

export const builtInComponentPresetManifests = [
  { id: 'client', version: 1, label: 'Client', description: 'A named request source using the Traffic Generator behavior.', iconToken: 'globe', behavior: { type: 'traffic', version: 1 }, configOverrides: {} },
  { id: 'api-gateway', version: 1, label: 'Gateway routing template', description: 'Legacy capacity template using Load Balancer behavior; it does not model API contracts.', iconToken: 'git-fork', behavior: { type: 'load-balancer', version: 1 }, configOverrides: { algorithm: 'weighted', capacity: 2_000, routingTimeMs: 1, maxQueueSize: 10_000 }, availability: 'legacy' },
  { id: 'worker', version: 1, label: 'Worker', description: 'A background processor using the Service behavior.', iconToken: 'server', behavior: { type: 'service', version: 1 }, configOverrides: { replicas: 4, concurrencyPerReplica: 1, serviceTimeMs: 50, jitterMs: 5, maxQueueSize: 1_000, errorRate: 0 } },
  { id: 'sql-store', version: 1, label: 'Legacy SQL capacity template', description: 'Legacy Database configuration; it does not model relational tables, indexes, or SQL.', iconToken: 'database', behavior: { type: 'database', version: 2 }, configOverrides: { shardCount: 1, replicasPerShard: 1, readPreference: 'primary', writeRatio: 0.5 }, availability: 'legacy' },
  { id: 'nosql-store', version: 1, label: 'Legacy NoSQL capacity template', description: 'Legacy Database configuration; it does not model document or key-value schemas.', iconToken: 'database', behavior: { type: 'database', version: 2 }, configOverrides: { shardCount: 8, replicasPerShard: 2, readPreference: 'replica-preferred', writeRatio: 0.2 }, availability: 'legacy' },
] as const satisfies readonly ComponentPresetManifest[]

export const componentPresetRegistry = new ComponentPresetRegistry(componentRegistry, builtInComponentPresetManifests)

export const componentCatalog = new ComponentCatalog(componentCategoryRegistry, componentRegistry, componentPresetRegistry)

/** @deprecated ProjectFile v2 calls these role presets. Use builtInComponentPresetManifests. */
export const builtInRolePresetManifests = builtInComponentPresetManifests
/** @deprecated ProjectFile v2 calls these role presets. Use componentPresetRegistry. */
export const rolePresetRegistry = componentPresetRegistry

export const builtInPolicyManifests = [
  {
    type: 'timeout', version: 1, label: 'Timeout', description: 'Fails an outbound attempt after a deterministic virtual-time deadline.', targets: ['edge'],
    configSchema: timeoutPolicyConfigSchema, defaultConfig: { timeoutMs: 1_000 }, singletonPerTarget: true,
    configFields: [{ kind: 'number', key: 'timeoutMs', label: 'Timeout (ms)', min: 0.001, step: 10 }], runtimeBehavior: 'timeout-v1',
  },
  {
    type: 'retry', version: 1, label: 'Retry', description: 'Retries failed outbound attempts with bounded deterministic backoff.', targets: ['edge'],
    configSchema: retryPolicyConfigSchema, defaultConfig: { maxAttempts: 3, backoff: 'exponential', baseDelayMs: 50, maxDelayMs: 2_000, jitterRatio: 0 }, singletonPerTarget: true,
    configFields: [
      { kind: 'number', key: 'maxAttempts', label: 'Maximum attempts', min: 1, max: 100, step: 1 },
      { kind: 'select', key: 'backoff', label: 'Backoff', options: [{ value: 'fixed', label: 'Fixed' }, { value: 'exponential', label: 'Exponential' }] },
      { kind: 'number', key: 'baseDelayMs', label: 'Base delay (ms)', min: 0, step: 10 },
      { kind: 'number', key: 'maxDelayMs', label: 'Maximum delay (ms)', min: 0, step: 10 },
      { kind: 'number', key: 'jitterRatio', label: 'Jitter ratio', min: 0, max: 1, step: 0.05 },
    ], runtimeBehavior: 'retry-v1',
  },
  {
    type: 'circuit-breaker', version: 1, label: 'Circuit Breaker', description: 'Stops calls after repeated failures and probes recovery from half-open state.', targets: ['edge'],
    configSchema: circuitBreakerPolicyConfigSchema, defaultConfig: { failureThreshold: 5, openDurationMs: 10_000, halfOpenMaxProbes: 1 }, singletonPerTarget: true,
    configFields: [
      { kind: 'number', key: 'failureThreshold', label: 'Failure threshold', min: 1, step: 1 },
      { kind: 'number', key: 'openDurationMs', label: 'Open duration (ms)', min: 0.001, step: 100 },
      { kind: 'number', key: 'halfOpenMaxProbes', label: 'Half-open probes', min: 1, step: 1 },
    ], runtimeBehavior: 'circuit-breaker-v1',
  },
  {
    type: 'rate-limit', version: 1, label: 'Rate Limit', description: 'Admits work through a deterministic token bucket.', targets: ['node'],
    configSchema: tokenBucketPolicyConfigSchema, defaultConfig: { capacity: 100, refillTokens: 100, refillIntervalMs: 1_000 }, singletonPerTarget: true,
    configFields: [
      { kind: 'number', key: 'capacity', label: 'Bucket capacity', min: 1, step: 1 },
      { kind: 'number', key: 'refillTokens', label: 'Tokens per refill', min: 1, step: 1 },
      { kind: 'number', key: 'refillIntervalMs', label: 'Refill interval (ms)', min: 0.001, step: 10 },
    ], runtimeBehavior: 'token-bucket-v1',
  },
  {
    type: 'backpressure', version: 1, label: 'Backpressure', description: 'Bounds asynchronous deliveries and rejects or dead-letters overflow.', targets: ['node', 'edge'],
    configSchema: backpressurePolicyConfigSchema, defaultConfig: { maxInFlight: 1_000, overflow: 'reject' }, singletonPerTarget: true,
    configFields: [
      { kind: 'number', key: 'maxInFlight', label: 'Maximum in-flight', min: 0, step: 1 },
      { kind: 'select', key: 'overflow', label: 'Overflow behavior', options: [{ value: 'reject', label: 'Reject' }, { value: 'dead-letter', label: 'Dead letter' }] },
    ], runtimeBehavior: 'backpressure-v1',
  },
] as const satisfies readonly PolicyManifest[]

export const policyRegistry = new PolicyRegistry(builtInPolicyManifests)

export const builtInComponentTypes = componentRegistry.list().map((manifest) => manifest.type) as ComponentType[]

export const createRegisteredNode = (type: ComponentType, id: string, position: Position, workloadId = `${id}-workload`): BuiltInComponentNode => {
  const node = componentRegistry.createNode(type, id, position, workloadId)
  return node as BuiltInComponentNode
}

export const createRolePresetNode = (presetId: string, version: number, id: string, position: Position, workloadId = `${id}-workload`): BuiltInComponentNode => {
  return componentPresetRegistry.createNode(presetId, version, id, position, workloadId) as BuiltInComponentNode
}

export const asLegacyNode = ({ componentVersion, ...node }: BuiltInComponentNode, workloadId = `${node.id}-workload`): ComponentNode => {
  const versioned = componentVersion > 1 ? { ...node, componentVersion } : node
  return node.type === 'traffic'
    ? { ...versioned, type: 'traffic', config: { workloadId } }
    : versioned as ComponentNode
}
