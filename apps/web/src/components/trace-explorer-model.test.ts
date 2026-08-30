import { describe, expect, it } from 'vitest'
import type { RuntimeEvent, SimulationResult, TraceSpan } from '@system-design/model'
import { buildTraceMarkers, buildTraceRecords, buildWaterfallLanes, filterTraceRecords } from './trace-explorer-model'

const span = (updates: Partial<TraceSpan> = {}): TraceSpan => ({
  runId: 'run', traceId: 'trace-ok', spanId: 'root', requestId: '1', nodeId: 'api', attempt: 1,
  startedAtMs: 10, endedAtMs: 30, durationMs: 20, queueDurationMs: 5, status: 'ok', reason: 'none', ...updates,
})

const event = (updates: Partial<RuntimeEvent> = {}): RuntimeEvent => ({
  runId: 'run', timestampMs: 10, sequence: 0, attempt: 1, type: 'request-generated', status: 'pending', reason: 'none', attributes: {}, ...updates,
})

const result = (spans: TraceSpan[], events: RuntimeEvent[]): Pick<SimulationResult, 'spans' | 'events'> => ({ spans, events })

describe('trace explorer projections', () => {
  it('groups spans into terminal request outcomes and preserves source-to-terminal timing', () => {
    const spans = [
      span(),
      span({ spanId: 'db', parentSpanId: 'root', nodeId: 'database', startedAtMs: 15, endedAtMs: 28, durationMs: 13, queueDurationMs: 3 }),
      span({ traceId: 'trace-error', requestId: '2', spanId: 'failed', nodeId: 'worker', startedAtMs: 40, endedAtMs: 70, durationMs: 30, queueDurationMs: 0, status: 'error', reason: 'timeout' }),
    ]
    const events = [
      event({ requestId: '1', traceId: 'trace-ok', spanId: 'root' }),
      event({ timestampMs: 32, sequence: 1, requestId: '1', traceId: 'trace-ok', spanId: 'root', nodeId: 'api', type: 'request-completed', status: 'ok', attributes: { terminal: true, totalLatencyMs: 22 } }),
      event({ timestampMs: 40, sequence: 2, requestId: '2', traceId: 'trace-error', spanId: 'failed' }),
      event({ timestampMs: 72, sequence: 3, requestId: '2', traceId: 'trace-error', spanId: 'failed', nodeId: 'worker', type: 'request-failed', status: 'error', reason: 'timeout', attributes: { terminal: true, totalLatencyMs: 32 } }),
    ]

    const records = buildTraceRecords(result(spans, events))
    expect(records).toHaveLength(2)
    expect(records[0]).toMatchObject({ traceId: 'trace-ok', status: 'ok', reason: 'none', reasonCodes: [], startedAtMs: 10, endedAtMs: 32, durationMs: 22, terminalNodeId: 'api' })
    expect(records[0]?.componentIds).toEqual(['api', 'database'])
    expect(records[1]).toMatchObject({ traceId: 'trace-error', status: 'error', reason: 'timeout', reasonCodes: ['timeout'], durationMs: 32 })
  })

  it('filters by outcome, latency, component and terminal reason together', () => {
    const records = buildTraceRecords(result([
      span(),
      span({ traceId: 'trace-error', requestId: '2', spanId: 'failed', nodeId: 'worker', startedAtMs: 40, endedAtMs: 90, durationMs: 50, status: 'error', reason: 'queue_full' }),
    ], [
      event({ requestId: '1', traceId: 'trace-ok', spanId: 'root' }),
      event({ timestampMs: 30, sequence: 1, requestId: '1', traceId: 'trace-ok', spanId: 'root', nodeId: 'api', type: 'request-completed', status: 'ok', attributes: { terminal: true } }),
      event({ timestampMs: 40, sequence: 2, requestId: '2', traceId: 'trace-error', spanId: 'failed' }),
      event({ timestampMs: 90, sequence: 3, requestId: '2', traceId: 'trace-error', spanId: 'failed', nodeId: 'worker', type: 'request-failed', status: 'error', reason: 'queue_full', attributes: { terminal: true } }),
    ]))

    expect(filterTraceRecords(records, { status: 'error', minimumLatencyMs: 40, componentId: 'worker', reason: 'queue_full' }).map((trace) => trace.traceId)).toEqual(['trace-error'])
    expect(filterTraceRecords(records, { status: 'ok', minimumLatencyMs: 40, componentId: '', reason: 'all' })).toEqual([])
  })

  it('filters a recovered request by an earlier failed-attempt reason', () => {
    const records = buildTraceRecords(result([
      span(),
      span({ spanId: 'retry', parentSpanId: 'root', nodeId: 'database', attempt: 1, startedAtMs: 12, endedAtMs: 17, durationMs: 5, status: 'error', reason: 'timeout' }),
    ], [
      event({ requestId: '1', traceId: 'trace-ok', spanId: 'root' }),
      event({ timestampMs: 30, sequence: 1, requestId: '1', traceId: 'trace-ok', spanId: 'root', nodeId: 'api', type: 'request-completed', status: 'ok', attributes: { terminal: true } }),
    ]))

    expect(records[0]).toMatchObject({ status: 'ok', reason: 'none', reasonCodes: ['timeout'] })
    expect(filterTraceRecords(records, { status: 'ok', minimumLatencyMs: 0, componentId: '', reason: 'timeout' })).toHaveLength(1)
  })

  it('projects dependency depth, queue versus service time, retries and aligned event markers', () => {
    const trace = buildTraceRecords(result([
      span(),
      span({ spanId: 'attempt', parentSpanId: 'root', nodeId: 'database', attempt: 2, startedAtMs: 15, endedAtMs: 28, durationMs: 13, queueDurationMs: 3, status: 'error', reason: 'timeout' }),
    ], [
      event({ requestId: '1', traceId: 'trace-ok', spanId: 'root' }),
      event({ timestampMs: 30, sequence: 1, requestId: '1', traceId: 'trace-ok', spanId: 'root', nodeId: 'api', type: 'request-failed', status: 'error', reason: 'timeout', attributes: { terminal: true } }),
    ]))[0]!
    const lanes = buildWaterfallLanes(trace, new Map([['api', 'API'], ['database', 'Database']]))
    const markers = buildTraceMarkers(trace, [
      event({ timestampMs: 15, sequence: 1, requestId: '1', traceId: 'trace-ok', spanId: 'attempt', nodeId: 'database', type: 'attempt-started', status: 'pending', attempt: 2 }),
      event({ timestampMs: 16, sequence: 2, requestId: '1', traceId: 'trace-ok', spanId: 'attempt', nodeId: 'database', type: 'timeout-fired', status: 'error', reason: 'timeout' }),
      event({ timestampMs: 20, sequence: 3, type: 'fault-activated', status: 'error', reason: 'node_down', nodeId: 'database', attributes: { faultId: 'fault' } }),
      event({ timestampMs: 50, sequence: 4, type: 'fault-recovered', status: 'ok', reason: 'node_down', nodeId: 'database', attributes: { faultId: 'fault' } }),
    ], lanes)

    expect(lanes[1]).toMatchObject({ depth: 1, label: '  Database · attempt 2', startOffsetMs: 5, queueDurationMs: 3, serviceDurationMs: 10 })
    expect(markers.map((marker) => ({ type: marker.event.type, offsetMs: marker.offsetMs, laneIndex: marker.laneIndex, kind: marker.kind }))).toEqual([
      { type: 'attempt-started', offsetMs: 5, laneIndex: 1, kind: 'policy' },
      { type: 'timeout-fired', offsetMs: 6, laneIndex: 1, kind: 'policy' },
      { type: 'fault-activated', offsetMs: 10, laneIndex: 1, kind: 'fault' },
    ])
  })

  it('uses operation lifecycle events as the trace boundary and terminal outcome', () => {
    const operationSpan = span({
      traceId: 'operation-trace', requestId: '7', spanId: 'operation-trace:operation', nodeId: 'traffic',
      operationId: 'create-order', startedAtMs: 5, endedAtMs: 45, durationMs: 40, queueDurationMs: 0, status: 'error', reason: 'queue_full',
    })
    const actionSpan = span({
      traceId: 'operation-trace', requestId: '7', spanId: 'operation-trace:action:write', parentSpanId: 'operation-trace:operation',
      nodeId: 'database', operationId: 'create-order', actionId: 'write', startedAtMs: 10, endedAtMs: 45, durationMs: 35,
      queueDurationMs: 20, status: 'error', reason: 'queue_full',
    })
    const records = buildTraceRecords(result([operationSpan, actionSpan], [
      event({ timestampMs: 5, requestId: '7', traceId: 'operation-trace', spanId: 'operation-trace:operation', nodeId: 'traffic', operationId: 'create-order', type: 'operation-started' }),
      event({ timestampMs: 45, sequence: 1, requestId: '7', traceId: 'operation-trace', spanId: 'operation-trace:operation', nodeId: 'traffic', operationId: 'create-order', type: 'operation-completed', status: 'error', reason: 'queue_full', attributes: { terminal: true, totalLatencyMs: 40 } }),
    ]))

    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ traceId: 'operation-trace', requestId: '7', operationId: 'create-order', startedAtMs: 5, endedAtMs: 45, durationMs: 40, status: 'error', reason: 'queue_full', terminalNodeId: 'traffic' })
    expect(buildWaterfallLanes(records[0]!, new Map([['traffic', 'Client'], ['database', 'Orders DB']]))[1]?.label).toBe('  Orders DB · write')
  })
})
