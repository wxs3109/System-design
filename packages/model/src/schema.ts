import { z } from 'zod'

const idSchema = z.string().trim().min(1).max(120)
const probabilitySchema = z.number().min(0).max(1)
const nonNegativeSchema = z.number().finite().min(0)
const positiveSchema = z.number().finite().positive()
const positiveIntegerSchema = z.number().int().positive()

export const componentTypeSchema = z.enum([
  'traffic',
  'network',
  'load-balancer',
  'service',
  'queue',
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
  disabled: z.boolean().optional(),
}

export const trafficConfigSchema = z.object({
  workloadId: idSchema,
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

export const queueConfigSchema = z.object({
  consumers: positiveIntegerSchema.max(100_000).default(4),
  deliveryTimeMs: positiveSchema.default(10),
  jitterMs: nonNegativeSchema.default(2),
  maxDepth: positiveIntegerSchema.max(10_000_000).default(10_000),
  errorRate: probabilitySchema.default(0),
})

export const databaseConfigSchema = z.object({
  maxConnections: positiveIntegerSchema.max(1_000_000).default(100),
  queryTimeMs: positiveSchema.default(12),
  jitterMs: nonNegativeSchema.default(3),
  errorRate: probabilitySchema.default(0.001),
  maxQueueSize: z.number().int().min(0).max(10_000_000).default(10_000),
})

export const componentNodeSchema = z.discriminatedUnion('type', [
  z.object({
    ...commonNodeFields,
    type: z.literal('traffic'),
    config: trafficConfigSchema,
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
    type: z.literal('queue'),
    config: queueConfigSchema,
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

export const faultSchema = z.object({
  id: idSchema,
  targetNodeId: idSchema,
  type: z.enum(['node-down', 'latency-spike', 'capacity-drop']),
  startAtSeconds: nonNegativeSchema,
  durationSeconds: positiveSchema,
  factor: positiveSchema.optional(),
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
    if (!nodeIds.has(fault.targetNodeId)) {
      context.addIssue({ code: 'custom', message: `Unknown fault target: ${fault.targetNodeId}`, path: ['faults', index, 'targetNodeId'] })
    }
  })
})

export type Position = z.infer<typeof positionSchema>
export type ComponentNode = z.infer<typeof componentNodeSchema>
export type Connection = z.infer<typeof connectionSchema>
export type Workload = z.infer<typeof workloadSchema>
export type Fault = z.infer<typeof faultSchema>
export type SimulationConfig = z.infer<typeof simulationConfigSchema>
export type Scenario = z.infer<typeof scenarioSchema>
