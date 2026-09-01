import type { ProjectFile } from '@system-design/model'
import type { ElkNode } from 'elkjs/lib/elk-api'

export const canvasNodeSize = { width: 198, height: 76 } as const
export interface CanvasNodeDimensions { width: number; height: number }
export type CanvasNodeDimensionsMap = ReadonlyMap<string, CanvasNodeDimensions>
export const dimensionsForNode = (nodeId: string, dimensions?: CanvasNodeDimensionsMap): CanvasNodeDimensions => dimensions?.get(nodeId) ?? canvasNodeSize

const grid = 8
const horizontalPadding = 48
const verticalPadding = 88
const rowGap = 32
const columnGap = 32
const layerGap = 72
const laneGap = 72
const snap = (value: number) => Math.round(value / grid) * grid

interface LayoutNode { id: string; x: number; y: number; width: number; height: number }

const layoutNodes = (project: ProjectFile, dimensions?: CanvasNodeDimensionsMap): LayoutNode[] => project.topology.nodes.map((node) => ({
  id: node.id, x: node.position.x, y: node.position.y, ...dimensionsForNode(node.id, dimensions),
}))

const overlaps = (left: LayoutNode, right: LayoutNode) => left.x < right.x + right.width && left.x + left.width > right.x
  && left.y < right.y + right.height && left.y + left.height > right.y

const hasUsableExistingLayout = (nodes: LayoutNode[]) => {
  if (nodes.length < 2) return true
  const distinctPositions = new Set(nodes.map((node) => `${node.x}:${node.y}`))
  if (distinctPositions.size < nodes.length) return false
  for (let left = 0; left < nodes.length; left += 1) {
    for (let right = left + 1; right < nodes.length; right += 1) if (overlaps(nodes[left]!, nodes[right]!)) return false
  }
  return true
}

const clusterRows = (nodes: LayoutNode[]) => {
  const rowThreshold = Math.max(28, Math.min(56, nodes.reduce((sum, node) => sum + node.height, 0) / Math.max(1, nodes.length) * 0.55))
  const rows: Array<{ sourceY: number; nodes: LayoutNode[] }> = []
  for (const node of [...nodes].sort((left, right) => left.y - right.y || left.x - right.x)) {
    const row = rows.find((candidate) => Math.abs(candidate.sourceY - node.y) <= rowThreshold)
    if (row) {
      row.nodes.push(node)
      row.sourceY = row.nodes.reduce((sum, member) => sum + member.y, 0) / row.nodes.length
    } else rows.push({ sourceY: node.y, nodes: [node] })
  }
  return rows.sort((left, right) => left.sourceY - right.sourceY)
}

const compactAnchors = (values: number[]) => {
  const source = [...new Set(values.map(snap))].sort((left, right) => left - right)
  const mapped = new Map<number, number>()
  source.forEach((value, index) => {
    if (index === 0) mapped.set(value, horizontalPadding)
    else {
      const previous = source[index - 1]!
      const previousMapped = mapped.get(previous)!
      mapped.set(value, previousMapped + Math.min(320, Math.max(grid, value - previous)))
    }
  })
  return mapped
}

const tidyExistingLayout = (nodes: LayoutNode[]) => {
  const rows = clusterRows(nodes)
  const xAnchors = compactAnchors(nodes.map((node) => node.x))
  const positions: Record<string, { x: number; y: number }> = {}
  let rowY = verticalPadding
  let previousSourceY = rows[0]?.sourceY ?? 0
  let previousHeight = 0
  rows.forEach((row, rowIndex) => {
    const rowHeight = Math.max(...row.nodes.map((node) => node.height))
    if (rowIndex > 0) {
      const naturalGap = snap(row.sourceY - previousSourceY)
      rowY += Math.max(previousHeight + rowGap, Math.min(previousHeight + 120, naturalGap))
    }
    let previousRight = Number.NEGATIVE_INFINITY
    row.nodes.sort((left, right) => left.x - right.x).forEach((node) => {
      const anchored = xAnchors.get(snap(node.x)) ?? horizontalPadding
      const x = Math.max(anchored, previousRight + columnGap)
      positions[node.id] = { x, y: rowY }
      previousRight = x + node.width
    })
    previousSourceY = row.sourceY
    previousHeight = rowHeight
  })
  return positions
}

const graphDistances = (rootId: string, outgoing: ReadonlyMap<string, string[]>) => {
  const distances = new Map([[rootId, 0]])
  const queue = [rootId]
  while (queue.length > 0) {
    const source = queue.shift()!
    for (const target of outgoing.get(source) ?? []) {
      if (distances.has(target)) continue
      distances.set(target, distances.get(source)! + 1)
      queue.push(target)
    }
  }
  return distances
}

const automaticLayout = async (project: ProjectFile, nodes: LayoutNode[]) => {
  const { default: ELK } = await import('elkjs/lib/elk.bundled.js')
  const elk = new ELK()
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const outgoing = new Map(nodes.map((node) => [node.id, [] as string[]]))
  const incoming = new Map(nodes.map((node) => [node.id, 0]))
  project.topology.edges.forEach((edge) => {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) return
    outgoing.get(edge.source)!.push(edge.target)
    incoming.set(edge.target, incoming.get(edge.target)! + 1)
  })
  const regionIndexByNode = new Map<string, number>()
  project.topology.groups.filter((group) => group.kind === 'region').forEach((group, regionIndex) => group.nodeIds.forEach((nodeId) => {
    if (!regionIndexByNode.has(nodeId)) regionIndexByNode.set(nodeId, regionIndex)
  }))
  const rootIds = new Set(project.topology.nodes.filter((node) => node.type === 'traffic' || node.type === 'scheduler').map((node) => node.id))
  nodes.filter((node) => incoming.get(node.id) === 0).forEach((node) => rootIds.add(node.id))
  if (rootIds.size === 0 && nodes[0]) rootIds.add(nodes[0].id)
  let roots = [...rootIds].map((id) => nodeById.get(id)!).filter(Boolean)
  const distancesByRoot = new Map(roots.map((root) => [root.id, graphDistances(root.id, outgoing)]))
  const covered = new Set([...distancesByRoot.values()].flatMap((distances) => [...distances.keys()]))
  for (const node of [...nodes].sort((left, right) => left.y - right.y || left.x - right.x)) {
    if (covered.has(node.id)) continue
    roots.push(node)
    const distances = graphDistances(node.id, outgoing)
    distancesByRoot.set(node.id, distances)
    distances.forEach((_, id) => covered.add(id))
  }
  roots = roots.sort((left, right) => (regionIndexByNode.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (regionIndexByNode.get(right.id) ?? Number.MAX_SAFE_INTEGER) || left.y - right.y || left.x - right.x || left.id.localeCompare(right.id))
  const rootOrder = new Map(roots.map((root, index) => [root.id, index]))
  const rankByNode = new Map<string, number>()
  const laneByNode = new Map<string, string>()
  const sharedRootsByNode = new Map<string, string[]>()
  for (const node of nodes) {
    const candidates = roots.flatMap((root) => {
      const distance = distancesByRoot.get(root.id)?.get(node.id)
      return distance === undefined ? [] : [{ root, distance }]
    })
    const maximumDistance = Math.max(...candidates.map((candidate) => candidate.distance))
    rankByNode.set(node.id, Number.isFinite(maximumDistance) ? maximumDistance : 0)
  }
  const occupiedSlots = new Set<string>()
  for (const node of [...nodes].sort((left, right) => rankByNode.get(left.id)! - rankByNode.get(right.id)! || left.y - right.y || left.x - right.x)) {
    const candidates = roots.flatMap((root) => {
      const distance = distancesByRoot.get(root.id)?.get(node.id)
      return distance === undefined ? [] : [{ root, distance }]
    })
    const rank = rankByNode.get(node.id) ?? 0
    const projectNode = project.topology.nodes.find((candidate) => candidate.id === node.id)
    if (rootIds.has(node.id)) {
      laneByNode.set(node.id, node.id)
      occupiedSlots.add(`${node.id}:${rank}`)
      continue
    }
    if ((projectNode?.type === 'load-balancer' || projectNode?.type === 'global-router') && candidates.length > 1) {
      sharedRootsByNode.set(node.id, candidates.map((candidate) => candidate.root.id))
      continue
    }
    const nodeRegion = regionIndexByNode.get(node.id)
    const deepestCandidates = candidates.filter((candidate) => candidate.distance === rank)
    const laneCandidates = deepestCandidates.length > 0 ? deepestCandidates : candidates
    laneCandidates.sort((left, right) => {
      const leftOccupied = occupiedSlots.has(`${left.root.id}:${rank}`) ? 1 : 0
      const rightOccupied = occupiedSlots.has(`${right.root.id}:${rank}`) ? 1 : 0
      const leftSameRegion = nodeRegion !== undefined && regionIndexByNode.get(left.root.id) === nodeRegion ? 0 : 1
      const rightSameRegion = nodeRegion !== undefined && regionIndexByNode.get(right.root.id) === nodeRegion ? 0 : 1
      return leftOccupied - rightOccupied || leftSameRegion - rightSameRegion
        || Math.abs(left.root.y - node.y) - Math.abs(right.root.y - node.y) || rootOrder.get(left.root.id)! - rootOrder.get(right.root.id)!
    })
    const laneId = laneCandidates[0]?.root.id ?? roots[0]!.id
    laneByNode.set(node.id, laneId)
    occupiedSlots.add(`${laneId}:${rank}`)
  }
  const maximumRank = Math.max(0, ...rankByNode.values())
  const columnWidths = Array.from({ length: maximumRank + 1 }, (_, rank) => Math.max(...nodes.filter((node) => rankByNode.get(node.id) === rank).map((node) => node.width), canvasNodeSize.width))
  const columnX: number[] = [horizontalPadding]
  for (let rank = 1; rank <= maximumRank; rank += 1) columnX[rank] = columnX[rank - 1]! + columnWidths[rank - 1]! + layerGap
  const positions: Record<string, { x: number; y: number }> = {}
  const laneBounds = new Map<string, { top: number; bottom: number }>()
  let laneTop = verticalPadding
  for (const root of roots) {
    const laneNodes = nodes.filter((node) => laneByNode.get(node.id) === root.id)
    if (laneNodes.length === 0) continue
    const laneIds = new Set(laneNodes.map((node) => node.id))
    const graph: ElkNode = {
      id: `lane:${root.id}`,
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': 'RIGHT',
        'elk.edgeRouting': 'ORTHOGONAL',
        'elk.spacing.nodeNode': `${rowGap}`,
        'elk.layered.spacing.nodeNodeBetweenLayers': `${layerGap}`,
        'elk.layered.crossingMinimization.forceNodeModelOrder': 'true',
        'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
        'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
        'elk.padding': '[top=0,left=0,bottom=0,right=0]',
      },
      children: [...laneNodes].sort((left, right) => left.y - right.y || left.x - right.x).map((node) => ({ id: node.id, width: node.width, height: node.height })),
      edges: project.topology.edges.filter((edge) => laneIds.has(edge.source) && laneIds.has(edge.target)).map((edge) => ({ id: edge.id, sources: [edge.source], targets: [edge.target] })),
    }
    const result = await elk.layout(graph)
    const elkY = new Map((result.children ?? []).map((node) => [node.id, node.y ?? 0]))
    const localY = new Map<string, number>()
    let laneHeight = 0
    for (let rank = 0; rank <= maximumRank; rank += 1) {
      let cursor = 0
      const rankNodes = laneNodes.filter((node) => rankByNode.get(node.id) === rank).sort((left, right) => (elkY.get(left.id) ?? 0) - (elkY.get(right.id) ?? 0) || left.y - right.y || left.id.localeCompare(right.id))
      rankNodes.forEach((node) => {
        const y = Math.max(cursor, snap(elkY.get(node.id) ?? 0))
        localY.set(node.id, y)
        cursor = y + node.height + rowGap
        laneHeight = Math.max(laneHeight, y + node.height)
      })
    }
    laneNodes.forEach((node) => { positions[node.id] = { x: columnX[rankByNode.get(node.id) ?? 0]!, y: laneTop + (localY.get(node.id) ?? 0) } })
    laneBounds.set(root.id, { top: laneTop, bottom: laneTop + laneHeight })
    laneTop += laneHeight + laneGap
  }
  for (const [nodeId, sharedRootIds] of sharedRootsByNode) {
    const node = nodeById.get(nodeId)!
    const bounds = sharedRootIds.map((rootId) => laneBounds.get(rootId)).filter((bound): bound is NonNullable<typeof bound> => bound !== undefined)
    const center = bounds.length > 0 ? bounds.reduce((sum, bound) => sum + (bound.top + bound.bottom) / 2, 0) / bounds.length : verticalPadding
    positions[node.id] = { x: columnX[rankByNode.get(node.id) ?? 0]!, y: snap(center - node.height / 2) }
  }
  return positions
}

export async function layoutTopology(project: ProjectFile, dimensions?: CanvasNodeDimensionsMap, mode: 'auto' | 'tidy' = 'auto'): Promise<Record<string, { x: number; y: number }>> {
  if (project.topology.nodes.length === 0) return {}
  const nodes = layoutNodes(project, dimensions)
  return mode === 'tidy' && hasUsableExistingLayout(nodes) ? tidyExistingLayout(nodes) : automaticLayout(project, nodes)
}
