import type { runObjectStorage } from '../models/object-storage'
import type { ProductView } from '../product-types'
import { messageFormatter, type MessageFormatters } from './format'
import { replicaRows, replicaCopies } from './replicas'

const messages: MessageFormatters = {
  'object-storage.read.missing': () => '404：未发布',
  'object-storage.read.offline': () => '503：元数据不可用',
  'object-storage.read.lost': () => '503：片已丢失',
  'object-storage.read.corrupt': () => '校验失败：拒绝返回',
  'object-storage.read.partial': () => '暂存对象提前可见',
  'object-storage.read.complete': (values) => `200：v${text(values[0])}`,
  'object-storage.observation-001': () => "元数据服务不可用或达到 8 个上传会话上限。",
  'object-storage.observation-002': (values) => String("创建 " + text(values[0]) + "；对象键固定为 report.txt，暂存片与已提交版本分离。"),
  'object-storage.observation-003': () => "需要一个尚未提交的上传会话；已提交版本不可原地修改。",
  'object-storage.observation-004': (values) => String("第 " + text(values[0]) + " 片已在 " + text(values[1]) + " 个在线节点保存并确认；同一会话和片号更新暂存引用。"),
  'object-storage.observation-005': (values) => String("在线节点不足 " + text(values[0]) + " 个，未确认该片。"),
  'object-storage.observation-006': () => "没有可用的元数据服务或上传会话。",
  'object-storage.observation-007': (values) => String("返回此前的版本 v" + text(values[0]) + "；相同 uploadId 没有再次创建版本。"),
  'object-storage.observation-008': () => "拒绝提交：缺片、副本不足或校验不符；未发布新版本。",
  'object-storage.observation-009': (values) => String("原子安装完整 manifest v" + text(values[0]) + "；此后读取引用固定片集合。"),
  'object-storage.observation-010': () => " 提交响应丢失，客户端结果未知。",
  'object-storage.observation-011': () => "元数据进程崩溃；已提交 manifest 和 uploadId 记录保存在独立的可靠元数据存储。",
  'object-storage.observation-012': () => "元数据进程恢复，读取持久提交记录。",
  'object-storage.observation-013': () => "A 节点离线，已保存片永久丢失；不从上传意图重造数据。",
  'object-storage.observation-014': () => "A 以空存储恢复，尚未拥有任何片。",
  'object-storage.observation-015': (values) => String("从幸存的真实片修复 " + text(values[0]) + "/" + text(values[1]) + " 个片引用；丢光的片不能恢复。"),
  'object-storage.observation-016': (values) => String((values[0] ? "客户端保存版本令牌 v" + text(values[1]) + "。" : "没有已提交版本可固定。")),
  'object-storage.observation-017': (values) => String("" + text(values[0]) + "" + text((values[1] ? "，内容为「" + text(values[2]) + "」" : "")) + "。"),
}
const { text, format } = messageFormatter(messages)

export function presentObjectStorage(result: ReturnType<typeof runObjectStorage>): ProductView {
  const { uploads, versions, reads } = result.state
  const nodes = result.state.nodes
  return { events: result.events.map((e) => ({ step: e.step, action: e.action, detail: e.messages.map(format).join('') })), tables: [
    { title: '上传暂存片', columns: ['会话', '片号', '存储引用', '在线副本'], rows: uploads.flatMap((u) => Object.entries(u.parts).map(([number, p]) => [u.id, number, p.key, replicaCopies(nodes, p.key)])) },
    { title: '已发布对象版本', columns: ['版本', 'Upload ID', '不可变片集合'], rows: versions.map((v) => [v.id, v.uploadId, v.parts.map((p) => p.key).join(' + ')]) },
    { title: '物理存储节点', columns: ['节点', '状态', '保存片数', '实际片'], rows: replicaRows(nodes) },
    { title: '对象读取记录', columns: ['读取方式', '状态', '实际内容'], rows: reads.map((r) => [r.targetVersion === null ? 'latest' : `pinned v${r.targetVersion}`, format(r.status), r.body ?? '无响应体']) },
  ] }
}
