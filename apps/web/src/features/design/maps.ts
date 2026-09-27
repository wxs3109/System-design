import { check, choice, type DesignConfig, type ProductDesign } from './product-types'
import { runMaps } from './models/maps'
import { presentMaps } from './presentation/maps'
export { runMaps } from './models/maps'
export { cityPoints, cityRoads } from './models/maps'

const grid: DesignConfig = { index: 'grid', filter: 'distance', updates: 'eager', routeCache: 'versioned' }
export const mapsDesign: ProductDesign = {
  versions: { model: 'maps-v1', definition: 1, assessment: 1 },
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
  present: (result) => presentMaps(result as ReturnType<typeof runMaps>),
}
