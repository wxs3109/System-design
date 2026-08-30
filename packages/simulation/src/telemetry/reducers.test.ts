import { describe, expect, it } from 'vitest'
import { createEmptyScenario, createNode } from '@system-design/model'
import { runSimulation } from '../engine'
import { reduceLegacyTraces, reduceNodeMetrics, reduceSpans, reduceSummary, reduceTimeSeries } from './reducers'

const scenario = () => {
  const value = createEmptyScenario('reducers')
  value.seed = 'reducers-seed'
  value.simulation.durationSeconds = 2
  value.nodes = [createNode('traffic', 'traffic', { x: 0, y: 0 }, 'load'), createNode('service', 'service', { x: 100, y: 0 })]
  value.edges = [{ id: 'edge', source: 'traffic', target: 'service', sourcePort: 'out', targetPort: 'in', weight: 1 }]
  value.workloads = [{ id: 'load', name: 'Load', sourceNodeId: 'traffic', requestsPerSecond: 10, startAtSeconds: 0, durationSeconds: 1, pattern: 'constant', requestBytes: 100 }]
  return value
}

describe('event reducers', () => {
  it('reconstructs every displayed result from the canonical event log', async () => {
    const input = scenario()
    const result = await runSimulation(input, 'reducer-run')
    const names = new Map(input.nodes.map((node) => [node.id, node.name]))
    expect(reduceSummary(result.events, input.simulation.durationSeconds)).toEqual(result.summary)
    expect(reduceNodeMetrics(result.events, input.nodes)).toEqual(result.nodes)
    expect(reduceTimeSeries(result.events, input)).toEqual(result.timeSeries)
    expect(reduceSpans(result.events)).toEqual(result.spans)
    expect(reduceLegacyTraces(result.events, names, input.simulation.traceLimit)).toEqual(result.traces)
  })

  it('emits monotonically ordered events and parent-child spans', async () => {
    const result = await runSimulation(scenario(), 'ordered-run')
    expect(result.events.every((event, index) => event.sequence === index)).toBe(true)
    expect(result.events.every((event, index, events) => index === 0 || event.timestampMs >= events[index - 1]!.timestampMs)).toBe(true)
    expect(result.spans.some((span) => span.parentSpanId)).toBe(true)
  })

  it('counts pre-service rejection once in node failures', async () => {
    const input = scenario()
    const service = input.nodes.find((node) => node.type === 'service')!
    if (service.type === 'service') Object.assign(service.config, { replicas: 1, concurrencyPerReplica: 1, serviceTimeMs: 1_000, jitterMs: 0, maxQueueSize: 0 })
    input.workloads[0]!.requestsPerSecond = 50
    const result = await runSimulation(input, 'rejected-metrics')
    const failures = new Set(result.events.filter((event) => event.nodeId === 'service' && event.type === 'request-failed' && event.attributes.terminal !== true).map((event) => `${event.requestId}:${event.spanId}:${event.nodeId}`))
    expect(result.nodes.find((node) => node.nodeId === 'service')?.failedRequests).toBe(failures.size)
    expect(failures.size).toBeGreaterThan(0)
  })

  it('derives generic domain details only from node snapshot events', () => {
    const nodes = [createNode('cache', 'cache', { x: 0, y: 0 })]
    const events = [{
      runId: 'run', timestampMs: 1, sequence: 0, attempt: 1, nodeId: 'cache', type: 'node-snapshot' as const, status: 'ok' as const, reason: 'none' as const,
      attributes: { utilization: 0.5, averageQueueLength: 1, maxQueueLength: 2, cacheHitRate: 0.75, cacheOccupancy: 0.25 },
    }]
    expect(reduceNodeMetrics(events, nodes)[0]).toMatchObject({ details: { cacheHitRate: 0.75, cacheOccupancy: 0.25 } })
  })
})
