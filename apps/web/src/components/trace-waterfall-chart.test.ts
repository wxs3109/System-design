import { describe, expect, it, vi } from 'vitest'
import { renderTraceWaterfallItem } from './trace-waterfall-renderer'

const api = (values: number[]) => ({
  value: vi.fn((dimension: number) => values[dimension]),
  coord: vi.fn(([x, y]: [number, number]) => [x * 10, y * 24 + 12]),
  size: vi.fn(() => [10, 24]),
})
const colors = { queue: 'queue', service: 'service', failed: 'failed', selected: 'selected', marker: 'marker' }

describe('ECharts trace waterfall renderer', () => {
  it('renders queue and service rectangles on one virtual-time lane', () => {
    const rendered = renderTraceWaterfallItem({ kind: 'span', value: [1, 5, 20, 4, 16], spanId: 'span', label: 'Database', queueDurationMs: 4, serviceDurationMs: 16 }, api([1, 5, 20, 4, 16]), colors, 'span')
    expect(rendered?.type).toBe('group')
    expect(rendered && 'children' in rendered ? rendered.children : []).toEqual([
      expect.objectContaining({ type: 'rect', shape: expect.objectContaining({ x: 50, width: 40 }), style: { fill: 'queue' } }),
      expect.objectContaining({ type: 'rect', shape: expect.objectContaining({ x: 90, width: 160 }), style: expect.objectContaining({ fill: 'service', stroke: 'selected' }) }),
    ])
  })

  it('renders policy and fault markers as timestamp lines', () => {
    const policy = renderTraceWaterfallItem({ kind: 'marker', value: [0, 3, 0, 0, 0], label: 'timeout', markerKind: 'policy' }, api([0, 3]), colors)
    const fault = renderTraceWaterfallItem({ kind: 'marker', value: [0, 4, 0, 0, 0], label: 'outage', markerKind: 'fault' }, api([0, 4]), colors)
    expect(policy && 'style' in policy ? policy.style : undefined).toMatchObject({ stroke: 'marker', lineWidth: 2 })
    expect(fault && 'style' in fault ? fault.style : undefined).toMatchObject({ stroke: 'failed', lineWidth: 2 })
  })
})
