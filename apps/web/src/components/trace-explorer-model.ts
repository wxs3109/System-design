import type { ReasonCode, RuntimeEvent, SimulationResult, TraceSpan } from '@system-design/model'

export type TraceStatus = 'ok' | 'error'

export interface TraceRecord {
  traceId: string
  requestId: string
  startedAtMs: number
  endedAtMs: number
  durationMs: number
  status: TraceStatus
  reason: ReasonCode
  terminalNodeId?: string
  componentIds: string[]
  spans: TraceSpan[]
}

export interface TraceFilters {
  status: 'all' | TraceStatus
  minimumLatencyMs: number
  componentId: string
  reason: 'all' | ReasonCode
}

export interface WaterfallLane {
  span: TraceSpan
  depth: number
  label: string
  startOffsetMs: number
  queueDurationMs: number
  serviceDurationMs: number
}

export interface TraceMarker {
  event: RuntimeEvent
  offsetMs: number
  laneIndex: number
  kind: 'fault' | 'policy'
}

const terminalTypes = new Set<RuntimeEvent['type']>(['request-completed', 'request-failed'])
const traceMarkerTypes = new Set<RuntimeEvent['type']>([
  'attempt-started', 'retry-scheduled', 'timeout-fired', 'rate-limit-rejected', 'message-dead-lettered',
])
const globalMarkerTypes = new Set<RuntimeEvent['type']>([
  'circuit-opened', 'circuit-half-opened', 'circuit-closed', 'fault-activated', 'fault-recovered',
])

const lastBySequence = (events: RuntimeEvent[]) => events.reduce<RuntimeEvent | undefined>((latest, event) =>
  latest === undefined || event.sequence > latest.sequence ? event : latest, undefined)

export function buildTraceRecords(result: Pick<SimulationResult, 'events' | 'spans'>): TraceRecord[] {
  const spansByTrace = new Map<string, TraceSpan[]>()
  for (const span of result.spans) {
    const spans = spansByTrace.get(span.traceId) ?? []
    spans.push(span)
    spansByTrace.set(span.traceId, spans)
  }

  const requestEventsByTrace = new Map<string, RuntimeEvent[]>()
  for (const event of result.events) {
    if (!event.traceId) continue
    const events = requestEventsByTrace.get(event.traceId) ?? []
    events.push(event)
    requestEventsByTrace.set(event.traceId, events)
  }

  const traceIds = new Set([...spansByTrace.keys(), ...requestEventsByTrace.keys()])
  return [...traceIds].flatMap((traceId) => {
    const unsortedSpans = spansByTrace.get(traceId) ?? []
    if (unsortedSpans.length === 0) return []
    const spans = [...unsortedSpans].sort((left, right) => left.startedAtMs - right.startedAtMs || left.spanId.localeCompare(right.spanId))
    const events = requestEventsByTrace.get(traceId) ?? []
    const generated = events.filter((event) => event.type === 'request-generated').sort((left, right) => left.sequence - right.sequence)[0]
    const terminal = lastBySequence(events.filter((event) => terminalTypes.has(event.type) && event.attributes.terminal === true))
      ?? lastBySequence(events.filter((event) => terminalTypes.has(event.type)))
    const startedAtMs = Math.min(generated?.timestampMs ?? Number.POSITIVE_INFINITY, ...spans.map((span) => span.startedAtMs))
    const endedAtMs = Math.max(terminal?.timestampMs ?? 0, ...spans.map((span) => span.endedAtMs))
    const failedSpan = [...spans].reverse().find((span) => span.status === 'error')
    const status: TraceStatus = terminal ? (terminal.type === 'request-failed' ? 'error' : 'ok') : failedSpan ? 'error' : 'ok'
    const reason = terminal ? terminal.reason : failedSpan?.reason ?? 'none'
    return [{
      traceId,
      requestId: terminal?.requestId ?? generated?.requestId ?? spans[0]!.requestId,
      startedAtMs: Number.isFinite(startedAtMs) ? startedAtMs : spans[0]!.startedAtMs,
      endedAtMs,
      durationMs: Math.max(0, endedAtMs - (Number.isFinite(startedAtMs) ? startedAtMs : spans[0]!.startedAtMs)),
      status,
      reason,
      ...(terminal?.nodeId === undefined ? {} : { terminalNodeId: terminal.nodeId }),
      componentIds: [...new Set(spans.map((span) => span.nodeId))],
      spans,
    }]
  }).sort((left, right) => left.startedAtMs - right.startedAtMs || left.traceId.localeCompare(right.traceId))
}

export function filterTraceRecords(records: readonly TraceRecord[], filters: TraceFilters): TraceRecord[] {
  return records.filter((trace) =>
    (filters.status === 'all' || trace.status === filters.status)
    && trace.durationMs >= filters.minimumLatencyMs
    && (!filters.componentId || trace.componentIds.includes(filters.componentId))
    && (filters.reason === 'all' || trace.reason === filters.reason),
  )
}

const spanDepth = (span: TraceSpan, byId: ReadonlyMap<string, TraceSpan>, visiting = new Set<string>()): number => {
  if (!span.parentSpanId || visiting.has(span.spanId)) return 0
  const parent = byId.get(span.parentSpanId)
  if (!parent) return 0
  visiting.add(span.spanId)
  const depth = 1 + spanDepth(parent, byId, visiting)
  visiting.delete(span.spanId)
  return depth
}

export function buildWaterfallLanes(trace: TraceRecord, nodeNames: ReadonlyMap<string, string>): WaterfallLane[] {
  const byId = new Map(trace.spans.map((span) => [span.spanId, span]))
  return trace.spans
    .map((span) => ({ span, depth: spanDepth(span, byId) }))
    .sort((left, right) => left.span.startedAtMs - right.span.startedAtMs || left.depth - right.depth || left.span.spanId.localeCompare(right.span.spanId))
    .map(({ span, depth }) => ({
      span,
      depth,
      label: `${'  '.repeat(depth)}${nodeNames.get(span.nodeId) ?? span.nodeId}${span.attempt > 1 ? ` · attempt ${span.attempt}` : ''}`,
      startOffsetMs: Math.max(0, span.startedAtMs - trace.startedAtMs),
      queueDurationMs: span.queueDurationMs,
      serviceDurationMs: Math.max(0, span.durationMs - span.queueDurationMs),
    }))
}

export function buildTraceMarkers(trace: TraceRecord, events: readonly RuntimeEvent[], lanes: readonly WaterfallLane[]): TraceMarker[] {
  const laneBySpan = new Map(lanes.map((lane, index) => [lane.span.spanId, index]))
  return events.filter((event) => {
    if (event.timestampMs < trace.startedAtMs || event.timestampMs > trace.endedAtMs) return false
    return globalMarkerTypes.has(event.type) || (traceMarkerTypes.has(event.type) && event.traceId === trace.traceId)
  }).map((event) => {
    const matchingNodeLane = event.nodeId === undefined ? undefined : lanes.findIndex((lane) => lane.span.nodeId === event.nodeId)
    return {
      event,
      offsetMs: event.timestampMs - trace.startedAtMs,
      laneIndex: event.spanId !== undefined && laneBySpan.has(event.spanId)
        ? laneBySpan.get(event.spanId)!
        : matchingNodeLane !== undefined && matchingNodeLane >= 0 ? matchingNodeLane : 0,
      kind: (event.type === 'fault-activated' || event.type === 'fault-recovered' ? 'fault' : 'policy') as TraceMarker['kind'],
    }
  }).sort((left, right) => left.event.sequence - right.event.sequence)
}
