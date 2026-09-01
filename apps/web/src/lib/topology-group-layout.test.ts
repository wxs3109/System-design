import { describe, expect, it } from 'vitest'
import { createMultiRegionFailoverExample } from './examples'
import { canvasNodeSize } from './canvas-layout'
import { calculateTopologyGroupBounds } from './topology-group-layout'

describe('topology group overlays', () => {
  it('bounds region and zone members while allowing overlapping membership', () => {
    const project = createMultiRegionFailoverExample()
    const dimensions = new Map(project.topology.nodes.map((node, index) => [node.id, { width: canvasNodeSize.width + index * 3, height: canvasNodeSize.height + index * 11 }]))
    const groups = calculateTopologyGroupBounds(project, dimensions)
    expect(groups.map((group) => [group.name, group.kind, group.memberCount])).toEqual([
      ['Primary region', 'region', 3], ['Standby region', 'region', 2], ['Primary service zone', 'zone', 2],
    ])
    groups.forEach((group) => {
      const memberIds = project.topology.groups.find((candidate) => candidate.id === group.id)!.nodeIds
      project.topology.nodes.filter((node) => memberIds.includes(node.id)).forEach((node) => {
        expect(node.position.x).toBeGreaterThanOrEqual(group.x)
        expect(node.position.y).toBeGreaterThanOrEqual(group.y)
        const size = dimensions.get(node.id)!
        expect(node.position.x + size.width).toBeLessThanOrEqual(group.x + group.width)
        expect(node.position.y + size.height).toBeLessThanOrEqual(group.y + group.height)
      })
    })
  })
})
