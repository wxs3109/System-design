import { describe, expect, it } from 'vitest'
import type { Fault } from '@system-design/model'
import { applyCapacityFaults, applyLatencyFaults, composeLossProbability, resolveActiveFaults } from './resolver'

const fault = (id: string, type: Fault['type'], factor: number): Fault => ({
  id, type, target: { kind: 'node', id: 'service' }, startAtSeconds: 1, durationSeconds: 2, factor, enabled: true,
})

describe('deterministic fault resolution', () => {
  it('uses half-open intervals and ignores disabled faults', () => {
    const active = fault('active', 'capacity-drop', 0.5)
    const disabled = { ...fault('disabled', 'capacity-drop', 0.5), enabled: false }
    expect(resolveActiveFaults([active, disabled], 'node', 'service', 'capacity-drop', 999)).toEqual([])
    expect(resolveActiveFaults([active, disabled], 'node', 'service', 'capacity-drop', 1_000)).toEqual([active])
    expect(resolveActiveFaults([active, disabled], 'node', 'service', 'capacity-drop', 2_999)).toEqual([active])
    expect(resolveActiveFaults([active, disabled], 'node', 'service', 'capacity-drop', 3_000)).toEqual([])
  })

  it('composes multipliers and independent loss probabilities', () => {
    expect(applyCapacityFaults(100, [fault('a', 'capacity-drop', 0.5), fault('b', 'capacity-drop', 0.5)])).toBe(25)
    expect(applyLatencyFaults(10, [fault('a', 'latency-spike', 2), fault('b', 'latency-spike', 3)])).toBe(60)
    expect(composeLossProbability([fault('a', 'packet-loss', 0.2), fault('b', 'packet-loss', 0.5)])).toBeCloseTo(0.6)
  })
})
