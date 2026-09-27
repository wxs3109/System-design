import type { SemanticEvent } from '../../core/experiments/evidence'
export type DesignConfig = Record<string, string>
export type DesignEvent = SemanticEvent
export interface ProductResult {
  modelVersion: string
  events: SemanticEvent[]
  metrics: Record<string, number>
  state: object
}
