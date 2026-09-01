import type { ProjectFile } from '@system-design/model'
import type { CanvasNodeDimensionsMap } from '../lib/canvas-layout'
import { calculateTopologyGroupBounds } from '../lib/topology-group-layout'

export function TopologyGroupOverlay({ project, dimensions }: { project: ProjectFile; dimensions?: CanvasNodeDimensionsMap }) {
  const groups = calculateTopologyGroupBounds(project, dimensions)
  return <div className="topology-group-overlay" aria-label="Topology groups">{groups.map((group) => <section key={group.id} className={`topology-group-boundary topology-group-boundary--${group.kind}`} data-group-id={group.id}
    style={{ transform: `translate(${group.x}px, ${group.y}px)`, width: group.width, height: group.height }}>
    <header><span>{group.kind}</span><strong>{group.name}</strong><small>{group.memberCount}</small></header>
  </section>)}</div>
}
