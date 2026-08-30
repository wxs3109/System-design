import { describe, expect, it } from 'vitest'
import type { RuntimeEvent } from '@system-design/model'
import { runtimeFaultWindows } from './fault-windows'

const event = (sequence: number, type: 'fault-activated' | 'fault-recovered', timestampMs: number, faultId: string): RuntimeEvent => ({
  runId: 'run', sequence, timestampMs, type, status: type === 'fault-activated' ? 'error' : 'ok', attempt: 1,
  reason: 'node_down', attributes: { faultId, targetKind: 'node', targetId: 'api' }, nodeId: 'api',
})

describe('runtime fault chart windows', () => {
  it('pairs exact activation and recovery events', () => {
    expect(runtimeFaultWindows([event(0, 'fault-activated', 1_250, 'outage'), event(1, 'fault-recovered', 3_750, 'outage')], 10_000)).toEqual([{
      id: 'outage', startSeconds: 1.25, endSeconds: 3.75, reason: 'node_down', target: 'api',
    }])
  })

  it('extends an unrecovered active fault only to the simulated boundary', () => {
    expect(runtimeFaultWindows([event(0, 'fault-activated', 8_000, 'outage')], 10_000)[0]).toMatchObject({ startSeconds: 8, endSeconds: 10 })
  })

  it('keeps expanded region members as independent runtime windows', () => {
    const activatedNode = { ...event(0, 'fault-activated', 1_000, 'region'), attributes: { faultId: 'region', executionFaultId: 'region:node:0', targetKind: 'node', targetId: 'api' } }
    const activatedEdge = { ...event(1, 'fault-activated', 1_000, 'region'), nodeId: undefined, edgeId: 'link', attributes: { faultId: 'region', executionFaultId: 'region:edge:0', targetKind: 'edge', targetId: 'link' } }
    const recoveredNode = { ...event(2, 'fault-recovered', 2_000, 'region'), attributes: activatedNode.attributes }
    const recoveredEdge = { ...event(3, 'fault-recovered', 2_000, 'region'), nodeId: undefined, edgeId: 'link', attributes: activatedEdge.attributes }
    expect(runtimeFaultWindows([activatedNode, activatedEdge, recoveredNode, recoveredEdge], 5_000)).toHaveLength(2)
  })
})
