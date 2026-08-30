import { z } from 'zod'
import {
  backpressurePolicyConfigSchema,
  circuitBreakerPolicyConfigSchema,
  databaseConfigSchema,
  loadBalancerConfigSchema,
  networkConfigSchema,
  queueConfigSchema,
  retryPolicyConfigSchema,
  serviceConfigSchema,
  timeoutPolicyConfigSchema,
  tokenBucketPolicyConfigSchema,
  type ComponentNode,
  type ComponentType,
  type Position,
} from '@system-design/model'
import { ComponentRegistry, PolicyRegistry, type BuiltInComponentNode, type ComponentManifest, type PolicyManifest } from './registry'

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
    type: 'load-balancer', version: 1, label: 'Load Balancer', description: 'Selects a target using weighted, round-robin or health-aware routing.', category: 'routing', iconToken: 'git-fork', color: '#ec4899',
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

export const builtInComponentTypes = builtInComponentManifests.map((manifest) => manifest.type) as ComponentType[]

export const createRegisteredNode = (type: ComponentType, id: string, position: Position, workloadId = `${id}-workload`): BuiltInComponentNode => {
  const node = componentRegistry.createNode(type, id, position, workloadId)
  return node as BuiltInComponentNode
}

export const asLegacyNode = ({ componentVersion: _componentVersion, ...node }: BuiltInComponentNode, workloadId = `${node.id}-workload`): ComponentNode => node.type === 'traffic'
  ? { ...node, type: 'traffic', config: { workloadId } }
  : node as ComponentNode
