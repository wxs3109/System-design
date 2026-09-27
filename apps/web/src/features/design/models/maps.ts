import { distance, nearby, referenceRouteCost, shortestRoute, type Road, type Route, type SpatialPoint } from '../geography'
import { semanticMessage, type SemanticMessage } from '../../../core/experiments/evidence'
import type { DesignConfig, DesignEvent } from '../model-contracts'

export const cityPoints: readonly SpatialPoint[] = [{ id: 'P1', x: 0.9, y: 0.5 }, { id: 'P2', x: 1.1, y: 0.5 }, { id: 'P3', x: 1.05, y: 0.7 }, { id: 'P4', x: 1.9, y: 1.9 }, { id: 'P5', x: 0.2, y: 0.1 }, { id: 'P6', x: 4.2, y: 2 }]
export const cityRoads: readonly Road[] = [
  { a: 'A', b: 'B', minutes: 2, open: true }, { a: 'B', b: 'C', minutes: 2, open: true }, { a: 'C', b: 'F', minutes: 2, open: true },
  { a: 'A', b: 'D', minutes: 3, open: true }, { a: 'D', b: 'E', minutes: 3, open: true }, { a: 'E', b: 'F', minutes: 3, open: true }, { a: 'B', b: 'E', minutes: 2, open: true },
]
const roadNodeIds = ['A', 'B', 'C', 'D', 'E', 'F']
export function runMaps(config: DesignConfig, commands: readonly string[]) {
  const points = structuredClone(cityPoints) as SpatialPoint[]
  let indexPoints = structuredClone(points); let pointRevision = 1; let indexRevision = 1
  const roads = structuredClone(cityRoads) as Road[]; let roadRevision = 1
  const cache = new Map<string, { route: Route | null; revision: number }>()
  const events: DesignEvent[] = []
  const queries: { radius: number; candidateCount: number; actual: string[]; expected: string[]; indexRevision: number; pointRevision: number }[] = []
  const routes: { cachedRevision: number; roadRevision: number; path: string[] | null; cost: number | null; optimum: number | null; valid: boolean }[] = []
  let nearbyErrors = 0; let candidates = 0; let routeErrors = 0; let routeWork = 0; let cacheHits = 0; let moves = 0; let roadChanges = 0; let unreachable = 0
  let radius = 0.3; let selected: string[] = []; let lastRoute: Route | null = null
  const observedPoints = new Set<number>(); const observedRoads = new Set<number>()
  let queriedPointRevision = 0; let queriedRoadRevision = 0
  const queryCenter = { x: 0.95, y: 0.5 }
  for (const [i, command] of commands.entries()) {
    let messages: SemanticMessage[] = []
    if (command === 'nearby' || command === 'nearby-small') {
      radius = command === 'nearby-small' ? 0.2 : 0.3
      observedPoints.add(pointRevision); queriedPointRevision = pointRevision
      const query = { ...queryCenter, radius }
      const source = config.index === 'scan' ? points : indexPoints
      const found = nearby(source, query, config.index!, config.filter === 'distance')
      candidates += found.candidates.length
      selected = found.results.map((p) => p.id)
      // The oracle scans current authoritative points independently of the index.
      const expected = points.filter((p) => distance(p, query) <= radius + 1e-9).map((p) => p.id).sort()
      if (JSON.stringify(selected) !== JSON.stringify(expected)) nearbyErrors++
      queries.push({ radius, candidateCount: found.candidates.length, actual: [...selected], expected, indexRevision, pointRevision })
      messages = [semanticMessage('maps.observation-001', [radius, found.candidates.length, selected, expected])]
    } else if (command === 'move-point') {
      points.find((p) => p.id === 'P2')!.x = 3.1; pointRevision++; moves++
      if (config.updates === 'eager') { indexPoints = structuredClone(points); indexRevision = pointRevision }
      messages = [semanticMessage('maps.observation-002', [pointRevision, indexRevision])]
    } else if (command === 'refresh-index') { indexPoints = structuredClone(points); indexRevision = pointRevision; messages = [semanticMessage('maps.observation-003', [])] }
    else if (command === 'close-road' || command === 'traffic-change' || command === 'isolate-f') {
      if (command === 'close-road') roads.find((r) => r.a === 'B' && r.b === 'C')!.open = false
      if (command === 'traffic-change') roads.find((r) => r.a === 'B' && r.b === 'E')!.minutes = 10
      if (command === 'isolate-f') roads.filter((r) => r.a === 'F' || r.b === 'F').forEach((r) => { r.open = false })
      roadRevision++; roadChanges++
      messages = [semanticMessage('maps.observation-004', [roadRevision, command === 'close-road', (!(command === 'close-road')) ? (command === 'traffic-change') : null])]
    } else if (command === 'route') {
      observedRoads.add(roadRevision); queriedRoadRevision = roadRevision
      const key = `A:F${config.routeCache === 'versioned' ? `:${roadRevision}` : ''}`
      const cached = config.routeCache === 'none' ? undefined : cache.get(key)
      const observed = cached ?? { route: shortestRoute(roadNodeIds, roads, 'A', 'F'), revision: roadRevision }
      if (cached) cacheHits++; else { routeWork += observed.route?.examined ?? roads.length; if (config.routeCache !== 'none') cache.set(key, observed) }
      lastRoute = observed.route
      const best = referenceRouteCost(roads, 'A', 'F')
      let actual = 0; let valid = !lastRoute ? best === Infinity : lastRoute.path[0] === 'A' && lastRoute.path.at(-1) === 'F'
      if (lastRoute) for (let j = 1; j < lastRoute.path.length; j++) { const road = roads.find((r) => (r.a === lastRoute!.path[j - 1] && r.b === lastRoute!.path[j]) || (r.b === lastRoute!.path[j - 1] && r.a === lastRoute!.path[j])); if (!road?.open) valid = false; else actual += road.minutes }
      valid &&= !lastRoute || (actual === best && lastRoute.minutes === actual)
      if (!valid) routeErrors++
      if (best === Infinity && !lastRoute) unreachable++
      routes.push({ cachedRevision: observed.revision, roadRevision, path: lastRoute?.path ?? null, cost: lastRoute?.minutes ?? null, optimum: best === Infinity ? null : best, valid })
      messages = [semanticMessage('maps.observation-005', [observed.revision, (lastRoute?.path.join(' → ')) != null, ((lastRoute?.path.join(' → ')) != null) ? (lastRoute?.path) : null, roadRevision, best === Infinity, (!(best === Infinity)) ? (best) : null])]
    } else throw new Error(`Unknown maps action: ${command}`)
    events.push({ step: i + 1, action: command, messages })
  }
  return { modelVersion: 'maps-v1' as const, events, metrics: { nearbyQueries: queries.length, nearbyErrors, candidates, routeQueries: routes.length, routeErrors, routeWork, cacheHits, moves, roadChanges, unreachable, pointVersionsTested: observedPoints.size, roadVersionsTested: observedRoads.size, queriedPointRevision, queriedRoadRevision, pointRevision, roadRevision, indexLag: pointRevision - indexRevision }, state: { points, indexPoints, roads, radius, selected, lastRoute, queries, routes, cache: [...cache.entries()] } }
}
