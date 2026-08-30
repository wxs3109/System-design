import type { Queue as SimQueue } from 'simscript'
import type { ComponentNode } from '@system-design/model'

export interface RequestState {
  id: number
  createdAtMs: number
  bytes: number
  hops: number
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
