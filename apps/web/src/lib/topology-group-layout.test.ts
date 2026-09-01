import { describe, expect, it } from 'vitest'
import { createMultiRegionFailoverExample } from './examples'
import { canvasNodeSize } from './canvas-layout'
import { calculateTopologyGroupBounds } from './topology-group-layout'

describe('topology group overlays', () => {
  it('bounds region and zone members while allowing overlapping membership', () => {
    const project = createMultiRegionFailoverExample()
    const groups = calculateTopologyGroupBounds(project)
    expect(groups.map((group) => [group.name, group.kind, group.memberCount])).toEqual([
      ['Primary region', 'region', 3], ['Standby region', 'region', 2], ['Primary service zone', 'zone', 2],
    ])
    groups.forEach((group) => {
      const memberIds = project.topology.groups.find((candidate) => candidate.id === group.id)!.nodeIds
      project.topology.nodes.filter((node) => memberIds.includes(node.id)).forEach((node) => {
        expect(node.position.x).toBeGreaterThanOrEqual(group.x)
        expect(node.position.y).toBeGreaterThanOrEqual(group.y)
        expect(node.position.x + canvasNodeSize.width).toBeLessThanOrEqual(group.x + group.width)
        expect(node.position.y + canvasNodeSize.height).toBeLessThanOrEqual(group.y + group.height)
      })
    })
  })
})
