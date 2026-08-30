import type { ComponentNode, ComponentType } from '@system-design/model'

export interface RequestPayload { bytes: number }
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
    baseServiceTimeMs: (node) => node.config.serviceTimeMs, jitterMs: (node) => node.config.jitterMs, intrinsicErrorRate: (node) => node.config.errorRate,
  }),
  defineBehavior<Extract<ComponentNode, { type: 'queue' }>>({
    type: 'queue', capacity: (node) => node.config.consumers, maximumWaiting: (node) => node.config.maxDepth,
    baseServiceTimeMs: (node) => node.config.deliveryTimeMs, jitterMs: (node) => node.config.jitterMs, intrinsicErrorRate: (node) => node.config.errorRate,
  }),
  defineBehavior<Extract<ComponentNode, { type: 'database' }>>({
    type: 'database', capacity: (node) => node.config.maxConnections, maximumWaiting: (node) => node.config.maxQueueSize,
    baseServiceTimeMs: (node) => node.config.queryTimeMs, jitterMs: (node) => node.config.jitterMs, intrinsicErrorRate: (node) => node.config.errorRate,
  }),
] as const

const behaviorMap = new Map<ComponentType, NodeBehavior>(behaviors.map((behavior) => [behavior.type, behavior as NodeBehavior]))

export const getNodeBehavior = <TNode extends ComponentNode>(node: TNode): NodeBehavior<TNode> => {
  const behavior = behaviorMap.get(node.type)
  if (!behavior) throw new Error(`No runtime behavior registered for ${node.type}.`)
  return behavior as NodeBehavior<TNode>
}

export const registeredBehaviorTypes = () => [...behaviorMap.keys()]
