import type { ComponentType } from './schema'

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
  warnings: string[]
}
