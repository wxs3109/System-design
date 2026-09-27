import type { runDispatch } from '../models/dispatch'
import type { ProductView } from '../product-types'
import { messageFormatter, type MessageFormatters } from './format'

const messages: MessageFormatters = {
  'dispatch.observation-001': (values) => String("可信匹配时钟推进到 " + text(values[0]) + " ms；租约到期只解除所有权，不撤回旧客户端已保存的 offer。"),
  'dispatch.observation-002': () => "D1 已移动到远处；位置消息暂未送达，索引仍显示旧位置。",
  'dispatch.observation-003': (values) => String("" + text((values[0] ? "全部司机" : "D2")) + " 的实际位置报告到达，接收时间为 " + text(values[1]) + " ms。"),
  'dispatch.observation-004': (values) => String("" + text(values[0]) + " 保存附近候选快照 [" + text(list(values[1], ', ')) + "]；查询不预占司机。"),
  'dispatch.observation-005': (values) => String("" + text(values[0]) + " 已经匹配，不再预占另一名司机。"),
  'dispatch.observation-006': () => "没有查询到候选司机，无法创建 offer。",
  'dispatch.observation-007': () => "候选位置已经过期，拒绝预占；需要重新查询或接收报告。",
  'dispatch.observation-008': (values) => String("" + text(values[0]) + " 已被占用；条件预占失败，未改变原持有者。"),
  'dispatch.observation-009': (values) => String("" + text(values[0]) + " 获得 " + text(values[1]) + " 的 offer，token=" + text(values[2]) + "，到期 " + text(values[3]) + " ms；" + text((values[4] ? "条件写入" : "盲写可能覆盖已有预占")) + "。"),
  'dispatch.observation-010': (values) => String("" + text(values[0]) + " 返回既有匹配 " + text(values[1]) + "，不新增指派记录。"),
  'dispatch.observation-011': (values) => String("" + text(values[0]) + " 没有 offer，拒绝确认。"),
  'dispatch.observation-012': (values) => String("" + text(values[0]) + " 的 token=" + text(values[1]) + " 已过期或被替换，资源端拒绝迟到确认。"),
  'dispatch.observation-013': (values) => String("" + text(values[0]) + " 确认 " + text(values[1]) + "，写入指派账本；使用的位置证据在预占时已有 " + text(values[2]) + " ms。"),
}
const { text, list, format } = messageFormatter(messages)

export function presentDispatch(result: ReturnType<typeof runDispatch>): ProductView {
  const { drivers, riders, offers, assignments, lookups, now } = result.state
  return { events: result.events.map((e) => ({ step: e.step, action: e.action, detail: e.messages.map(format).join('') })), tables: [
    { title: '司机真实位置与接收状态', columns: ['司机', '真实坐标', '已接收坐标', '报告年龄 ms', '匹配所有权'], rows: drivers.map((d) => [d.id, `${d.x},${d.y}`, `${d.observed.x},${d.observed.y}`, now - d.reportedAt, d.claim ? `${d.claim.trip} / token ${d.claim.token} / ${d.claim.confirmed ? '已匹配' : d.claim.until <= now ? '已过期' : `到期 ${d.claim.until}`}` : '空闲']) },
    { title: '候选快照', columns: ['乘客', '查询时间', '候选', '位置年龄'], rows: lookups.map(l => [l.trip, l.at, l.candidates.join(', ') || '空', l.ages.map(a => `${a.driver}: ${a.ms} ms`).join('; ') || '无候选']) },
    { title: '客户端持有的 Offer', columns: ['乘客', '司机', 'Token', '到期 ms'], rows: Object.entries(offers).map(([trip, o]) => [trip, o.driver, o.token, o.until]) },
    { title: '实际指派账本', columns: ['乘客', '司机', 'Token', '确认步骤'], rows: assignments.map((a) => [a.trip, a.driver, a.token, a.step]) },
  ], diagrams: [{ title: '实际位置与已确认匹配 · 圆为 R1 的查询范围', nodes: [...drivers.map((d) => ({ id: d.id, label: d.id, x: 40 + d.x * 100, y: 40 + d.y * 100, selected: assignments.some((a) => a.driver === d.id) })), ...Object.values(riders).map((r) => ({ id: r.id, label: r.id, x: 40 + r.x * 100, y: 40 + r.y * 100 }))], edges: assignments.map((a) => ({ from: a.trip, to: a.driver, label: `t${a.token}`, selected: true })), circle: { x: 120, y: 100, radius: 75 } }] }
}
