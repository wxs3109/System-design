import { distance, nearby, type SpatialPoint } from './geography'
import { check, choice, type DesignConfig, type DesignEvent, type ProductDesign, type ProductResult } from './product-types'

export function runDispatch(config: DesignConfig, commands: readonly string[]): ProductResult {
  interface Driver extends SpatialPoint { observed: SpatialPoint; reportedAt: number; generation: number; claim?: { trip: string; token: number; until: number; confirmed: boolean } }
  interface Offer { driver: string; token: number; until: number; locationAge: number }
  const drivers: Driver[] = [{ id: 'D1', x: 0.95, y: 0.5 }, { id: 'D2', x: 1.2, y: 0.5 }, { id: 'D3', x: 3.4, y: 1.6 }].map((p) => ({ ...p, observed: { ...p }, reportedAt: 0, generation: 0 }))
  const riders: Record<string, SpatialPoint> = { R1: { id: 'R1', x: 0.8, y: 0.6 }, R2: { id: 'R2', x: 0.8, y: 0.4 } }
  const snapshots: Record<string, string[]> = {}; const offers: Record<string, Offer> = {}
  const assignments: { trip: string; driver: string; token: number; step: number }[] = []
  const rejectedTokens: { driver: string; token: number }[] = []
  const events: DesignEvent[] = []; const lookups: (string | number)[][] = []
  let now = 0; let claims = 0; let conflicts = 0; let staleRejected = 0; let staleAccepted = 0; let duplicateReplies = 0; let expirations = 0; let confirmations = 0; let moves = 0; let outOfRange = 0
  let lastMoveStep = 0; let overlappingSnapshots = 0
  const freshness = config.freshness === 'ignore' ? Infinity : Number(config.freshness)
  const available = (driver: Driver) => !driver.claim || (!driver.claim.confirmed && now >= driver.claim.until)
  for (const [index, command] of commands.entries()) {
    let detail = ''
    if (command === 'tick' || command === 'tick-half') {
      const elapsed = command === 'tick' ? 1000 : 500
      for (const driver of drivers) if (driver.claim && !driver.claim.confirmed && now < driver.claim.until && now + elapsed >= driver.claim.until) expirations++
      now += elapsed; detail = `可信匹配时钟推进到 ${now} ms；租约到期只解除所有权，不撤回旧客户端已保存的 offer。`
    } else if (command === 'move-d1') { drivers[0]!.x = 3.1; moves++; lastMoveStep = index + 1; detail = 'D1 已移动到远处；位置消息暂未送达，索引仍显示旧位置。' }
    else if (command === 'report-d2' || command === 'report-all') {
      for (const driver of drivers.filter((d) => command === 'report-all' || d.id === 'D2')) { driver.observed = { id: driver.id, x: driver.x, y: driver.y }; driver.reportedAt = now }
      detail = `${command === 'report-all' ? '全部司机' : 'D2'} 的实际位置报告到达，接收时间为 ${now} ms。`
    } else if (command === 'lookup-r1' || command === 'lookup-r2') {
      const trip = command.endsWith('r1') ? 'R1' : 'R2'
      const points = drivers.filter((d) => available(d) && now - d.reportedAt < freshness).map((d) => d.observed)
      const found = nearby(points, { ...riders[trip]!, radius: 0.75 }, 'grid', true).results.sort((a, b) => distance(a, riders[trip]!) - distance(b, riders[trip]!) || a.id.localeCompare(b.id))
      snapshots[trip] = found.map((p) => p.id)
      if (snapshots.R1?.[0] && snapshots.R1[0] === snapshots.R2?.[0]) overlappingSnapshots++
      lookups.push([trip, now, snapshots[trip]!.join(', ') || '空', found.map((p) => `${p.id}: ${now - drivers.find((d) => d.id === p.id)!.reportedAt} ms`).join('; ') || '无候选'])
      detail = `${trip} 保存附近候选快照 [${snapshots[trip]!.join(', ')}]；查询不预占司机。`
    } else if (command === 'offer-r1' || command === 'offer-r2') {
      const trip = command.endsWith('r1') ? 'R1' : 'R2'
      const id = snapshots[trip]?.[0]; const driver = drivers.find((d) => d.id === id)
      if (assignments.some((a) => a.trip === trip)) detail = `${trip} 已经匹配，不再预占另一名司机。`
      else if (!driver) detail = '没有查询到候选司机，无法创建 offer。'
      else if (now - driver.reportedAt >= freshness) { conflicts++; detail = '候选位置已经过期，拒绝预占；需要重新查询或接收报告。' }
      else if (config.claim === 'cas' && !available(driver)) { conflicts++; detail = `${driver.id} 已被占用；条件预占失败，未改变原持有者。` }
      else {
        claims++; const token = ++driver.generation
        driver.claim = { trip, token, until: now + 2000, confirmed: false }
        offers[trip] = { driver: driver.id, token, until: now + 2000, locationAge: now - driver.reportedAt }
        detail = `${trip} 获得 ${driver.id} 的 offer，token=${token}，到期 ${now + 2000} ms；${config.claim === 'cas' ? '条件写入' : '盲写可能覆盖已有预占'}。`
      }
    } else if (command === 'confirm-r1' || command === 'confirm-r2') {
      const trip = command.endsWith('r1') ? 'R1' : 'R2'; confirmations++
      const prior = assignments.find((a) => a.trip === trip)
      const offer = offers[trip]; const driver = drivers.find((d) => d.id === offer?.driver)
      if (prior && config.idempotency === 'trip') { duplicateReplies++; detail = `${trip} 返回既有匹配 ${prior.driver}，不新增指派记录。` }
      else if (!offer || !driver) detail = `${trip} 没有 offer，拒绝确认。`
      else if (config.fencing === 'check' && (now >= offer.until || driver.claim?.token !== offer.token || driver.claim.trip !== trip)) { staleRejected++; rejectedTokens.push({ driver: driver.id, token: offer.token }); detail = `${trip} 的 token=${offer.token} 已过期或被替换，资源端拒绝迟到确认。` }
      else {
        assignments.push({ trip, driver: driver.id, token: offer.token, step: index + 1 })
        driver.claim = { trip, token: offer.token, until: offer.until, confirmed: true }
        if (offer.locationAge >= 1000) staleAccepted++
        if (distance(driver, riders[trip]!) > 0.75) outOfRange++
        detail = `${trip} 确认 ${driver.id}，写入指派账本；使用的位置证据在预占时已有 ${offer.locationAge} ms。`
      }
    } else throw new Error(`Unknown dispatch action: ${command}`)
    events.push({ step: index + 1, action: command, detail })
  }
  const driverDuplicates = assignments.length - new Set(assignments.map((a) => a.driver)).size
  const tripDuplicates = assignments.length - new Set(assignments.map((a) => a.trip)).size
  return { events, metrics: { now, claims, conflicts, staleRejected, staleAccepted, duplicateReplies, expirations, confirmations, moves, outOfRange, overlappingSnapshots, matchesAfterMove: moves ? assignments.filter((a) => a.step > lastMoveStep).length : 0, newOwnerConfirmed: Number(assignments.some((a) => rejectedTokens.some((r) => r.driver === a.driver && r.token < a.token))), assignments: assignments.length, matchedTrips: new Set(assignments.map((a) => a.trip)).size, driverDuplicates, tripDuplicates, lookupCount: lookups.length }, tables: [
    { title: '司机真实位置与接收状态', columns: ['司机', '真实坐标', '已接收坐标', '报告年龄 ms', '匹配所有权'], rows: drivers.map((d) => [d.id, `${d.x},${d.y}`, `${d.observed.x},${d.observed.y}`, now - d.reportedAt, d.claim ? `${d.claim.trip} / token ${d.claim.token} / ${d.claim.confirmed ? '已匹配' : d.claim.until <= now ? '已过期' : `到期 ${d.claim.until}`}` : '空闲']) },
    { title: '候选快照', columns: ['乘客', '查询时间', '候选', '位置年龄'], rows: lookups },
    { title: '客户端持有的 Offer', columns: ['乘客', '司机', 'Token', '到期 ms'], rows: Object.entries(offers).map(([trip, o]) => [trip, o.driver, o.token, o.until]) },
    { title: '实际指派账本', columns: ['乘客', '司机', 'Token', '确认步骤'], rows: assignments.map((a) => [a.trip, a.driver, a.token, a.step]) },
  ], diagrams: [{ title: '实际位置与已确认匹配 · 圆为 R1 的查询范围', nodes: [...drivers.map((d) => ({ id: d.id, label: d.id, x: 40 + d.x * 100, y: 40 + d.y * 100, selected: assignments.some((a) => a.driver === d.id) })), ...Object.values(riders).map((r) => ({ id: r.id, label: r.id, x: 40 + r.x * 100, y: 40 + r.y * 100 }))], edges: assignments.map((a) => ({ from: a.trip, to: a.driver, label: `t${a.token}`, selected: true })), circle: { x: 120, y: 100, radius: 75 } }] }
}
const invariant = (r: ProductResult) => [check('司机与乘客唯一指派', r.metrics.driverDuplicates === 0 && r.metrics.tripDuplicates === 0, `重复占用司机 ${r.metrics.driverDuplicates} 次，重复指派乘客 ${r.metrics.tripDuplicates} 次；账本保留全部实际效果。`)]
const safe: DesignConfig = { freshness: '1000', claim: 'cas', fencing: 'check', idempotency: 'trip' }
export const dispatchDesign: ProductDesign = {
  id: 'design-dispatch', kind: 'product-design', category: '综合设计', difficulty: '进阶', estimatedMinutes: 40, title: 'Uber 类设计：附近司机与竞争派单', summary: '让两个乘客竞争司机，交错查询、预占与确认，检验位置新鲜度、原子预占、租约和迟到请求。',
  pains: ['附近查询结果只是快照，两位乘客可能同时选择同一位空闲司机。', '司机已经移动或失联，旧位置还留在索引里，不能继续当作新报告。', '预占过期后旧客户端仍能发确认；仅释放锁无法阻止迟到写入。', '匹配成功响应丢失后重试，不应增加第二条业务指派。'],
  requirements: ['两名乘客、三名司机，半径 0.75 的实际空间候选；位置年龄上限 1000 ms。', '已确认的指派中，一个司机最多服务一个行程，一个行程最多有一条指派。', '预占租约 2000 ms；确认必须验证当前 token、持有者与截止时间。', '竞争失败后允许重新查询其他司机；目标包含成功匹配，不能通过全部拒绝规避问题。'],
  contracts: [{ name: 'LocationReport(driver, position, observedAt)', description: '本题由可信接收时钟记录报告年龄；真实坐标只用于展示与对照，不泄漏给匹配决策。' }, { name: 'Nearby → Offer(tripId, driverId, token, until)', description: '候选查询不占用司机；预占是否仍然可用，必须在匹配存储中重新检查。' }, { name: 'Confirm(tripId, token)', description: '在受保护的匹配存储核验所有权；重复业务请求以 tripId 识别。' }],
  decisions: ['为什么先查询附近司机，再无条件写入预占，会出现竞争窗口？', 'Heartbeat/TTL 提供位置新鲜度约束，为什么不等于知道司机真实当前位置？', '预占、fencing 和确认幂等分别保护什么边界？'],
  boundary: ['单个可信匹配存储、共同虚拟时钟、固定司机与乘客；不实现跨分片事务、调度优化、价格、支付、轨迹预测或真实定位。', '位置索引只使用已送达报告；真实移动可先于报告。报告足够新仍不保证司机此刻未移动，TTL 不是位置正确性的证明。', '本关没有行程结束后复用司机，唯一性按当前有限场景的全部已确认账本检查。', '令牌在受保护的匹配存储分配并核验；租约到期不会删除客户端已持有的消息。'],
  relatedLabs: [{ id: 'heartbeat', title: 'Heartbeat 与怀疑' }, { id: 'lease-fencing', title: 'Lease 与 Fencing' }, { id: 'concurrent-update', title: '并发更新' }, { id: 'retry-idempotency', title: '重试与幂等' }],
  fields: [{ id: 'freshness', label: '位置新鲜度', options: [choice('ignore', '忽略报告年龄'), choice('1000', '只接受未满 1000 ms 的报告'), choice('500', '只接受未满 500 ms 的报告')] }, { id: 'claim', label: '司机预占', options: [choice('blind', '按候选快照直接覆盖'), choice('cas', '原子检查空闲再预占')] }, { id: 'fencing', label: '确认时所有权检查', options: [choice('ignore', '接受客户端旧 Offer'), choice('check', '验证 token、持有者与期限')] }, { id: 'idempotency', label: '匹配确认幂等', options: [choice('append', '每次确认追加记录'), choice('trip', '按 tripId 返回既有指派')] }],
  initialConfig: { freshness: 'ignore', claim: 'blind', fencing: 'ignore', idempotency: 'append' },
  metricLabels: [{ key: 'matchedTrips', label: '成功匹配乘客' }, { key: 'driverDuplicates', label: '重复占用司机' }, { key: 'tripDuplicates', label: '重复指派乘客' }, { key: 'staleRejected', label: '拒绝迟到确认' }, { key: 'staleAccepted', label: '采纳过期位置' }],
  actions: { 'lookup-r1': 'R1 查询附近司机', 'lookup-r2': 'R2 查询附近司机', 'offer-r1': 'R1 预占候选司机', 'offer-r2': 'R2 预占候选司机', 'confirm-r1': 'R1 确认或重试匹配', 'confirm-r2': 'R2 确认或重试匹配', 'move-d1': 'D1 移到远处，延迟位置消息', tick: '推进 1000 ms', 'tick-half': '推进 500 ms，比较新鲜度策略', 'report-d2': '接收 D2 新位置报告', 'report-all': '接收全部司机新位置报告' },
  scenarios: [
    { id: 'race', title: '两个乘客竞争同一司机', goal: '先让两个查询都看到 D1，再交错预占；失败者重查 D2，最终两人都匹配且无重复。', script: ['lookup-r1', 'lookup-r2', 'offer-r1', 'offer-r2', 'confirm-r1', 'confirm-r2', 'lookup-r2', 'offer-r2', 'confirm-r2'], check: (r) => [...invariant(r), check('两人都得到有效匹配', r.metrics.matchedTrips === 2 && r.metrics.lookupCount! >= 3 && r.metrics.overlappingSnapshots! > 0 && r.metrics.conflicts! > 0, `${r.metrics.matchedTrips} 位乘客匹配，${r.metrics.conflicts} 次竞争失败后可重查。`)] },
    { id: 'location', title: '司机移动与旧位置', goal: 'D1 移远但报告未到；时间过期后仅 D2 有新报告，不能用 D1 的旧位置完成指派。', script: ['move-d1', 'tick', 'tick', 'report-d2', 'lookup-r1', 'offer-r1', 'confirm-r1'], check: (r) => [...invariant(r), check('完成移动后的有效匹配', r.metrics.moves! > 0 && r.metrics.now! >= 2000 && r.metrics.matchesAfterMove === 1 && r.metrics.staleAccepted === 0 && r.metrics.outOfRange === 0, `${r.metrics.staleAccepted} 次过期位置指派，${r.metrics.outOfRange} 次实际范围外指派；需要一位移动后有效匹配的司机。`)] },
    { id: 'lease', title: '过期 Offer 迟到确认', goal: 'R1 的预占过期后 R2 接管；旧确认必须被拒绝，新持有者仍能成功。', script: ['lookup-r1', 'offer-r1', 'tick', 'tick', 'report-all', 'lookup-r2', 'offer-r2', 'confirm-r1', 'confirm-r2'], check: (r) => [...invariant(r), check('旧请求被挡住，新请求成功', r.metrics.expirations! > 0 && r.metrics.staleRejected! > 0 && r.metrics.matchedTrips === 1 && r.metrics.newOwnerConfirmed === 1, `${r.metrics.expirations} 次租约过期、${r.metrics.staleRejected} 次迟到拒绝、${r.metrics.matchedTrips} 次新持有者匹配。`)] },
    { id: 'retry', title: '匹配确认重试', goal: '同一 tripId 重复确认，返回原指派并保持唯一效果。', script: ['lookup-r1', 'offer-r1', 'confirm-r1', 'confirm-r1'], check: (r) => [...invariant(r), check('重试返回既有指派', r.metrics.confirmations! >= 2 && r.metrics.duplicateReplies! > 0 && r.metrics.matchedTrips === 1, `${r.metrics.duplicateReplies} 次复用结果，${r.metrics.assignments} 条指派。`)] },
  ],
  alternatives: [{ title: '条件预占 + 1000 ms 新鲜度', config: safe }, { title: '条件预占 + 500 ms 新鲜度', config: { ...safe, freshness: '500' } }],
  architecture: (c) => ['位置上报 → 空间候选与时间戳', `匹配 API → ${c.claim === 'cas' ? '原子预占' : '候选快照盲写'} → 2000 ms Offer`, `确认 API → ${c.fencing === 'check' ? '资源端所有权校验' : '直接接受'} → ${c.idempotency === 'trip' ? '按行程去重账本' : '追加账本'}`],
  run: runDispatch,
}
