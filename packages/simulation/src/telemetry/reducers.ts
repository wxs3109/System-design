import type { ActionMetrics, ComponentNode, NodeMetrics, OperationMetrics, RuntimeEvent, Scenario, SummaryMetrics, TimeSeriesPoint, TraceSpan, TraceStep } from '@system-design/model'
import { percentile, round } from './math'

const terminalEvents = new Set<RuntimeEvent['type']>(['request-completed', 'request-failed', 'operation-completed'])

export interface SummaryAggregate {
  generatedRequests: number
  completedRequests: number
  failedRequests: number
  completedLatencies: number[]
}

export interface NodeMetricAggregate {
  processedRequestsByNode: ReadonlyMap<string, number>
  failedRequestsByNode: ReadonlyMap<string, number>
  maxQueueByNode: ReadonlyMap<string, number>
  latestNodeSnapshotByNode: ReadonlyMap<string, RuntimeEvent>
}

export interface TimeSeriesAggregate {
  completedRequestsByInterval: ReadonlyMap<number, number>
  failedRequestsByInterval: ReadonlyMap<number, number>
  completedLatenciesByInterval: ReadonlyMap<number, readonly number[]>
  queueSnapshotsByInterval: ReadonlyMap<number, ReadonlyMap<string, number>>
}

export const reduceSummary = (events: readonly RuntimeEvent[], durationSeconds: number, aggregate?: SummaryAggregate): SummaryMetrics => {
  const terminal = aggregate ? [] : events.filter((event) => terminalEvents.has(event.type) && event.attributes.terminal === true)
  const generated = aggregate?.generatedRequests ?? events.filter((event) => event.type === 'request-generated' || event.type === 'operation-started').length
  const completed = aggregate?.completedRequests ?? terminal.filter((event) => event.type === 'request-completed' || (event.type === 'operation-completed' && event.status === 'ok')).length
  const failed = aggregate?.failedRequests ?? terminal.filter((event) => event.type === 'request-failed' || (event.type === 'operation-completed' && event.status !== 'ok')).length
  const latencies = [...(aggregate?.completedLatencies ?? terminal.filter((event) => event.type === 'request-completed' || (event.type === 'operation-completed' && event.status === 'ok')).map((event) => Number(event.attributes.totalLatencyMs ?? 0)))].sort((left, right) => left - right)
  return {
    generatedRequests: generated, completedRequests: completed, failedRequests: failed, throughputPerSecond: round(completed / durationSeconds),
    errorRate: round(generated === 0 ? 0 : failed / generated), latencyP50Ms: round(percentile(latencies, 0.5)), latencyP95Ms: round(percentile(latencies, 0.95)), latencyP99Ms: round(percentile(latencies, 0.99)),
  }
}

export const reduceNodeMetrics = (events: readonly RuntimeEvent[], nodes: readonly ComponentNode[], aggregate?: NodeMetricAggregate): NodeMetrics[] => nodes.filter((node) => node.type !== 'traffic').map((node) => {
  const nodeEvents = events.filter((event) => event.nodeId === node.id)
  const snapshots = nodeEvents.filter((event) => event.type === 'node-snapshot')
  const latest = aggregate?.latestNodeSnapshotByNode.get(node.id) ?? snapshots.at(-1)
  const completed = new Set(nodeEvents.filter((event) => (event.type === 'request-completed' || event.type === 'action-completed') && event.status === 'ok' && event.durationMs !== undefined && event.requestId && event.spanId).map((event) => `${event.requestId}:${event.spanId}:${event.nodeId}`))
  const failed = new Set(nodeEvents.filter((event) => ((event.type === 'request-failed' && event.attributes.terminal !== true) || (event.type === 'action-completed' && event.status !== 'ok')) && event.requestId && event.spanId).map((event) => `${event.requestId}:${event.spanId}:${event.nodeId}`))
  const details = Object.fromEntries(Object.entries(latest?.attributes ?? {}).filter(([key]) => !['queueLength', 'capacity', 'unitsInUse', 'utilization', 'averageQueueLength', 'maxQueueLength'].includes(key)))
  return {
    nodeId: node.id, nodeName: node.name, nodeType: node.type,
    processedRequests: aggregate?.processedRequestsByNode.get(node.id) ?? completed.size,
    failedRequests: aggregate?.failedRequestsByNode.get(node.id) ?? failed.size,
    utilization: round(Number(latest?.attributes.utilization ?? 0)),
    averageQueueLength: round(Number(latest?.attributes.averageQueueLength ?? 0)),
    maxQueueLength: aggregate?.maxQueueByNode.get(node.id) ?? Number(latest?.attributes.maxQueueLength ?? 0), details,
  }
})

export const reduceTimeSeries = (events: readonly RuntimeEvent[], scenario: Scenario, aggregate?: TimeSeriesAggregate): TimeSeriesPoint[] => {
  const points: TimeSeriesPoint[] = []
  const interval = scenario.simulation.sampleIntervalMs
  if (aggregate) {
    let completed = 0
    let failed = 0
    const queueByNode = new Map<string, number>()
    for (let intervalIndex = 1, timeMs = interval; timeMs <= scenario.simulation.durationSeconds * 1_000; intervalIndex += 1, timeMs += interval) {
      const completedInInterval = aggregate.completedRequestsByInterval.get(intervalIndex) ?? 0
      completed += completedInInterval
      failed += aggregate.failedRequestsByInterval.get(intervalIndex) ?? 0
      for (const [nodeId, queueLength] of aggregate.queueSnapshotsByInterval.get(intervalIndex) ?? []) queueByNode.set(nodeId, queueLength)
      const windowLatencies = [...(aggregate.completedLatenciesByInterval.get(intervalIndex) ?? [])].sort((left, right) => left - right)
      points.push({
        timeSeconds: round(timeMs / 1_000), completedRequests: completed, failedRequests: failed, throughputPerSecond: round(completedInInterval / (interval / 1_000)),
        latencyP95Ms: round(percentile(windowLatencies, 0.95)), queuedRequests: [...queueByNode.values()].reduce((sum, queueLength) => sum + queueLength, 0),
      })
    }
    return points
  }
  let previousCompleted = 0
  for (let timeMs = interval; timeMs <= scenario.simulation.durationSeconds * 1_000; timeMs += interval) {
    const visible = events.filter((event) => event.timestampMs <= timeMs)
    const terminal = visible.filter((event) => terminalEvents.has(event.type) && event.attributes.terminal === true)
    const completed = terminal.filter((event) => event.type === 'request-completed' || (event.type === 'operation-completed' && event.status === 'ok')).length
    const failed = terminal.filter((event) => event.type === 'request-failed' || (event.type === 'operation-completed' && event.status !== 'ok')).length
    const windowLatencies = terminal.filter((event) => (event.type === 'request-completed' || (event.type === 'operation-completed' && event.status === 'ok')) && event.timestampMs > timeMs - interval).map((event) => Number(event.attributes.totalLatencyMs ?? 0)).sort((a, b) => a - b)
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
  const queueDurations = new Map<string, number>()
  const spans: TraceSpan[] = []
  for (const event of events) {
    if (!event.spanId || !event.traceId || !event.requestId || !event.nodeId) continue
    if (event.type === 'attempt-started' || event.type === 'action-started' || event.type === 'operation-started') started.set(event.spanId, event)
    if (event.type === 'request-started') {
      if (started.get(event.spanId)?.type === 'attempt-started') queueDurations.set(event.spanId, event.queueDurationMs ?? 0)
      else started.set(event.spanId, event)
    }
    const start = started.get(event.spanId)
    if (!start) continue
    const isAttempt = start.type === 'attempt-started'
    const attemptEnded = isAttempt && (event.type === 'timeout-fired' || event.type === 'dependency-returned' || (event.type === 'request-failed' && event.reason === 'circuit_open'))
    const requestEnded = !isAttempt && (event.type === 'request-completed' || event.type === 'request-failed' || event.type === 'action-completed' || event.type === 'operation-completed')
    if (attemptEnded || requestEnded) {
      spans.push({
        runId: event.runId, traceId: event.traceId, spanId: event.spanId, ...(event.parentSpanId === undefined ? {} : { parentSpanId: event.parentSpanId }),
        requestId: event.requestId, nodeId: event.nodeId, ...(event.edgeId === undefined ? {} : { edgeId: event.edgeId }), attempt: event.attempt,
        ...(event.operationId === undefined ? {} : { operationId: event.operationId }), ...(event.actionId === undefined ? {} : { actionId: event.actionId }),
        startedAtMs: start.timestampMs, endedAtMs: event.timestampMs, durationMs: round(event.timestampMs - start.timestampMs),
        queueDurationMs: isAttempt ? queueDurations.get(event.spanId) ?? 0 : start.queueDurationMs ?? 0, status: event.status === 'ok' ? 'ok' : 'error', reason: event.reason,
      })
      started.delete(event.spanId)
      queueDurations.delete(event.spanId)
    }
  }
  return spans
}

export const reduceLegacyTraces = (events: readonly RuntimeEvent[], nodeNames: ReadonlyMap<string, string>, traceLimit: number): TraceStep[] => events
  .filter((event) => event.requestId && Number(event.requestId) <= traceLimit && event.nodeId && ['request-generated', 'request-queued', 'request-started', 'request-completed', 'request-failed'].includes(event.type))
  .map((event) => ({ requestId: Number(event.requestId), nodeId: event.nodeId!, nodeName: nodeNames.get(event.nodeId!) ?? event.nodeId!, event: event.type.replace('request-', '') as TraceStep['event'], timeMs: event.timestampMs }))

export const reduceOperationMetrics = (events: readonly RuntimeEvent[], aggregate?: Pick<import('./event-sink').RuntimeTelemetryAggregate, 'operations'>): OperationMetrics[] => {
  if (aggregate) return [...aggregate.operations].map(([operationId, value]) => ({
    operationId, generatedRequests: value.generatedRequests, completedRequests: value.completedRequests, failedRequests: value.failedRequests,
    latencyP95Ms: round(percentile([...value.completedLatencies].sort((left, right) => left - right), 0.95)),
  }))
  const byOperation = new Map<string, { generated: number; completed: number; failed: number; latencies: number[] }>()
  for (const event of events) {
    if (!event.operationId || (event.type !== 'operation-started' && event.type !== 'operation-completed')) continue
    const value = byOperation.get(event.operationId) ?? { generated: 0, completed: 0, failed: 0, latencies: [] }
    if (event.type === 'operation-started') value.generated += 1
    else if (event.status === 'ok') { value.completed += 1; value.latencies.push(event.durationMs ?? Number(event.attributes.totalLatencyMs ?? 0)) }
    else value.failed += 1
    byOperation.set(event.operationId, value)
  }
  return [...byOperation].map(([operationId, value]) => ({ operationId, generatedRequests: value.generated, completedRequests: value.completed, failedRequests: value.failed, latencyP95Ms: round(percentile(value.latencies.sort((a, b) => a - b), 0.95)) }))
}

export const reduceActionMetrics = (events: readonly RuntimeEvent[], aggregate?: Pick<import('./event-sink').RuntimeTelemetryAggregate, 'actions'>): ActionMetrics[] => {
  if (aggregate) return [...aggregate.actions.values()].map((value) => ({
    operationId: value.operationId, actionId: value.actionId, actionKind: value.actionKind, completed: value.completed, failed: value.failed,
    averageDurationMs: round(value.totalDurationMs / Math.max(1, value.completed + value.failed)), recordsExamined: value.recordsExamined, bytesProcessed: value.bytesProcessed,
    ...(value.explanation === undefined ? {} : { explanation: value.explanation }),
    ...(Object.keys(value.details).length === 0 ? {} : { details: { ...value.details } }),
  }))
  const byAction = new Map<string, { operationId: string; actionId: string; actionKind: string; completed: number; failed: number; duration: number; records: number; bytes: number; explanation?: string; details: Record<string, string | number | boolean> }>()
  for (const event of events) {
    if (event.type !== 'action-completed' || !event.operationId || !event.actionId) continue
    const key = `${event.operationId}:${event.actionId}`
    const value = byAction.get(key) ?? { operationId: event.operationId, actionId: event.actionId, actionKind: String(event.attributes.actionKind ?? 'unknown'), completed: 0, failed: 0, duration: 0, records: 0, bytes: 0, details: {} }
    if (event.status === 'ok') value.completed += 1
    else value.failed += 1
    value.duration += event.durationMs ?? 0
    value.records += Number(event.attributes.recordsExamined ?? 0)
    value.bytes += Number(event.attributes.bytesProcessed ?? 0)
    if (typeof event.attributes.explanation === 'string' && event.attributes.explanation) value.explanation = event.attributes.explanation
    for (const [name, detail] of Object.entries(event.attributes)) {
      if ((name.startsWith('search') || name.startsWith('realtime')) && (typeof detail === 'string' || typeof detail === 'number' || typeof detail === 'boolean')) value.details[name] = detail
    }
    byAction.set(key, value)
  }
  return [...byAction.values()].map((value) => ({ operationId: value.operationId, actionId: value.actionId, actionKind: value.actionKind, completed: value.completed, failed: value.failed, averageDurationMs: round(value.duration / Math.max(1, value.completed + value.failed)), recordsExamined: value.records, bytesProcessed: value.bytes, ...(value.explanation === undefined ? {} : { explanation: value.explanation }), ...(Object.keys(value.details).length === 0 ? {} : { details: { ...value.details } }) }))
}
