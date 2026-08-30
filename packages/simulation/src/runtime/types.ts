import type { Queue as SimQueue } from 'simscript'
import type { ComponentNode, ReasonCode } from '@system-design/model'
import type { RoutingMode } from '@system-design/model'
import type { ReliabilityAttempt, ReliabilityCall } from '../policies/reliability'

export interface RequestState {
  id: number
  createdAtMs: number
  bytes: number
  hops: number
  traceId: string
  spanId: string
  parentSpanId?: string
  incomingEdgeId?: string
  incomingRoutingMode?: RoutingMode
  dependencyStartedAtMs?: number
  reliabilityCall?: ReliabilityCall
  reliabilityAttempt?: ReliabilityAttempt
  deliveryGateKeys?: string[]
  loadBalancerNodeId?: string
  branchPath?: string
  queuedAtMs?: number
  startedAtMs?: number
}

export interface RequestGroup {
  remaining: number
  failed: boolean
  failureReason?: ReasonCode
  rootRequest: RequestState
}

export interface ReliabilityCompletionContext {
  group?: RequestGroup
  countsAsRequest: boolean
}

export interface RuntimeNode {
  node: ComponentNode
  resource: SimQueue
  waiting: SimQueue
  admitted: number
  processed: number
  failed: number
  rejected: number
  maxWaiting: number
}

export interface LoadBalancerTargetState {
  consecutiveFailures: number
  unhealthyUntilMs: number
}

export interface LoadBalancerRuntimeState {
  roundRobinIndex: number
  targets: Map<string, LoadBalancerTargetState>
}
