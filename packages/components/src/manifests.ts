import { z } from 'zod'
import {
  databaseConfigSchema,
  networkConfigSchema,
  queueConfigSchema,
  serviceConfigSchema,
  type ComponentNode,
  type ComponentType,
  type Position,
} from '@system-design/model'
import { ComponentRegistry, PolicyRegistry, type BuiltInComponentNode, type ComponentManifest } from './registry'

const requestInput = { id: 'in', label: 'Request', direction: 'input', semantic: 'request', multiple: true } as const
const requestOutput = { id: 'out', label: 'Request', direction: 'output', semantic: 'request', multiple: true } as const
const messageInput = { id: 'consume', label: 'Consume', direction: 'input', semantic: 'consume', multiple: true } as const
const messageOutput = { id: 'publish', label: 'Publish', direction: 'output', semantic: 'publish', multiple: true } as const

export const builtInComponentManifests = [
  {
    type: 'traffic', version: 1, label: 'Traffic Generator', description: 'Produces a configurable request workload.', category: 'traffic', iconToken: 'globe', color: '#8b5cf6',
    configSchema: z.object({}), createDefaultConfig: () => ({}), configFields: [], ports: [requestOutput],
    capabilities: ['workload-source'], emittedMetrics: ['generated-requests'], supportedFaults: [], runtimeBehavior: 'traffic-v1',
    describeConfig: () => 'workload source',
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
    ], ports: [requestInput, requestOutput], capabilities: ['network'], emittedMetrics: ['latency', 'utilization', 'queue'], supportedFaults: ['node-down', 'latency-spike', 'capacity-drop'], runtimeBehavior: 'network-v1',
    describeConfig: (config) => `${config.latencyMs} ms · ${config.bandwidthMbps} Mbps`,
  },
  {
    type: 'service', version: 1, label: 'Service', description: 'A replicated concurrent request processor.', category: 'compute', iconToken: 'server', color: '#3b82f6',
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
    type: 'queue', version: 1, label: 'Queue', description: 'Buffers work and delivers it through consumers.', category: 'async', iconToken: 'layers', color: '#f59e0b',
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
    type: 'database', version: 1, label: 'Database', description: 'A bounded connection pool and query resource.', category: 'data', iconToken: 'database', color: '#10b981',
    configSchema: databaseConfigSchema, createDefaultConfig: () => ({ maxConnections: 100, queryTimeMs: 12, jitterMs: 3, errorRate: 0.001, maxQueueSize: 10_000 }),
    configFields: [
      { kind: 'number', key: 'maxConnections', label: 'Max connections', min: 1, step: 1 },
      { kind: 'number', key: 'queryTimeMs', label: 'Query time (ms)', min: 0.1, step: 1 },
      { kind: 'number', key: 'jitterMs', label: 'Jitter (ms)', min: 0, step: 1 },
      { kind: 'number', key: 'maxQueueSize', label: 'Max queue', min: 0, step: 1 },
      { kind: 'number', key: 'errorRate', label: 'Error rate (0–1)', min: 0, max: 1, step: 0.001 },
    ], ports: [requestInput, requestOutput], capabilities: ['storage'], emittedMetrics: ['latency', 'utilization', 'queue'], supportedFaults: ['node-down', 'latency-spike', 'capacity-drop'], runtimeBehavior: 'database-v1',
    describeConfig: (config) => `${config.maxConnections} connections · ${config.queryTimeMs} ms`,
  },
] as const satisfies readonly ComponentManifest[]

export const componentRegistry = new ComponentRegistry(builtInComponentManifests)
export const policyRegistry = new PolicyRegistry()

export const builtInComponentTypes = builtInComponentManifests.map((manifest) => manifest.type) as ComponentType[]

export const createRegisteredNode = (type: ComponentType, id: string, position: Position, workloadId = `${id}-workload`): BuiltInComponentNode => {
  const node = componentRegistry.createNode(type, id, position, workloadId)
  return node as BuiltInComponentNode
}

export const asLegacyNode = ({ componentVersion: _componentVersion, ...node }: BuiltInComponentNode, workloadId = `${node.id}-workload`): ComponentNode => node.type === 'traffic'
  ? { ...node, type: 'traffic', config: { workloadId } }
  : node as ComponentNode
