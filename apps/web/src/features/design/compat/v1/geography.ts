export interface SpatialPoint { id: string; x: number; y: number }
export interface SpatialQuery { x: number; y: number; radius: number }
export const distance = (a: Pick<SpatialPoint, 'x' | 'y'>, b: Pick<SpatialPoint, 'x' | 'y'>) => Math.hypot(a.x - b.x, a.y - b.y)
export function nearby(points: readonly SpatialPoint[], query: SpatialQuery, mode: string, exact: boolean) {
  const candidates = points.filter((p) => mode === 'scan' || (mode === 'cell'
    ? Math.floor(p.x) === Math.floor(query.x) && Math.floor(p.y) === Math.floor(query.y)
    : Math.floor(p.x) >= Math.floor(query.x - query.radius) && Math.floor(p.x) <= Math.floor(query.x + query.radius) && Math.floor(p.y) >= Math.floor(query.y - query.radius) && Math.floor(p.y) <= Math.floor(query.y + query.radius)))
  const results = (exact ? candidates.filter((p) => distance(p, query) <= query.radius + 1e-9) : candidates).slice().sort((a, b) => a.id.localeCompare(b.id))
  return { candidates, results }
}
export interface Road { a: string; b: string; minutes: number; open: boolean }
export interface Route { path: string[]; minutes: number; examined: number }
export function shortestRoute(nodes: readonly string[], roads: readonly Road[], start: string, goal: string): Route | null {
  const costs = new Map(nodes.map((n) => [n, n === start ? 0 : Infinity]))
  const previous = new Map<string, string>(); const remaining = new Set(nodes); let examined = 0
  while (remaining.size) {
    const current = [...remaining].sort((a, b) => costs.get(a)! - costs.get(b)! || a.localeCompare(b))[0]!
    if (costs.get(current) === Infinity) break
    remaining.delete(current)
    if (current === goal) {
      const path = [goal]; while (previous.has(path[0]!)) path.unshift(previous.get(path[0]!)!)
      return { path, minutes: costs.get(goal)!, examined }
    }
    for (const road of roads.filter((r) => r.open && (r.a === current || r.b === current))) {
      examined++
      const target = road.a === current ? road.b : road.a
      const candidate = costs.get(current)! + road.minutes
      if (candidate < costs.get(target)!) { costs.set(target, candidate); previous.set(target, current) }
    }
  }
  return null
}
/** Independent finite oracle: enumerate simple paths, not the learner's Dijkstra/cache path. */
export function referenceRouteCost(roads: readonly Road[], start: string, goal: string): number {
  let best = Infinity
  const visit = (node: string, seen: Set<string>, cost: number) => {
    if (node === goal) { best = Math.min(best, cost); return }
    for (const road of roads.filter((r) => r.open && (r.a === node || r.b === node))) {
      const next = road.a === node ? road.b : road.a
      if (!seen.has(next)) visit(next, new Set([...seen, next]), cost + road.minutes)
    }
  }
  visit(start, new Set([start]), 0); return best
}
