import type { Queue as SimQueue } from 'simscript'
import type { ComponentNode, ReasonCode } from '@system-design/model'
import type { RoutingMode } from '@system-design/model'
import type { ReliabilityAttempt, ReliabilityCall } from '../policies/reliability'
import type { ComponentStateRuntime } from '../components/data-runtime'
import type { CompiledOperationAction, CompiledOperationPlan } from '../compiler/operation-plan'

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
  globalRouterNodeId?: string
  globalRouterClientKey?: string
  clientRegionId?: string
  branchPath?: string
  queuedAtMs?: number
  startedAtMs?: number
  key?: string
  operation?: 'read' | 'write'
  outgoingPort?: string
  hotKeyProbabilityOverride?: number
  resumeNodeId?: string
  resumeOutgoingPort?: string
  resumeRequestSpanId?: string
  operationPlan?: CompiledOperationPlan
  operationAction?: CompiledOperationAction
  operationId?: string
  actionId?: string
  payloadBytes?: number
  entityId?: string
  queryShape?: string
  eventId?: string
  schedulerNodeId?: string
  schedulerRunId?: number
  cdnOutcome?: 'hit' | 'miss'
  cdnPop?: number
  searchCandidateCount?: number
  searchFanOut?: number
  searchResultCount?: number
  searchStale?: boolean
  searchVisibilityLagMs?: number
  realtimeConnectionId?: string
  realtimeChannelId?: string
  realtimeFanOut?: number
  topicSubscriptionId?: string
  topicMessageId?: number
  asyncDeliveryDelayMs?: number
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
  state?: ComponentStateRuntime
}

export interface LoadBalancerTargetState {
  consecutiveFailures: number
  unhealthyUntilMs: number
}

export interface LoadBalancerRuntimeState {
  roundRobinIndex: number
  targets: Map<string, LoadBalancerTargetState>
}

export interface PendingSchedulerRun {
  schedulerRunId: number
  scheduledAtMs: number
  dueAtMs: number
  operationPlan?: CompiledOperationPlan
  workloadId?: string
}

export interface SchedulerRuntimeState {
  releaseTicks: number
  scheduledRuns: number
  releasedRuns: number
  queuedRuns: number
  skippedRuns: number
  completedRuns: number
  failedRuns: number
  catchUpRuns: number
  activeRuns: number
  maxActiveRuns: number
  nextRunId: number
  pending: PendingSchedulerRun[]
}
