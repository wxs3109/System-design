import { describe, expect, it } from 'vitest'
import type { NodeMetrics, RuntimeEvent } from '@system-design/model'
import { explainBottlenecks } from './explanations'

const event = (sequence: number, input: Partial<RuntimeEvent> & Pick<RuntimeEvent, 'type'>): RuntimeEvent => ({
  runId: 'run', timestampMs: sequence * 100, sequence, attempt: 1, status: 'ok', reason: 'none', attributes: {}, ...input,
})

const nodes: Pick<NodeMetrics, 'nodeId' | 'nodeName'>[] = [
  { nodeId: 'service', nodeName: 'Checkout API' },
  { nodeId: 'cache', nodeName: 'Product Cache' },
  { nodeId: 'database', nodeName: 'Orders DB' },
]

describe('evidence-based bottleneck explanations', () => {
  it('requires sustained high utilization and a growing queue', () => {
    const events = [
      event(0, { type: 'node-snapshot', nodeId: 'service', attributes: { utilization: 0.9, queueLength: 2 } }),
      event(1, { type: 'request-queued', nodeId: 'service', requestId: '1', traceId: 'trace-1', spanId: 'span-1', attributes: { queueLength: 3 } }),
      event(2, { type: 'node-snapshot', nodeId: 'service', attributes: { utilization: 0.95, queueLength: 6 } }),
    ]
    const finding = explainBottlenecks(events, nodes).find((candidate) => candidate.ruleId === 'sustained-saturation')
    expect(finding).toMatchObject({
      title: 'Checkout API stayed saturated while its queue grew',
      interval: { startMs: 0, endMs: 200 },
      target: { nodeId: 'service' },
      traceIds: ['trace-1'],
    })
    expect(finding?.evidence.find((value) => value.key === 'minimum-utilization')).toMatchObject({ value: 0.9, threshold: 0.8, sourceEventSequences: [0, 2] })
    expect(finding?.evidence.find((value) => value.key === 'queue-growth')?.value).toBe(4)

    expect(explainBottlenecks([
      event(0, { type: 'node-snapshot', nodeId: 'service', attributes: { utilization: 0.9, queueLength: 4 } }),
      event(1, { type: 'node-snapshot', nodeId: 'service', attributes: { utilization: 0.95, queueLength: 2 } }),
    ], nodes)).toHaveLength(0)
  })

  it('links downstream timeouts, retries and amplified attempts to traces', () => {
    const events = [
      event(0, { type: 'attempt-started', nodeId: 'service', edgeId: 'dependency', requestId: '1', traceId: 'trace-1', spanId: 'attempt-1', status: 'pending' }),
      event(1, { type: 'timeout-fired', nodeId: 'service', edgeId: 'dependency', requestId: '1', traceId: 'trace-1', spanId: 'attempt-1', status: 'error', reason: 'timeout' }),
      event(2, { type: 'retry-scheduled', nodeId: 'database', edgeId: 'dependency', requestId: '1', traceId: 'trace-1', spanId: 'attempt-1', status: 'pending', reason: 'timeout' }),
      event(3, { type: 'attempt-started', nodeId: 'service', edgeId: 'dependency', requestId: '1', traceId: 'trace-1', spanId: 'attempt-2', status: 'pending', attempt: 2 }),
    ]
    const finding = explainBottlenecks(events, nodes).find((candidate) => candidate.ruleId === 'retry-amplification')
    expect(finding).toMatchObject({ target: { nodeId: 'service', edgeId: 'dependency' }, traceIds: ['trace-1'] })
    expect(finding?.evidence.map((value) => [value.key, value.value])).toEqual([
      ['timeouts', 1], ['scheduled-retries', 1], ['attempt-amplification', 2],
    ])
  })

  it('explains a hot shard from per-shard event evidence', () => {
    const events = [
      event(0, { type: 'node-snapshot', nodeId: 'database', attributes: { requestsByShard0: 8, requestsByShard1: 1, requestsByShard2: 1, requestsByShard3: 0 } }),
      event(1, { type: 'database-read', nodeId: 'database', requestId: '1', traceId: 'trace-1', spanId: 'span-1', attributes: { shard: 0 } }),
      event(2, { type: 'node-snapshot', nodeId: 'database', attributes: { requestsByShard0: 16, requestsByShard1: 2, requestsByShard2: 1, requestsByShard3: 1 } }),
    ]
    const finding = explainBottlenecks(events, nodes).find((candidate) => candidate.ruleId === 'hot-shard')
    expect(finding).toMatchObject({ title: 'Orders DB routed disproportionate traffic to shard 0', traceIds: ['trace-1'] })
    expect(finding?.evidence.find((value) => value.key === 'hottest-shard-share')).toMatchObject({ value: 0.8, threshold: 0.513 })
    expect(finding?.evidence.find((value) => value.key === 'database-requests')?.value).toBe(20)
  })

  it('correlates cache misses to later database operations by trace', () => {
    const events: RuntimeEvent[] = []
    for (let index = 0; index < 5; index += 1) {
      events.push(event(index * 2, { type: 'cache-miss', nodeId: 'cache', requestId: String(index), traceId: `trace-${index}`, spanId: `cache-${index}` }))
      events.push(event(index * 2 + 1, { type: 'database-read', nodeId: 'database', requestId: String(index), traceId: `trace-${index}`, spanId: `db-${index}`, attributes: { shard: 0 } }))
    }
    const finding = explainBottlenecks(events, nodes).find((candidate) => candidate.ruleId === 'cache-miss-database-load')
    expect(finding).toMatchObject({ target: { nodeId: 'cache', relatedNodeId: 'database' } })
    expect(finding?.traceIds).toEqual(['trace-0', 'trace-1', 'trace-2', 'trace-3', 'trace-4'])
    expect(finding?.evidence.find((value) => value.key === 'correlated-miss-share')?.value).toBe(1)
  })

  it('reports circuit protection only when open state rejects attempts', () => {
    const events = [
      event(0, { type: 'circuit-opened', nodeId: 'service', edgeId: 'dependency', status: 'error' }),
      event(1, { type: 'attempt-started', nodeId: 'database', edgeId: 'dependency', requestId: '2', traceId: 'trace-2', spanId: 'attempt-2', status: 'rejected', reason: 'circuit_open' }),
      event(2, { type: 'circuit-half-opened', nodeId: 'service', edgeId: 'dependency' }),
      event(3, { type: 'circuit-closed', nodeId: 'service', edgeId: 'dependency' }),
    ]
    const finding = explainBottlenecks(events, nodes).find((candidate) => candidate.ruleId === 'open-circuit-rejections')
    expect(finding).toMatchObject({ target: { nodeId: 'database', edgeId: 'dependency' }, traceIds: ['trace-2'] })
    expect(finding?.evidence.map((value) => value.value)).toEqual([1, 1, 2])
  })

  it('returns stable findings for the same event log and never invents unsupported claims', () => {
    const noEvidence = [event(0, { type: 'request-completed', nodeId: 'service', requestId: '1', traceId: 'trace-1', spanId: 'span-1' })]
    expect(explainBottlenecks(noEvidence, nodes)).toEqual([])
    expect(explainBottlenecks(noEvidence, nodes)).toEqual(explainBottlenecks(structuredClone(noEvidence), structuredClone(nodes)))
  })
})
