import type { Queue as SimQueue } from 'simscript'
import type { ComponentNode } from '@system-design/model'
import type { RoutingMode } from '@system-design/model'

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
  branchPath?: string
  queuedAtMs?: number
  startedAtMs?: number
}

export interface RequestGroup {
  remaining: number
  failed: boolean
  failureReason?: 'queue_full' | 'node_down' | 'packet_loss' | 'intrinsic_error' | 'hop_limit' | 'missing_node'
  rootRequest: RequestState
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
