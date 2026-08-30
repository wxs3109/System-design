import { describe, expect, it } from 'vitest'
import type { Fault } from '@system-design/model'
import { createDirectExample } from '../lib/examples'
import { affectedTopology, faultTargetName } from './fault-topology'

describe('fault timeline topology integration', () => {
  it('highlights the exact node target', () => {
    const project = createDirectExample()
    const fault: Fault = { id: 'down', type: 'node-down', target: { kind: 'node', id: 'service-direct' }, startAtSeconds: 2, durationSeconds: 4, enabled: true }

    const affected = affectedTopology(fault, project)

    expect([...affected.nodes]).toEqual(['service-direct'])
    expect([...affected.edges]).toEqual([])
    expect(faultTargetName(fault, project)).toBe('Service')
  })

  it('expands a group to members and their incident links', () => {
    const project = createDirectExample()
    project.topology.groups = [{ id: 'west', name: 'West region', kind: 'region', nodeIds: ['service-direct', 'database-direct'] }]
    const fault: Fault = { id: 'region', type: 'region-outage', target: { kind: 'group', id: 'west' }, startAtSeconds: 5, durationSeconds: 10, enabled: true }

    const affected = affectedTopology(fault, project)

    expect([...affected.nodes].sort()).toEqual(['database-direct', 'service-direct'])
    expect([...affected.edges].sort()).toEqual(['edge-direct-2', 'edge-direct-3'])
  })

  it('maps a workload target back to its traffic generator', () => {
    const project = createDirectExample()
    const fault: Fault = { id: 'traffic', type: 'traffic-spike', target: { kind: 'workload', id: 'workload-direct' }, startAtSeconds: 1, durationSeconds: 2, factor: 3, enabled: true }

    expect([...affectedTopology(fault, project).nodes]).toEqual(['traffic-direct'])
    expect(faultTargetName(fault, project)).toBe('Web requests')
  })
})
