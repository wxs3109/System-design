import { z } from 'zod'

const idSchema = z.string().trim().min(1).max(120)
const probabilitySchema = z.number().min(0).max(1)
const nonNegativeSchema = z.number().finite().min(0)
const positiveSchema = z.number().finite().positive()
const positiveIntegerSchema = z.number().int().positive()

export const componentTypeSchema = z.enum([
  'traffic',
  'scheduler',
  'workflow',
  'network',
  'load-balancer',
  'realtime-gateway',
  'service',
  'queue',
  'cache',
  'cdn',
  'search-index',
  'stream',
  'topic',
  'object-storage',
  'database',
])

export type ComponentType = z.infer<typeof componentTypeSchema>

export const positionSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
})

const commonNodeFields = {
  id: idSchema,
  name: z.string().trim().min(1).max(80),
  position: positionSchema,
  componentVersion: positiveIntegerSchema.optional(),
  disabled: z.boolean().optional(),
}

export const trafficConfigSchema = z.object({
  workloadId: idSchema,
})

export const schedulerConfigSchema = z.object({
  scheduleMode: z.enum(['periodic', 'batch']).default('periodic'),
  intervalMs: positiveSchema.max(86_400_000).default(1_000),
  startAtMs: nonNegativeSchema.max(86_400_000).default(0),
  batchSize: positiveIntegerSchema.max(1_000_000).default(1),
  jitterMs: nonNegativeSchema.max(86_400_000).default(0),
  missedRunPolicy: z.enum(['skip', 'catch-up']).default('skip'),
  concurrencyLimit: positiveIntegerSchema.max(1_000_000).default(1),
  maxPendingRuns: z.number().int().min(0).max(10_000_000).default(1_000),
  requestBytes: positiveIntegerSchema.max(1_000_000_000).default(1_024),
}).superRefine((config, context) => {
  if (config.jitterMs > config.intervalMs) {
    context.addIssue({ code: 'custom', path: ['jitterMs'], message: 'Scheduler jitter cannot exceed its interval.' })
  }
})

export const workflowConfigSchema = z.object({
  maxConcurrentInstances: positiveIntegerSchema.max(1_000_000).default(1_000),
  persistenceTimeMs: nonNegativeSchema.max(86_400_000).default(2),
  defaultStepTimeMs: positiveSchema.max(86_400_000).default(100),
  jitterMs: nonNegativeSchema.max(86_400_000).default(1),
  errorRate: probabilitySchema.default(0),
  maxQueueSize: z.number().int().min(0).max(10_000_000).default(10_000),
})

export const networkConfigSchema = z.object({
  latencyMs: nonNegativeSchema.default(20),
  jitterMs: nonNegativeSchema.default(2),
  bandwidthMbps: positiveSchema.default(100),
  parallelism: positiveIntegerSchema.max(10_000).default(1_000),
  packetLossRate: probabilitySchema.default(0),
  maxQueueSize: z.number().int().min(0).max(1_000_000).default(10_000),
})

export const serviceConfigSchema = z.object({
  replicas: positiveIntegerSchema.max(10_000).default(2),
  concurrencyPerReplica: positiveIntegerSchema.max(100_000).default(10),
  serviceTimeMs: positiveSchema.default(30),
  jitterMs: nonNegativeSchema.default(5),
  errorRate: probabilitySchema.default(0),
  maxQueueSize: z.number().int().min(0).max(1_000_000).default(1_000),
})

export const loadBalancerConfigSchema = z.object({
  algorithm: z.enum(['weighted', 'round-robin', 'health-aware']).default('weighted'),
  capacity: positiveIntegerSchema.max(1_000_000).default(1_000),
  routingTimeMs: positiveSchema.default(0.2),
  maxQueueSize: z.number().int().min(0).max(1_000_000).default(10_000),
  failureThreshold: positiveIntegerSchema.max(1_000).default(1),
  recoveryTimeMs: nonNegativeSchema.max(3_600_000).default(5_000),
})

export const realtimeGatewayConfigSchema = z.object({
  maxConnections: positiveIntegerSchema.max(100_000_000).default(100_000),
  connectionDurationMs: positiveSchema.max(31_536_000_000).default(60_000),
  maxChannelsPerConnection: positiveIntegerSchema.max(10_000).default(10),
  defaultChannelCount: positiveIntegerSchema.max(1_000_000).default(100),
  maxConcurrentMessages: positiveIntegerSchema.max(1_000_000).default(1_000),
  handshakeTimeMs: positiveSchema.default(2),
  broadcastBaseTimeMs: positiveSchema.default(1),
  fanOutTimePerConnectionMs: nonNegativeSchema.default(0.01),
  defaultMessageBytes: positiveIntegerSchema.max(1_000_000_000).default(1_024),
  outboundBandwidthMbps: positiveSchema.default(10),
  slowConnectionFraction: probabilitySchema.default(0),
  slowConnectionBandwidthMbps: positiveSchema.default(0.1),
  maxPendingBytesPerConnection: positiveIntegerSchema.max(1_000_000_000_000).default(1_048_576),
  overflowPolicy: z.enum(['drop-message', 'disconnect']).default('drop-message'),
  jitterMs: nonNegativeSchema.default(0.5),
  errorRate: probabilitySchema.default(0),
  maxQueueSize: z.number().int().min(0).max(10_000_000).default(100_000),
}).superRefine((config, context) => {
  if (config.slowConnectionBandwidthMbps > config.outboundBandwidthMbps) {
    context.addIssue({ code: 'custom', path: ['slowConnectionBandwidthMbps'], message: 'Slow-connection bandwidth cannot exceed normal outbound bandwidth.' })
  }
})

export const queueConfigSchema = z.object({
  consumers: positiveIntegerSchema.max(100_000).default(4),
  deliveryTimeMs: positiveSchema.default(10),
  jitterMs: nonNegativeSchema.default(2),
  maxDepth: positiveIntegerSchema.max(10_000_000).default(10_000),
  errorRate: probabilitySchema.default(0),
})

export const cacheConfigSchema = z.object({
  capacityEntries: positiveIntegerSchema.max(10_000_000).default(10_000),
  ttlMs: positiveSchema.max(86_400_000).default(60_000),
  evictionPolicy: z.enum(['lru', 'fifo']).default('lru'),
  keySpaceSize: positiveIntegerSchema.max(1_000_000_000).default(100_000),
  hotKeyProbability: probabilitySchema.default(0),
  maxConcurrentRequests: positiveIntegerSchema.max(1_000_000).default(1_000),
  operationTimeMs: positiveSchema.default(1),
  jitterMs: nonNegativeSchema.default(0.2),
  errorRate: probabilitySchema.default(0),
  maxQueueSize: z.number().int().min(0).max(10_000_000).default(10_000),
})

export const cdnConfigSchema = z.object({
  popCount: positiveIntegerSchema.max(1_000).default(4),
  popSelection: z.enum(['consistent-hash', 'round-robin']).default('consistent-hash'),
  capacityEntriesPerPop: positiveIntegerSchema.max(10_000_000).default(10_000),
  ttlMs: positiveSchema.max(86_400_000).default(300_000),
  evictionPolicy: z.enum(['lru', 'fifo']).default('lru'),
  keySpaceSize: positiveIntegerSchema.max(1_000_000_000).default(100_000),
  hotKeyProbability: probabilitySchema.default(0),
  maxConcurrentRequests: positiveIntegerSchema.max(1_000_000).default(10_000),
  lookupTimeMs: positiveSchema.default(0.5),
  edgeLatencyMs: nonNegativeSchema.default(10),
  edgeBandwidthMbps: positiveSchema.default(1_000),
  originRoundTripMs: nonNegativeSchema.default(80),
  originBandwidthMbps: positiveSchema.default(500),
  defaultObjectSizeBytes: positiveIntegerSchema.max(1_000_000_000_000).default(1_048_576),
  jitterMs: nonNegativeSchema.default(1),
  errorRate: probabilitySchema.default(0),
  maxQueueSize: z.number().int().min(0).max(10_000_000).default(100_000),
})

export const searchIndexConfigSchema = z.object({
  shardCount: positiveIntegerSchema.max(100_000).default(6),
  replicasPerShard: z.number().int().min(0).max(1_000).default(1),
  maxConcurrentRequestsPerCopy: positiveIntegerSchema.max(1_000_000).default(100),
  maxQueueSize: z.number().int().min(0).max(10_000_000).default(100_000),
  writeRatio: probabilitySchema.default(0.2),
  keySpaceSize: positiveIntegerSchema.max(1_000_000_000).default(1_000_000),
  hotKeyProbability: probabilitySchema.default(0),
  indexingDelayMs: nonNegativeSchema.max(86_400_000).default(200),
  refreshIntervalMs: positiveSchema.max(86_400_000).default(1_000),
  replicaRefreshDelayMs: nonNegativeSchema.max(86_400_000).default(100),
  queryBaseTimeMs: positiveSchema.default(2),
  shardQueryTimeMs: positiveSchema.default(4),
  fanOutTimePerShardMs: nonNegativeSchema.default(0.2),
  mergeTimePerCandidateMs: nonNegativeSchema.default(0.01),
  defaultResultLimit: positiveIntegerSchema.max(100_000).default(20),
  indexWriteTimeMs: positiveSchema.default(3),
  indexingThroughputMbps: positiveSchema.default(500),
  jitterMs: nonNegativeSchema.default(1),
  errorRate: probabilitySchema.default(0),
})

export const streamConfigSchema = z.object({
  partitions: positiveIntegerSchema.max(100_000).default(12),
  producerCapacity: positiveIntegerSchema.max(1_000_000).default(1_000),
  consumerGroups: positiveIntegerSchema.max(10_000).default(1),
  consumersPerGroup: positiveIntegerSchema.max(100_000).default(4),
  batchSize: positiveIntegerSchema.max(1_000_000).default(100),
  acknowledgement: z.enum(['auto', 'explicit']).default('explicit'),
  publishTimeMs: positiveSchema.default(2),
  consumeTimeMs: positiveSchema.default(10),
  jitterMs: nonNegativeSchema.default(1),
  maxDepth: positiveIntegerSchema.max(100_000_000).default(1_000_000),
  errorRate: probabilitySchema.default(0),
})

export const topicConfigSchema = z.object({
  subscriptionCount: positiveIntegerSchema.max(10_000).default(2),
  maxRetainedMessages: positiveIntegerSchema.max(100_000_000).default(1_000_000),
  retentionMs: positiveSchema.max(31_536_000_000).default(86_400_000),
  batchSize: positiveIntegerSchema.max(1_000_000).default(100),
  acknowledgement: z.enum(['auto', 'explicit']).default('explicit'),
  publishCapacity: positiveIntegerSchema.max(1_000_000).default(1_000),
  publishTimeMs: positiveSchema.default(2),
  deliveryTimeMs: positiveSchema.default(10),
  jitterMs: nonNegativeSchema.default(1),
  maxQueueSize: z.number().int().min(0).max(100_000_000).default(1_000_000),
  errorRate: probabilitySchema.default(0),
})

export const objectStorageConfigSchema = z.object({
  maxConcurrentRequests: positiveIntegerSchema.max(1_000_000).default(1_000),
  defaultObjectSizeBytes: positiveIntegerSchema.max(1_000_000_000_000).default(1_048_576),
  readRatio: probabilitySchema.default(0.8),
  baseLatencyMs: positiveSchema.default(20),
  jitterMs: nonNegativeSchema.default(3),
  readThroughputMbps: positiveSchema.default(1_000),
  writeThroughputMbps: positiveSchema.default(500),
  errorRate: probabilitySchema.default(0.001),
  maxQueueSize: z.number().int().min(0).max(10_000_000).default(100_000),
})

export const databaseV1ConfigSchema = z.object({
  maxConnections: positiveIntegerSchema.max(1_000_000).default(100),
  queryTimeMs: positiveSchema.default(12),
  jitterMs: nonNegativeSchema.default(3),
  errorRate: probabilitySchema.default(0.001),
  maxQueueSize: z.number().int().min(0).max(10_000_000).default(10_000),
})

export const databaseConfigSchema = databaseV1ConfigSchema.extend({
  shardCount: positiveIntegerSchema.max(100_000).default(1),
  replicasPerShard: z.number().int().min(0).max(1_000).default(0),
  readPreference: z.enum(['primary', 'replica-preferred', 'replica-only']).default('primary'),
  replicationDelayMs: nonNegativeSchema.max(86_400_000).default(100),
  writeRatio: probabilitySchema.default(0.2),
  keySpaceSize: positiveIntegerSchema.max(1_000_000_000).default(1_000_000),
  hotKeyProbability: probabilitySchema.default(0),
}).superRefine((config, context) => {
  if (config.readPreference === 'replica-only' && config.replicasPerShard === 0) {
    context.addIssue({ code: 'custom', path: ['replicasPerShard'], message: 'Replica-only reads require at least one replica per shard.' })
  }
})

export const componentNodeSchema = z.discriminatedUnion('type', [
  z.object({
    ...commonNodeFields,
    type: z.literal('traffic'),
    config: trafficConfigSchema,
  }),
  z.object({
    ...commonNodeFields,
    type: z.literal('scheduler'),
    config: schedulerConfigSchema,
  }),
  z.object({
    ...commonNodeFields,
    type: z.literal('workflow'),
    config: workflowConfigSchema,
  }),
  z.object({
    ...commonNodeFields,
    type: z.literal('network'),
    config: networkConfigSchema,
  }),
  z.object({
    ...commonNodeFields,
    type: z.literal('service'),
    config: serviceConfigSchema,
  }),
  z.object({
    ...commonNodeFields,
    type: z.literal('load-balancer'),
    config: loadBalancerConfigSchema,
  }),
  z.object({
    ...commonNodeFields,
    type: z.literal('realtime-gateway'),
    config: realtimeGatewayConfigSchema,
  }),
  z.object({
    ...commonNodeFields,
    type: z.literal('queue'),
    config: queueConfigSchema,
  }),
  z.object({
    ...commonNodeFields,
    type: z.literal('cache'),
    config: cacheConfigSchema,
  }),
  z.object({
    ...commonNodeFields,
    type: z.literal('cdn'),
    config: cdnConfigSchema,
  }),
  z.object({
    ...commonNodeFields,
    type: z.literal('search-index'),
    config: searchIndexConfigSchema,
  }),
  z.object({
    ...commonNodeFields,
    type: z.literal('stream'),
    config: streamConfigSchema,
  }),
  z.object({
    ...commonNodeFields,
    type: z.literal('topic'),
    config: topicConfigSchema,
  }),
  z.object({
    ...commonNodeFields,
    type: z.literal('object-storage'),
    config: objectStorageConfigSchema,
  }),
  z.object({
    ...commonNodeFields,
    type: z.literal('database'),
    config: databaseConfigSchema,
  }),
])

export const connectionSchema = z.object({
  id: idSchema,
  source: idSchema,
  target: idSchema,
  sourcePort: z.literal('out').default('out'),
  targetPort: z.literal('in').default('in'),
  weight: positiveSchema.default(1),
})

export const workloadSchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1).max(80),
  sourceNodeId: idSchema,
  requestsPerSecond: positiveSchema.max(1_000_000),
  startAtSeconds: nonNegativeSchema.default(0),
  durationSeconds: positiveSchema.max(86_400),
  pattern: z.enum(['constant', 'poisson']).default('poisson'),
  requestBytes: positiveIntegerSchema.max(1_000_000_000).default(1_024),
})

export const faultTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('node'), id: idSchema }),
  z.object({ kind: z.literal('edge'), id: idSchema }),
  z.object({ kind: z.literal('workload'), id: idSchema }),
  z.object({ kind: z.literal('group'), id: idSchema }),
])

export const faultTypeSchema = z.enum([
  'node-down',
  'latency-spike',
  'capacity-drop',
  'bandwidth-drop',
  'packet-loss',
  'traffic-spike',
  'hot-key',
  'region-outage',
])

export const faultSchema = z.object({
  id: idSchema,
  sourceFaultId: idSchema.optional(),
  name: z.union([z.string().trim().min(1).max(80), z.literal('').transform(() => undefined)]).optional(),
  target: faultTargetSchema.optional(),
  targetNodeId: idSchema.optional(),
  type: faultTypeSchema,
  startAtSeconds: nonNegativeSchema,
  durationSeconds: positiveSchema,
  factor: positiveSchema.optional(),
  enabled: z.boolean().default(true),
}).superRefine((fault, context) => {
  if (fault.target === undefined && fault.targetNodeId === undefined) context.addIssue({ code: 'custom', path: ['target'], message: 'A fault target is required.' })
  if (fault.target !== undefined && fault.targetNodeId !== undefined) context.addIssue({ code: 'custom', path: ['target'], message: 'Use either target or legacy targetNodeId, not both.' })
  if ((fault.type === 'capacity-drop' || fault.type === 'bandwidth-drop' || fault.type === 'packet-loss' || fault.type === 'hot-key') && fault.factor !== undefined && fault.factor > 1) {
    context.addIssue({ code: 'custom', path: ['factor'], message: `${fault.type} factor must be at most 1.` })
  }
  if ((fault.type === 'latency-spike' || fault.type === 'traffic-spike') && fault.factor !== undefined && fault.factor < 1) {
    context.addIssue({ code: 'custom', path: ['factor'], message: `${fault.type} factor must be at least 1.` })
  }
  if ((fault.type === 'node-down' || fault.type === 'region-outage') && fault.factor !== undefined) {
    context.addIssue({ code: 'custom', path: ['factor'], message: `${fault.type} does not accept a factor.` })
  }
})

export const simulationConfigSchema = z.object({
  durationSeconds: positiveSchema.max(86_400).default(60),
  sampleIntervalMs: positiveIntegerSchema.max(60_000).default(1_000),
  maxRequests: positiveIntegerSchema.max(2_000_000).default(100_000),
  traceLimit: z.number().int().min(0).max(10_000).default(200),
  maxHops: positiveIntegerSchema.max(1_000).default(64),
})

export const scenarioSchema = z.object({
  schemaVersion: z.literal(1),
  id: idSchema,
  name: z.string().trim().min(1).max(120),
  seed: z.string().min(1).max(120),
  nodes: z.array(componentNodeSchema).max(10_000),
  edges: z.array(connectionSchema).max(50_000),
  workloads: z.array(workloadSchema).max(1_000),
  faults: z.array(faultSchema).max(10_000).default([]),
  simulation: simulationConfigSchema,
}).superRefine((scenario, context) => {
  const nodeIds = new Set<string>()
  const edgeIds = new Set<string>()
  const workloadIds = new Set<string>()
  const faultIds = new Set<string>()

  scenario.nodes.forEach((node, index) => {
    if (nodeIds.has(node.id)) {
      context.addIssue({
        code: 'custom',
        message: `Duplicate node id: ${node.id}`,
        path: ['nodes', index, 'id'],
      })
    }
    nodeIds.add(node.id)
  })

  scenario.edges.forEach((edge, index) => {
    if (edgeIds.has(edge.id)) {
      context.addIssue({ code: 'custom', message: `Duplicate edge id: ${edge.id}`, path: ['edges', index, 'id'] })
    }
    edgeIds.add(edge.id)
    if (!nodeIds.has(edge.source)) {
      context.addIssue({ code: 'custom', message: `Unknown source node: ${edge.source}`, path: ['edges', index, 'source'] })
    }
    if (!nodeIds.has(edge.target)) {
      context.addIssue({ code: 'custom', message: `Unknown target node: ${edge.target}`, path: ['edges', index, 'target'] })
    }
    if (edge.source === edge.target) {
      context.addIssue({ code: 'custom', message: 'A node cannot connect directly to itself', path: ['edges', index] })
    }
  })

  scenario.workloads.forEach((workload, index) => {
    if (workloadIds.has(workload.id)) {
      context.addIssue({ code: 'custom', message: `Duplicate workload id: ${workload.id}`, path: ['workloads', index, 'id'] })
    }
    workloadIds.add(workload.id)
    const source = scenario.nodes.find((node) => node.id === workload.sourceNodeId)
    if (!source) {
      context.addIssue({ code: 'custom', message: `Unknown workload source: ${workload.sourceNodeId}`, path: ['workloads', index, 'sourceNodeId'] })
    } else if (source.type !== 'traffic') {
      context.addIssue({ code: 'custom', message: 'A workload source must be a Traffic Generator', path: ['workloads', index, 'sourceNodeId'] })
    }
  })

  scenario.nodes.forEach((node, index) => {
    if (node.type === 'traffic' && !scenario.workloads.some((workload) => workload.id === node.config.workloadId && workload.sourceNodeId === node.id)) {
      context.addIssue({ code: 'custom', message: `Traffic node ${node.id} must reference its workload`, path: ['nodes', index, 'config', 'workloadId'] })
    }
  })

  scenario.faults.forEach((fault, index) => {
    if (faultIds.has(fault.id)) {
      context.addIssue({ code: 'custom', message: `Duplicate fault id: ${fault.id}`, path: ['faults', index, 'id'] })
    }
    faultIds.add(fault.id)
    const target = fault.target ?? (fault.targetNodeId === undefined ? undefined : { kind: 'node' as const, id: fault.targetNodeId })
    if (!target) return
    const targets = target.kind === 'node' ? nodeIds : target.kind === 'edge' ? edgeIds : target.kind === 'workload' ? workloadIds : undefined
    if (!targets?.has(target.id)) context.addIssue({ code: 'custom', message: `Unknown ${target.kind} fault target: ${target.id}`, path: ['faults', index, 'target'] })
    if (target.kind === 'group') context.addIssue({ code: 'custom', message: 'Executable scenarios must expand group faults to node and edge targets.', path: ['faults', index, 'target'] })
  })
})

export type Position = z.infer<typeof positionSchema>
export type ComponentNode = z.infer<typeof componentNodeSchema>
export type SchedulerConfig = z.infer<typeof schedulerConfigSchema>
export type WorkflowConfig = z.infer<typeof workflowConfigSchema>
export type CdnConfig = z.infer<typeof cdnConfigSchema>
export type SearchIndexConfig = z.infer<typeof searchIndexConfigSchema>
export type TopicConfig = z.infer<typeof topicConfigSchema>
export type Connection = z.infer<typeof connectionSchema>
export type Workload = z.infer<typeof workloadSchema>
export type Fault = z.infer<typeof faultSchema>
export type FaultTarget = z.infer<typeof faultTargetSchema>
export type FaultType = z.infer<typeof faultTypeSchema>
export type SimulationConfig = z.infer<typeof simulationConfigSchema>
export type Scenario = z.infer<typeof scenarioSchema>
