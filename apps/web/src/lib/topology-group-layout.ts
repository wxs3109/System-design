import type { ProjectFile, TopologyGroup } from '@system-design/model'
import { dimensionsForNode, type CanvasNodeDimensionsMap } from './canvas-layout'

export interface TopologyGroupBounds {
  id: string
  name: string
  kind: TopologyGroup['kind']
  memberCount: number
  x: number
  y: number
  width: number
  height: number
}

export function calculateTopologyGroupBounds(project: ProjectFile, dimensions?: CanvasNodeDimensionsMap): TopologyGroupBounds[] {
  const nodes = new Map(project.topology.nodes.map((node) => [node.id, node]))
  return project.topology.groups.flatMap((group) => {
    const members = group.nodeIds.map((id) => nodes.get(id)).filter((node): node is NonNullable<typeof node> => node !== undefined)
    if (members.length === 0) return []
    const minX = Math.min(...members.map((node) => node.position.x))
    const minY = Math.min(...members.map((node) => node.position.y))
    const maxX = Math.max(...members.map((node) => node.position.x + dimensionsForNode(node.id, dimensions).width))
    const maxY = Math.max(...members.map((node) => node.position.y + dimensionsForNode(node.id, dimensions).height))
    const padding = group.kind === 'region' ? { x: 34, top: 50, bottom: 28 } : group.kind === 'zone' ? { x: 22, top: 36, bottom: 18 } : { x: 18, top: 32, bottom: 16 }
    return [{ id: group.id, name: group.name, kind: group.kind, memberCount: members.length, x: minX - padding.x, y: minY - padding.top, width: maxX - minX + padding.x * 2, height: maxY - minY + padding.top + padding.bottom }]
  })
}
