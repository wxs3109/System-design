import { distance, nearby, referenceRouteCost, shortestRoute, type Road, type Route, type SpatialPoint } from './geography'
import { check, choice, type DesignConfig, type DesignEvent, type ProductDesign, type ProductResult } from './product-types'

export const cityPoints: readonly SpatialPoint[] = [{ id: 'P1', x: 0.9, y: 0.5 }, { id: 'P2', x: 1.1, y: 0.5 }, { id: 'P3', x: 1.05, y: 0.7 }, { id: 'P4', x: 1.9, y: 1.9 }, { id: 'P5', x: 0.2, y: 0.1 }, { id: 'P6', x: 4.2, y: 2 }]
export const cityRoads: readonly Road[] = [
  { a: 'A', b: 'B', minutes: 2, open: true }, { a: 'B', b: 'C', minutes: 2, open: true }, { a: 'C', b: 'F', minutes: 2, open: true },
  { a: 'A', b: 'D', minutes: 3, open: true }, { a: 'D', b: 'E', minutes: 3, open: true }, { a: 'E', b: 'F', minutes: 3, open: true }, { a: 'B', b: 'E', minutes: 2, open: true },
]
const roadNodes = [{ id: 'A', x: 80, y: 70 }, { id: 'B', x: 270, y: 70 }, { id: 'C', x: 460, y: 70 }, { id: 'D', x: 80, y: 235 }, { id: 'E', x: 270, y: 235 }, { id: 'F', x: 460, y: 235 }]
export function runMaps(config: DesignConfig, commands: readonly string[]): ProductResult {
  const points = structuredClone(cityPoints) as SpatialPoint[]
  let indexPoints = structuredClone(points); let pointRevision = 1; let indexRevision = 1
  const roads = structuredClone(cityRoads) as Road[]; let roadRevision = 1
  const cache = new Map<string, { route: Route | null; revision: number }>()
  const events: DesignEvent[] = []; const queries: (string | number)[][] = []; const routes: (string | number)[][] = []
  let nearbyErrors = 0; let candidates = 0; let routeErrors = 0; let routeWork = 0; let cacheHits = 0; let moves = 0; let roadChanges = 0; let unreachable = 0
  let radius = 0.3; let selected: string[] = []; let lastRoute: Route | null = null
  const observedPoints = new Set<number>(); const observedRoads = new Set<number>()
  let queriedPointRevision = 0; let queriedRoadRevision = 0
  const queryCenter = { x: 0.95, y: 0.5 }
  for (const [i, command] of commands.entries()) {
    let detail = ''
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
      queries.push([radius, found.candidates.length, selected.join(', ') || '空', expected.join(', ') || '空', `${indexRevision}/${pointRevision}`])
      detail = `半径 ${radius}：检查 ${found.candidates.length} 个候选，返回 [${selected.join(', ')}]；当前全扫描答案 [${expected.join(', ')}]。`
    } else if (command === 'move-point') {
      points.find((p) => p.id === 'P2')!.x = 3.1; pointRevision++; moves++
      if (config.updates === 'eager') { indexPoints = structuredClone(points); indexRevision = pointRevision }
      detail = `P2 移动到 (3.1, 0.5)；权威位置 v${pointRevision}，索引 v${indexRevision}。`
    } else if (command === 'refresh-index') { indexPoints = structuredClone(points); indexRevision = pointRevision; detail = '读取真实新位置更新索引。' }
    else if (command === 'close-road' || command === 'traffic-change' || command === 'isolate-f') {
      if (command === 'close-road') roads.find((r) => r.a === 'B' && r.b === 'C')!.open = false
      if (command === 'traffic-change') roads.find((r) => r.a === 'B' && r.b === 'E')!.minutes = 10
      if (command === 'isolate-f') roads.filter((r) => r.a === 'F' || r.b === 'F').forEach((r) => { r.open = false })
      roadRevision++; roadChanges++
      detail = `道路数据更新到 v${roadRevision}；${command === 'close-road' ? 'B–C 关闭' : command === 'traffic-change' ? 'B–E 耗时变为 10' : 'F 的全部入口关闭'}。`
    } else if (command === 'route') {
      observedRoads.add(roadRevision); queriedRoadRevision = roadRevision
      const key = `A:F${config.routeCache === 'versioned' ? `:${roadRevision}` : ''}`
      const cached = config.routeCache === 'none' ? undefined : cache.get(key)
      const observed = cached ?? { route: shortestRoute(roadNodes.map((n) => n.id), roads, 'A', 'F'), revision: roadRevision }
      if (cached) cacheHits++; else { routeWork += observed.route?.examined ?? roads.length; if (config.routeCache !== 'none') cache.set(key, observed) }
      lastRoute = observed.route
      const best = referenceRouteCost(roads, 'A', 'F')
      let actual = 0; let valid = !lastRoute ? best === Infinity : lastRoute.path[0] === 'A' && lastRoute.path.at(-1) === 'F'
      if (lastRoute) for (let j = 1; j < lastRoute.path.length; j++) { const road = roads.find((r) => (r.a === lastRoute!.path[j - 1] && r.b === lastRoute!.path[j]) || (r.b === lastRoute!.path[j - 1] && r.a === lastRoute!.path[j])); if (!road?.open) valid = false; else actual += road.minutes }
      valid &&= !lastRoute || (actual === best && lastRoute.minutes === actual)
      if (!valid) routeErrors++
      if (best === Infinity && !lastRoute) unreachable++
      routes.push([observed.revision, roadRevision, lastRoute?.path.join(' → ') ?? '不可达', lastRoute?.minutes ?? '—', best === Infinity ? '不可达' : best, valid ? '正确' : '无效或非最优'])
      detail = `使用 v${observed.revision} 路线：${lastRoute?.path.join(' → ') ?? '不可达'}；当前 v${roadRevision} 的独立枚举最优代价为 ${best === Infinity ? '不可达' : best}。`
    } else throw new Error(`Unknown maps action: ${command}`)
    events.push({ step: i + 1, action: command, detail })
  }
  return { events, metrics: { nearbyQueries: queries.length, nearbyErrors, candidates, routeQueries: routes.length, routeErrors, routeWork, cacheHits, moves, roadChanges, unreachable, pointVersionsTested: observedPoints.size, roadVersionsTested: observedRoads.size, queriedPointRevision, queriedRoadRevision, pointRevision, roadRevision, indexLag: pointRevision - indexRevision }, tables: [
    { title: '空间点与索引', columns: ['ID', '当前坐标', '索引坐标'], rows: points.map((p) => { const old = indexPoints.find((n) => n.id === p.id)!; return [p.id, `${p.x}, ${p.y}`, `${old.x}, ${old.y}`] }) },
    { title: '附近查询证据', columns: ['半径', '候选数', '实际结果', '全扫描对照', '索引/数据版本'], rows: queries },
    { title: '路线与独立对照', columns: ['缓存版本', '道路版本', '返回路线', '返回代价', '最优代价', '核对'], rows: routes },
  ], diagrams: [
    { title: '局部平面空间点 · 虚线为查询半径，蓝点为返回结果', nodes: points.map((p) => ({ ...p, label: p.id, x: 40 + p.x * 100, y: 40 + p.y * 100, selected: selected.includes(p.id) })), edges: [], circle: { x: 135, y: 90, radius: radius * 100 }, grid: { spacing: 100, offsetX: 40, offsetY: 40 } },
    { title: '道路图 · 红色虚线表示关闭，蓝线表示返回的路线', nodes: roadNodes.map((n) => ({ ...n, label: n.id })), edges: roads.map((r) => ({ from: r.a, to: r.b, label: r.open ? String(r.minutes) : '关闭', closed: !r.open, selected: !!lastRoute && lastRoute.path.some((node, i) => (node === r.a && lastRoute!.path[i + 1] === r.b) || (node === r.b && lastRoute!.path[i + 1] === r.a)) })) },
  ] }
}
const grid: DesignConfig = { index: 'grid', filter: 'distance', updates: 'eager', routeCache: 'versioned' }
export const mapsDesign: ProductDesign = {
  id: 'design-maps', kind: 'product-design', category: '综合设计', difficulty: '进阶', estimatedMinutes: 40, title: 'Google Maps 类设计：附近查询与路线', summary: '在真实小点集和道路图上检验空间索引、精确距离、更新滞后、路线缓存失效和不可达结果。',
  pains: ['跨网格边界的附近地点会被“只查本格”漏掉；网格候选也不一定在查询半径内。', '地点移动或更新后，旧索引可能继续返回错误位置。', '道路关闭或拥堵变化会让端点相同的旧路线失效，缓存不能只看起终点。'],
  requirements: ['附近查询结果必须与当前小数据集的全扫描精确答案一致。', '比较全扫描、查询覆盖的全部网格、仅本格；同时记录实际候选检查量。', '路线必须使用当前开放道路，返回最小代价；无路可达时明确返回不可达。', '每次查询保留实际结果、索引版本、道路版本和独立对照证据。'],
  contracts: [{ name: 'GET /places/nearby?x&y&radius', description: '本关采用局部二维平面欧氏距离，单位一致；不是经纬度、球面距离或真实地图坐标。' }, { name: 'GET /routes?from=A&to=F', description: '六节点无向图、正边权 Dijkstra；独立枚举简单路径验证最优值。道路版本参与缓存身份。' }, { name: 'Place / SpatialIndex / RoadGraph / RouteCache', description: '空间索引只产生候选；精确距离过滤与道路图寻路是不同职责。' }],
  decisions: ['为什么范围覆盖与精确过滤缺一不可？', '空间索引异步更新时，应给调用方承诺什么新鲜度？', '道路版本作为缓存键会增加什么缓存和失效成本？'],
  boundary: ['6 个空间点、6 个道路节点、7 条无向边、120 步。坐标和道路代价是教学数据，不是 Google Maps 的实际实现。', '没有地图瓦片、地理编码、POI 文本搜索、球面距离、转向限制、交通预测或大图预处理。', '版本化索引更新以单步原子替换为假设；暂缓更新策略故意展示旧索引反例。', '绘图展示业务坐标，不把画布位置或 Region 元数据当成空间索引。'],
  relatedLabs: [{ id: 'cache-pressure', title: '缓存与回源' }, { id: 'replica-consistency', title: '复制与旧读' }, { id: 'hot-key', title: '热点访问' }],
  fields: [{ id: 'index', label: '空间候选策略', options: [choice('cell', '仅查当前网格'), choice('grid', '覆盖查询范围的所有网格'), choice('scan', '扫描全部当前点')] }, { id: 'filter', label: '空间精确过滤', options: [choice('none', '直接返回候选'), choice('distance', '按真实距离过滤')] }, { id: 'updates', label: '位置索引更新', options: [choice('deferred', '暂缓更新，手动刷新'), choice('eager', '数据更新时同步索引')] }, { id: 'routeCache', label: '路线缓存', options: [choice('endpoints', '只按起点和终点缓存'), choice('versioned', '起终点 + 道路版本'), choice('none', '每次重新寻路')] }],
  initialConfig: { index: 'cell', filter: 'none', updates: 'deferred', routeCache: 'endpoints' },
  metricLabels: [{ key: 'candidates', label: '实际空间候选检查' }, { key: 'nearbyErrors', label: '错误附近结果' }, { key: 'routeErrors', label: '错误路线结果' }, { key: 'routeWork', label: '寻路检查边次数' }, { key: 'cacheHits', label: '路线缓存命中' }],
  actions: { nearby: '查询半径 0.3 的附近地点', 'nearby-small': '查询半径 0.2 的附近地点', 'move-point': '将 P2 移出查询区域', 'refresh-index': '刷新位置索引', route: '查询 A 到 F 的路线', 'close-road': '关闭 B–C 道路', 'traffic-change': '将 B–E 耗时增至 10', 'isolate-f': '关闭 F 的所有入口' },
  scenarios: [
    { id: 'boundary', title: '跨网格与精确过滤', goal: '分别查询两个半径，不能漏掉相邻网格中的地点，也不能返回圆外候选。', script: ['nearby', 'nearby-small'], check: (r) => [check('完成两次附近查询', r.metrics.nearbyQueries! >= 2, `${r.metrics.nearbyQueries} 次查询。`), check('结果逐项匹配', r.metrics.nearbyErrors === 0, `${r.metrics.nearbyErrors} 次结果与精确全扫描不一致。`)] },
    { id: 'movement', title: '位置变更与旧索引', goal: 'P2 移出附近范围后，再次查询不应返回它。', script: ['nearby', 'move-point', 'nearby'], check: (r) => [check('执行移动与前后查询', r.metrics.moves! > 0 && r.metrics.pointVersionsTested! >= 2 && r.metrics.queriedPointRevision === r.metrics.pointRevision, `${r.metrics.moves} 次移动，查询覆盖 ${r.metrics.pointVersionsTested} 个数据版本。`), check('移动后的结果正确', r.metrics.nearbyErrors === 0, `${r.metrics.nearbyErrors} 次错误附近结果；最终索引滞后 ${r.metrics.indexLag} 版。`)] },
    { id: 'roads', title: '关闭道路与拥堵变化', goal: '初始路线、关闭 B–C 后、B–E 变慢后，都要返回当前最优路线。', script: ['route', 'close-road', 'route', 'traffic-change', 'route'], check: (r) => [check('覆盖两次道路变化', r.metrics.roadChanges! >= 2 && r.metrics.roadVersionsTested! >= 3 && r.metrics.queriedRoadRevision === r.metrics.roadRevision, `${r.metrics.roadChanges} 次变化，查询覆盖 ${r.metrics.roadVersionsTested} 个道路版本。`), check('路线开放且最优', r.metrics.routeErrors === 0, `${r.metrics.routeErrors} 条无效或非最优路线。`)] },
    { id: 'unreachable', title: '无路可达', goal: '预热一条路线后隔离 F，不能继续返回旧缓存路线。', script: ['route', 'isolate-f', 'route'], check: (r) => [check('明确返回不可达', r.metrics.unreachable! > 0 && r.metrics.roadChanges! > 0, `${r.metrics.unreachable} 次正确不可达结果。`), check('没有虚假的成功路线', r.metrics.routeErrors === 0, `${r.metrics.routeErrors} 次错误路线。`)] },
  ],
  alternatives: [{ title: '网格精筛 + 版本化路线', config: grid }, { title: '全扫描 + 每次寻路', config: { ...grid, index: 'scan', routeCache: 'none' } }],
  architecture: (c) => [`Nearby API → ${c.index === 'scan' ? '当前点集全扫描' : '空间网格候选'} → ${c.filter === 'distance' ? '距离过滤' : '直接返回'}`, `更新流 → 地点与道路版本 → ${c.updates === 'eager' ? '同步刷新索引' : '等待索引刷新'}`, `Route API → ${c.routeCache === 'none' ? 'Dijkstra' : '路线缓存 / Dijkstra'} → 返回路径或不可达`],
  run: runMaps,
}
