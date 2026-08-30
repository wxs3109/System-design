import type { ComponentNode, NodeMetrics, RuntimeEvent, Scenario, SummaryMetrics, TimeSeriesPoint, TraceSpan, TraceStep } from '@system-design/model'
import { percentile, round } from './math'

const terminalEvents = new Set<RuntimeEvent['type']>(['request-completed', 'request-failed'])

export const reduceSummary = (events: readonly RuntimeEvent[], durationSeconds: number): SummaryMetrics => {
  const generated = events.filter((event) => event.type === 'request-generated').length
  const terminal = events.filter((event) => terminalEvents.has(event.type) && event.attributes.terminal === true)
  const completed = terminal.filter((event) => event.type === 'request-completed').length
  const failed = terminal.filter((event) => event.type === 'request-failed').length
  const latencies = terminal.filter((event) => event.type === 'request-completed').map((event) => Number(event.attributes.totalLatencyMs ?? 0)).sort((left, right) => left - right)
  return {
    generatedRequests: generated, completedRequests: completed, failedRequests: failed, throughputPerSecond: round(completed / durationSeconds),
    errorRate: round(generated === 0 ? 0 : failed / generated), latencyP50Ms: round(percentile(latencies, 0.5)), latencyP95Ms: round(percentile(latencies, 0.95)), latencyP99Ms: round(percentile(latencies, 0.99)),
  }
}

export const reduceNodeMetrics = (events: readonly RuntimeEvent[], nodes: readonly ComponentNode[]): NodeMetrics[] => nodes.filter((node) => node.type !== 'traffic').map((node) => {
  const nodeEvents = events.filter((event) => event.nodeId === node.id)
  const snapshots = nodeEvents.filter((event) => event.type === 'node-snapshot')
  const latest = snapshots.at(-1)
  const completed = new Set(nodeEvents.filter((event) => event.type === 'request-completed' && event.durationMs !== undefined && event.requestId && event.spanId).map((event) => `${event.requestId}:${event.spanId}:${event.nodeId}`))
  const failed = new Set(nodeEvents.filter((event) => event.type === 'request-failed' && event.attributes.terminal !== true && event.requestId && event.spanId).map((event) => `${event.requestId}:${event.spanId}:${event.nodeId}`))
  return {
    nodeId: node.id, nodeName: node.name, nodeType: node.type,
    processedRequests: completed.size,
    failedRequests: failed.size,
    utilization: round(Number(latest?.attributes.utilization ?? 0)),
    averageQueueLength: round(Number(latest?.attributes.averageQueueLength ?? 0)),
    maxQueueLength: Number(latest?.attributes.maxQueueLength ?? 0),
  }
})

export const reduceTimeSeries = (events: readonly RuntimeEvent[], scenario: Scenario): TimeSeriesPoint[] => {
  const points: TimeSeriesPoint[] = []
  const interval = scenario.simulation.sampleIntervalMs
  let previousCompleted = 0
  for (let timeMs = interval; timeMs <= scenario.simulation.durationSeconds * 1_000; timeMs += interval) {
    const visible = events.filter((event) => event.timestampMs <= timeMs)
    const terminal = visible.filter((event) => terminalEvents.has(event.type) && event.attributes.terminal === true)
    const completed = terminal.filter((event) => event.type === 'request-completed').length
    const failed = terminal.filter((event) => event.type === 'request-failed').length
    const windowLatencies = terminal.filter((event) => event.type === 'request-completed' && event.timestampMs > timeMs - interval).map((event) => Number(event.attributes.totalLatencyMs ?? 0)).sort((a, b) => a - b)
    const latestSnapshotByNode = new Map<string, RuntimeEvent>()
    visible.filter((event) => event.type === 'node-snapshot' && event.nodeId).forEach((event) => latestSnapshotByNode.set(event.nodeId!, event))
    points.push({
      timeSeconds: round(timeMs / 1_000), completedRequests: completed, failedRequests: failed, throughputPerSecond: round((completed - previousCompleted) / (interval / 1_000)),
      latencyP95Ms: round(percentile(windowLatencies, 0.95)), queuedRequests: [...latestSnapshotByNode.values()].reduce((sum, event) => sum + Number(event.attributes.queueLength ?? 0), 0),
    })
    previousCompleted = completed
  }
  return points
}

export const reduceSpans = (events: readonly RuntimeEvent[]): TraceSpan[] => {
  const started = new Map<string, RuntimeEvent>()
  const spans: TraceSpan[] = []
  for (const event of events) {
    if (!event.spanId || !event.traceId || !event.requestId || !event.nodeId) continue
    if (event.type === 'request-started') started.set(event.spanId, event)
    if ((event.type === 'request-completed' || event.type === 'request-failed') && started.has(event.spanId)) {
      const start = started.get(event.spanId)!
      spans.push({
        runId: event.runId, traceId: event.traceId, spanId: event.spanId, ...(event.parentSpanId === undefined ? {} : { parentSpanId: event.parentSpanId }),
        requestId: event.requestId, nodeId: event.nodeId, ...(event.edgeId === undefined ? {} : { edgeId: event.edgeId }), attempt: event.attempt,
        startedAtMs: start.timestampMs, endedAtMs: event.timestampMs, durationMs: event.durationMs ?? round(event.timestampMs - start.timestampMs),
        queueDurationMs: start.queueDurationMs ?? 0, status: event.type === 'request-completed' ? 'ok' : 'error', reason: event.reason,
      })
      started.delete(event.spanId)
    }
  }
  return spans
}

export const reduceLegacyTraces = (events: readonly RuntimeEvent[], nodeNames: ReadonlyMap<string, string>, traceLimit: number): TraceStep[] => events
  .filter((event) => event.requestId && Number(event.requestId) <= traceLimit && event.nodeId && ['request-generated', 'request-queued', 'request-started', 'request-completed', 'request-failed'].includes(event.type))
  .map((event) => ({ requestId: Number(event.requestId), nodeId: event.nodeId!, nodeName: nodeNames.get(event.nodeId!) ?? event.nodeId!, event: event.type.replace('request-', '') as TraceStep['event'], timeMs: event.timestampMs }))
