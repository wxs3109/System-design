import type { ProjectFile } from '@system-design/model'
import type { ElkNode } from 'elkjs/lib/elk-api'

export const canvasNodeSize = { width: 198, height: 76 } as const

export async function layoutTopology(project: ProjectFile): Promise<Record<string, { x: number; y: number }>> {
  if (project.topology.nodes.length === 0) return {}
  const { default: ELK } = await import('elkjs/lib/elk.bundled.js')
  const elk = new ELK()
  const graph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.spacing.nodeNode': '72',
      'elk.layered.spacing.nodeNodeBetweenLayers': '118',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.padding': '[top=80,left=48,bottom=48,right=48]',
    },
    children: project.topology.nodes.map((node) => ({ id: node.id, ...canvasNodeSize })),
    edges: project.topology.edges.map((edge) => ({ id: edge.id, sources: [edge.source], targets: [edge.target] })),
  }
  const result = await elk.layout(graph)
  return Object.fromEntries((result.children ?? []).map((node) => [node.id, { x: node.x ?? 0, y: node.y ?? 0 }]))
}
