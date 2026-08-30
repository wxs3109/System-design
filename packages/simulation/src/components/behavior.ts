import type { ComponentNode, ComponentType } from '@system-design/model'
import { estimateDataAccessCost } from './operation-cost'

export interface RequestPayload { bytes: number; operation?: 'read' | 'write'; operationAction?: import('../compiler/operation-plan').CompiledOperationAction; cdnOutcome?: 'hit' | 'miss'; searchCandidateCount?: number; searchFanOut?: number; searchResultCount?: number; searchStale?: boolean; searchVisibilityLagMs?: number }
export interface NodeBehavior<TNode extends ComponentNode = ComponentNode> {
  type: TNode['type']
  capacity(node: TNode): number
  maximumWaiting(node: TNode): number
  baseServiceTimeMs(node: TNode, request: RequestPayload): number
  jitterMs(node: TNode): number
  intrinsicErrorRate(node: TNode): number
}

const defineBehavior = <TNode extends ComponentNode>(behavior: NodeBehavior<TNode>) => behavior

const behaviors = [
  defineBehavior<Extract<ComponentNode, { type: 'traffic' }>>({
    type: 'traffic', capacity: () => Number.MAX_SAFE_INTEGER, maximumWaiting: () => 0, baseServiceTimeMs: () => 0, jitterMs: () => 0, intrinsicErrorRate: () => 0,
  }),
  defineBehavior<Extract<ComponentNode, { type: 'scheduler' }>>({
    type: 'scheduler', capacity: () => Number.MAX_SAFE_INTEGER, maximumWaiting: () => 0, baseServiceTimeMs: () => 0, jitterMs: () => 0, intrinsicErrorRate: () => 0,
  }),
  defineBehavior<Extract<ComponentNode, { type: 'network' }>>({
    type: 'network', capacity: (node) => node.config.parallelism, maximumWaiting: (node) => node.config.maxQueueSize,
    baseServiceTimeMs: (node, request) => node.config.latencyMs + (request.bytes * 8) / (node.config.bandwidthMbps * 1_000),
    jitterMs: (node) => node.config.jitterMs, intrinsicErrorRate: (node) => node.config.packetLossRate,
  }),
  defineBehavior<Extract<ComponentNode, { type: 'load-balancer' }>>({
    type: 'load-balancer', capacity: (node) => node.config.capacity, maximumWaiting: (node) => node.config.maxQueueSize,
    baseServiceTimeMs: (node) => node.config.routingTimeMs, jitterMs: () => 0, intrinsicErrorRate: () => 0,
  }),
  defineBehavior<Extract<ComponentNode, { type: 'service' }>>({
    type: 'service', capacity: (node) => node.config.replicas * node.config.concurrencyPerReplica, maximumWaiting: (node) => node.config.maxQueueSize,
    baseServiceTimeMs: (node, request) => node.config.serviceTimeMs + (request.operationAction?.handlerTimeMs ?? 0), jitterMs: (node) => node.config.jitterMs, intrinsicErrorRate: (node) => node.config.errorRate,
  }),
  defineBehavior<Extract<ComponentNode, { type: 'queue' }>>({
    type: 'queue', capacity: (node) => node.config.consumers, maximumWaiting: (node) => node.config.maxDepth,
    baseServiceTimeMs: (node) => node.config.deliveryTimeMs, jitterMs: (node) => node.config.jitterMs, intrinsicErrorRate: (node) => node.config.errorRate,
  }),
  defineBehavior<Extract<ComponentNode, { type: 'cache' }>>({
    type: 'cache', capacity: (node) => node.config.maxConcurrentRequests, maximumWaiting: (node) => node.config.maxQueueSize,
    baseServiceTimeMs: (node) => node.config.operationTimeMs, jitterMs: (node) => node.config.jitterMs, intrinsicErrorRate: (node) => node.config.errorRate,
  }),
  defineBehavior<Extract<ComponentNode, { type: 'cdn' }>>({
    type: 'cdn', capacity: (node) => node.config.maxConcurrentRequests, maximumWaiting: (node) => node.config.maxQueueSize,
    baseServiceTimeMs: (node, request) => {
      const edgeTransfer = (request.bytes * 8) / (node.config.edgeBandwidthMbps * 1_000)
      const originTransfer = request.cdnOutcome === 'miss' ? node.config.originRoundTripMs + (request.bytes * 8) / (node.config.originBandwidthMbps * 1_000) : 0
      return node.config.lookupTimeMs + node.config.edgeLatencyMs + edgeTransfer + originTransfer
    },
    jitterMs: (node) => node.config.jitterMs, intrinsicErrorRate: (node) => node.config.errorRate,
  }),
  defineBehavior<Extract<ComponentNode, { type: 'search-index' }>>({
    type: 'search-index',
    // Each logical query consumes one copy in every shard. Shards reduce the
    // documents per shard; they do not multiply whole-query concurrency.
    capacity: (node) => node.config.maxConcurrentRequestsPerCopy * (node.config.replicasPerShard + 1),
    maximumWaiting: (node) => node.config.maxQueueSize,
    baseServiceTimeMs: (node, request) => request.operation === 'write'
      ? node.config.indexWriteTimeMs + (request.bytes * 8) / (node.config.indexingThroughputMbps * 1_000)
      : node.config.queryBaseTimeMs + node.config.shardQueryTimeMs + node.config.fanOutTimePerShardMs * (request.searchFanOut ?? node.config.shardCount) + node.config.mergeTimePerCandidateMs * (request.searchCandidateCount ?? node.config.defaultResultLimit * node.config.shardCount),
    jitterMs: (node) => node.config.jitterMs, intrinsicErrorRate: (node) => node.config.errorRate,
  }),
  defineBehavior<Extract<ComponentNode, { type: 'stream' }>>({
    type: 'stream', capacity: (node) => node.config.producerCapacity, maximumWaiting: (node) => node.config.maxDepth,
    baseServiceTimeMs: (node) => node.config.publishTimeMs + (node.config.acknowledgement === 'explicit' ? node.config.consumeTimeMs / node.config.consumersPerGroup : 0),
    jitterMs: (node) => node.config.jitterMs, intrinsicErrorRate: (node) => node.config.errorRate,
  }),
  defineBehavior<Extract<ComponentNode, { type: 'object-storage' }>>({
    type: 'object-storage', capacity: (node) => node.config.maxConcurrentRequests, maximumWaiting: (node) => node.config.maxQueueSize,
    baseServiceTimeMs: (node, request) => {
      const throughput = request.operation === 'write' ? node.config.writeThroughputMbps : node.config.readThroughputMbps
      return node.config.baseLatencyMs + (node.config.defaultObjectSizeBytes * 8) / (throughput * 1_000)
    },
    jitterMs: (node) => node.config.jitterMs, intrinsicErrorRate: (node) => node.config.errorRate,
  }),
  defineBehavior<Extract<ComponentNode, { type: 'database' }>>({
    type: 'database', capacity: (node) => node.config.maxConnections * (node.componentVersion === 2 ? node.config.shardCount * (node.config.readPreference === 'primary' ? 1 : 1 + node.config.replicasPerShard) : 1), maximumWaiting: (node) => node.config.maxQueueSize,
    baseServiceTimeMs: (node, request) => request.operationAction?.data
      ? estimateDataAccessCost(request.operationAction.data, node.config.queryTimeMs).serviceTimeMs
      : node.config.queryTimeMs, jitterMs: (node) => node.config.jitterMs, intrinsicErrorRate: (node) => node.config.errorRate,
  }),
] as const

const behaviorMap = new Map<ComponentType, NodeBehavior>(behaviors.map((behavior) => [behavior.type, behavior as NodeBehavior]))

export const getNodeBehavior = <TNode extends ComponentNode>(node: TNode): NodeBehavior<TNode> => {
  const behavior = behaviorMap.get(node.type)
  if (!behavior) throw new Error(`No runtime behavior registered for ${node.type}.`)
  return behavior as NodeBehavior<TNode>
}

export const registeredBehaviorTypes = () => [...behaviorMap.keys()]
