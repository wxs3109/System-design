import type { SimulationResult } from '@system-design/model'

export type CanvasMetricSeverity = 'idle' | 'healthy' | 'warning' | 'critical'

export interface CanvasNodeMetric {
  processedRequests: number
  failedRequests: number
  utilization: number
  maxQueueLength: number
  severity: CanvasMetricSeverity
}

export interface CanvasEdgeMetric {
  observedCalls: number
  observedFailures: number
  observedBytes: number
  severity: 'active' | 'failed'
}

export interface CanvasMetricProjection {
  nodes: Map<string, CanvasNodeMetric>
  edges: Map<string, CanvasEdgeMetric>
}

const nodeSeverity = (processed: number, failed: number, utilization: number, maxQueue: number): CanvasMetricSeverity => {
  if (processed === 0 && failed === 0) return 'idle'
  if (failed / Math.max(1, processed + failed) >= 0.05 || utilization >= 0.9) return 'critical'
  if (failed > 0 || utilization >= 0.7 || maxQueue > 0) return 'warning'
  return 'healthy'
}

export function buildCanvasMetricProjection(result: SimulationResult): CanvasMetricProjection {
  const nodes = new Map(result.nodes.map((node) => [node.nodeId, {
    processedRequests: node.processedRequests, failedRequests: node.failedRequests, utilization: node.utilization, maxQueueLength: node.maxQueueLength,
    severity: nodeSeverity(node.processedRequests, node.failedRequests, node.utilization, node.maxQueueLength),
  } satisfies CanvasNodeMetric]))
  const edgeAggregates = new Map<string, { calls: number; failures: Set<string>; bytes: number }>()
  for (const event of result.events) {
    if (!event.edgeId) continue
    const current = edgeAggregates.get(event.edgeId) ?? { calls: 0, failures: new Set<string>(), bytes: 0 }
    if (event.type === 'dependency-started') {
      current.calls += 1
      current.bytes += event.bytes ?? 0
    }
    if (event.status === 'error' || event.status === 'rejected') current.failures.add(`${event.traceId ?? 'aggregate'}:${event.spanId ?? event.sequence}:${event.attempt}`)
    edgeAggregates.set(event.edgeId, current)
  }
  const edges = new Map([...edgeAggregates].filter(([, value]) => value.calls > 0 || value.failures.size > 0).map(([edgeId, value]) => [edgeId, {
    observedCalls: value.calls, observedFailures: value.failures.size, observedBytes: value.bytes, severity: value.failures.size > 0 ? 'failed' as const : 'active' as const,
  }]))
  return { nodes, edges }
}

export const formatCanvasCount = (value: number) => value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}m` : value >= 1_000 ? `${(value / 1_000).toFixed(1)}k` : value.toLocaleString()
export const formatCanvasBytes = (value: number) => value >= 1_073_741_824 ? `${(value / 1_073_741_824).toFixed(1)} GB` : value >= 1_048_576 ? `${(value / 1_048_576).toFixed(1)} MB` : value >= 1_024 ? `${(value / 1_024).toFixed(1)} KB` : `${value} B`
