import type { ComponentType } from './schema'
import type { RuntimeEvent, TraceSpan } from './events'
import { parseProjectFile } from './project'

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
  explanation?: string
  details?: Record<string, string | number | boolean>
}

export interface SimulationResult {
  /** Canonical input identity for evidence freshness; older saved runs may omit it. */
  inputSignature?: string
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

const canonicalInput = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalInput).join(',')}]`
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalInput(item)}`).join(',')}}`
  return JSON.stringify(value)
}

/** Project migrations retain identity; different executable inputs do not. */
export const simulationInputSignature = (input: unknown): string => canonicalInput(
  input !== null && typeof input === 'object' && 'schemaVersion' in input && (input.schemaVersion === 2 || input.schemaVersion === 3) ? parseProjectFile(input) : input,
)
