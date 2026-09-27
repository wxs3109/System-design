import { check, choice, type DesignConfig, type ProductDesign, type ProductResult } from './product-types'
import { runDispatch } from './models/dispatch'
import { presentDispatch } from './presentation/dispatch'
export { runDispatch } from './models/dispatch'

const invariant = (r: ProductResult) => [check('司机与乘客唯一指派', r.metrics.driverDuplicates === 0 && r.metrics.tripDuplicates === 0, `重复占用司机 ${r.metrics.driverDuplicates} 次，重复指派乘客 ${r.metrics.tripDuplicates} 次；账本保留全部实际效果。`)]
const safe: DesignConfig = { freshness: '1000', claim: 'cas', fencing: 'check', idempotency: 'trip' }
export const dispatchDesign: ProductDesign = {
  versions: { model: 'dispatch-v1', definition: 1, assessment: 1 },
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
  present: (result) => presentDispatch(result as ReturnType<typeof runDispatch>),
}
