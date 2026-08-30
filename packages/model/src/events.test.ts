import { describe, expect, it } from 'vitest'
import { runtimeEventSchema, simulationProgressSchema, spanSchema } from './events'

describe('runtime telemetry contracts', () => {
  it('validates canonical ordered events and defaults', () => {
    const event = runtimeEventSchema.parse({ runId: 'run', timestampMs: 10, sequence: 0, requestId: '1', traceId: 'trace-1', spanId: 'span-1', nodeId: 'service', type: 'request-started', status: 'pending' })
    expect(event).toMatchObject({ attempt: 1, reason: 'none', attributes: {} })
    expect(runtimeEventSchema.safeParse({ ...event, sequence: -1 }).success).toBe(false)
  })

  it('validates spans and progress event batches', () => {
    const span = spanSchema.parse({ runId: 'run', traceId: 'trace', spanId: 'span', requestId: '1', nodeId: 'service', attempt: 1, startedAtMs: 1, endedAtMs: 3, durationMs: 2, queueDurationMs: 0, status: 'ok', reason: 'none' })
    expect(simulationProgressSchema.parse({ runId: 'run', simulatedTimeMs: 3, simulatedDurationMs: 10, generatedRequests: 1, completedRequests: 1, failedRequests: 0, events: [] }).events).toEqual([])
    expect(JSON.parse(JSON.stringify(span))).toEqual(span)
  })

  it('rejects incomplete request correlation and invalid span timing', () => {
    expect(runtimeEventSchema.safeParse({ runId: 'run', timestampMs: 1, sequence: 0, requestId: '1', type: 'request-started', status: 'pending' }).success).toBe(false)
    expect(spanSchema.safeParse({ runId: 'run', traceId: 'trace', spanId: 'span', requestId: '1', nodeId: 'service', attempt: 1, startedAtMs: 3, endedAtMs: 2, durationMs: 0, queueDurationMs: 0, status: 'error', reason: 'timeout' }).success).toBe(false)
  })

  it('rejects progress batches from another run or out of sequence', () => {
    const event = runtimeEventSchema.parse({ runId: 'other-run', timestampMs: 1, sequence: 2, type: 'node-snapshot', status: 'ok' })
    const progress = { runId: 'run', simulatedTimeMs: 2, simulatedDurationMs: 10, generatedRequests: 0, completedRequests: 0, failedRequests: 0, events: [event, { ...event, runId: 'run', sequence: 1 }] }
    expect(simulationProgressSchema.safeParse(progress).success).toBe(false)
  })

  it.each(['cache-hit', 'cdn-pop-selected', 'cdn-origin-fetch', 'stream-record-appended', 'object-read', 'database-written'] as const)('accepts the %s domain event', (type) => {
    expect(runtimeEventSchema.parse({ runId: 'run', timestampMs: 1, sequence: 0, requestId: '1', traceId: 'trace', spanId: 'span', nodeId: 'data', type, status: 'ok' }).type).toBe(type)
  })

  it.each(['node_down', 'packet_loss', 'latency_spike', 'region_outage'] as const)('accepts the %s fault reason', (reason) => {
    expect(runtimeEventSchema.parse({ runId: 'run', timestampMs: 1, sequence: 0, type: 'fault-activated', status: 'error', reason }).reason).toBe(reason)
  })
})
