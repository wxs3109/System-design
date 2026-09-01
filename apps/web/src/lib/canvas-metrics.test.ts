import { describe, expect, it } from 'vitest'
import type { RuntimeEvent, SimulationResult } from '@system-design/model'
import { buildCanvasMetricProjection, formatCanvasBytes, formatCanvasCount } from './canvas-metrics'

const event = (sequence: number, input: Partial<RuntimeEvent>): RuntimeEvent => ({
  runId: 'run', timestampMs: sequence, sequence, attempt: 1, type: 'dependency-started', status: 'pending', reason: 'none', attributes: {}, ...input,
})

const result = (): SimulationResult => ({
  runId: 'run', scenarioId: 'scenario', seed: 'seed', simulatedDurationMs: 1_000, wallClockDurationMs: 1,
  summary: { generatedRequests: 10, completedRequests: 9, failedRequests: 1, throughputPerSecond: 9, errorRate: 0.1, latencyP50Ms: 1, latencyP95Ms: 2, latencyP99Ms: 3 },
  nodes: [
    { nodeId: 'healthy', nodeName: 'Healthy', nodeType: 'service', processedRequests: 100, failedRequests: 0, utilization: 0.4, averageQueueLength: 0, maxQueueLength: 0, details: {} },
    { nodeId: 'warning', nodeName: 'Warning', nodeType: 'service', processedRequests: 100, failedRequests: 0, utilization: 0.75, averageQueueLength: 1, maxQueueLength: 4, details: {} },
    { nodeId: 'critical', nodeName: 'Critical', nodeType: 'service', processedRequests: 90, failedRequests: 10, utilization: 0.95, averageQueueLength: 4, maxQueueLength: 20, details: {} },
    { nodeId: 'idle', nodeName: 'Idle', nodeType: 'service', processedRequests: 0, failedRequests: 0, utilization: 0, averageQueueLength: 0, maxQueueLength: 0, details: {} },
  ],
  events: [
    event(1, { edgeId: 'edge', traceId: 'trace-1', spanId: 'span-1', requestId: '1', bytes: 1_024 }),
    event(2, { edgeId: 'edge', traceId: 'trace-2', spanId: 'span-2', requestId: '2', bytes: 2_048 }),
    event(3, { edgeId: 'edge', traceId: 'trace-2', spanId: 'span-2', requestId: '2', type: 'dependency-returned', status: 'error', reason: 'timeout' }),
    event(4, { edgeId: 'edge', traceId: 'trace-2', spanId: 'span-2', requestId: '2', type: 'timeout-fired', status: 'error', reason: 'timeout' }),
  ],
  timeSeries: [], traces: [], spans: [], operations: [], actions: [], warnings: [],
})

describe('Canvas metric projection', () => {
  it('projects authoritative node metrics and observed edge events without double-counting failures', () => {
    const projection = buildCanvasMetricProjection(result())
    expect(projection.nodes.get('healthy')?.severity).toBe('healthy')
    expect(projection.nodes.get('warning')?.severity).toBe('warning')
    expect(projection.nodes.get('critical')?.severity).toBe('critical')
    expect(projection.nodes.get('idle')?.severity).toBe('idle')
    expect(projection.edges.get('edge')).toEqual({ observedCalls: 2, observedFailures: 1, observedBytes: 3_072, severity: 'failed' })
  })

  it('formats compact counts and binary byte units', () => {
    expect(formatCanvasCount(1_250)).toBe('1.3k')
    expect(formatCanvasBytes(1_048_576)).toBe('1.0 MB')
  })
})
