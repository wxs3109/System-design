import type { ComponentType } from './schema'
import type { RuntimeEvent, TraceSpan } from './events'

export interface SummaryMetrics {
  generatedRequests: number
  completedRequests: number
  failedRequests: number
  throughputPerSecond: number
  errorRate: number
  latencyP50Ms: number
  latencyP95Ms: number
  latencyP99Ms: number
}

export interface NodeMetrics {
  nodeId: string
  nodeName: string
  nodeType: ComponentType
  processedRequests: number
  failedRequests: number
  utilization: number
  averageQueueLength: number
  maxQueueLength: number
  details: Record<string, string | number | boolean>
}

export interface TimeSeriesPoint {
  timeSeconds: number
  completedRequests: number
  failedRequests: number
  throughputPerSecond: number
  latencyP95Ms: number
  queuedRequests: number
}

export interface TraceStep {
  requestId: number
  nodeId: string
  nodeName: string
  event: 'generated' | 'queued' | 'started' | 'completed' | 'failed'
  timeMs: number
}

export interface OperationMetrics {
  operationId: string
  generatedRequests: number
  completedRequests: number
  failedRequests: number
  latencyP95Ms: number
}

export interface ActionMetrics {
  operationId: string
  actionId: string
  actionKind: string
  completed: number
  failed: number
  averageDurationMs: number
  recordsExamined: number
  bytesProcessed: number
}

export interface SimulationResult {
  runId: string
  scenarioId: string
  seed: string
  simulatedDurationMs: number
  wallClockDurationMs: number
  summary: SummaryMetrics
  nodes: NodeMetrics[]
  timeSeries: TimeSeriesPoint[]
  traces: TraceStep[]
  events: RuntimeEvent[]
  spans: TraceSpan[]
  operations: OperationMetrics[]
  actions: ActionMetrics[]
  warnings: string[]
}
