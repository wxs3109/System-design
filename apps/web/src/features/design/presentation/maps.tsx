import type { runMaps } from '../models/maps'
import type { ProductView } from '../product-types'
import { messageFormatter, type MessageFormatters } from './format'

const roadNodes = [{ id: 'A', x: 80, y: 70 }, { id: 'B', x: 270, y: 70 }, { id: 'C', x: 460, y: 70 }, { id: 'D', x: 80, y: 235 }, { id: 'E', x: 270, y: 235 }, { id: 'F', x: 460, y: 235 }]

const messages: MessageFormatters = {
  'maps.observation-001': (values) => String("半径 " + text(values[0]) + "：检查 " + text(values[1]) + " 个候选，返回 [" + text(list(values[2], ', ')) + "]；当前全扫描答案 [" + text(list(values[3], ', ')) + "]。"),
  'maps.observation-002': (values) => String("P2 移动到 (3.1, 0.5)；权威位置 v" + text(values[0]) + "，索引 v" + text(values[1]) + "。"),
  'maps.observation-003': () => "读取真实新位置更新索引。",
  'maps.observation-004': (values) => String("道路数据更新到 v" + text(values[0]) + "；" + text((values[1] ? "B–C 关闭" : (values[2] ? "B–E 耗时变为 10" : "F 的全部入口关闭"))) + "。"),
  'maps.observation-005': (values) => String("使用 v" + text(values[0]) + " 路线：" + text((values[1] ? list(values[2], ' → ') : "不可达")) + "；当前 v" + text(values[3]) + " 的独立枚举最优代价为 " + text((values[4] ? "不可达" : values[5])) + "。"),
}
const { text, list, format } = messageFormatter(messages)

export function presentMaps(result: ReturnType<typeof runMaps>): ProductView {
  const { points, indexPoints, roads, radius, selected, lastRoute, queries, routes } = result.state
  return { events: result.events.map((e) => ({ step: e.step, action: e.action, detail: e.messages.map(format).join('') })), tables: [
    { title: '空间点与索引', columns: ['ID', '当前坐标', '索引坐标'], rows: points.map((p) => { const old = indexPoints.find((n) => n.id === p.id)!; return [p.id, `${p.x}, ${p.y}`, `${old.x}, ${old.y}`] }) },
    { title: '附近查询证据', columns: ['半径', '候选数', '实际结果', '全扫描对照', '索引/数据版本'], rows: queries.map(q => [q.radius, q.candidateCount, q.actual.join(', ') || '空', q.expected.join(', ') || '空', `${q.indexRevision}/${q.pointRevision}`]) },
    { title: '路线与独立对照', columns: ['缓存版本', '道路版本', '返回路线', '返回代价', '最优代价', '核对'], rows: routes.map(r => [r.cachedRevision, r.roadRevision, r.path?.join(' → ') ?? '不可达', r.cost ?? '—', r.optimum ?? '不可达', r.valid ? '正确' : '无效或非最优']) },
  ], diagrams: [
    { title: '局部平面空间点 · 虚线为查询半径，蓝点为返回结果', nodes: points.map((p) => ({ ...p, label: p.id, x: 40 + p.x * 100, y: 40 + p.y * 100, selected: selected.includes(p.id) })), edges: [], circle: { x: 135, y: 90, radius: radius * 100 }, grid: { spacing: 100, offsetX: 40, offsetY: 40 } },
    { title: '道路图 · 红色虚线表示关闭，蓝线表示返回的路线', nodes: roadNodes.map((n) => ({ ...n, label: n.id })), edges: roads.map((r) => ({ from: r.a, to: r.b, label: r.open ? String(r.minutes) : '关闭', closed: !r.open, selected: !!lastRoute && lastRoute.path.some((node, i) => (node === r.a && lastRoute!.path[i + 1] === r.b) || (node === r.b && lastRoute!.path[i + 1] === r.a)) })) },
  ] }
}
