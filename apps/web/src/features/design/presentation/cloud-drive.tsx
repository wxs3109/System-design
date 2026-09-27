import type { runCloudDrive } from '../models/cloud-drive'
import type { ProductView } from '../product-types'
import { messageFormatter, type MessageFormatters } from './format'
import { replicaRows } from './replicas'

const messages: MessageFormatters = {
  'cloud-drive.observation-001': () => "元数据/授权进程不可用，未执行该操作；这不是业务成功或权限撤销的证明。",
  'cloud-drive.observation-002': () => "本地没有可编辑文件，或达到该设备 6 次编辑上限。",
  'cloud-drive.observation-003': (values) => String("" + text(values[0]) + " " + text((values[1] ? "准备新文件 notes.txt" : "从本地 v" + text(values[2]) + " 编辑")) + "，operationId=" + text(values[3]) + "；内容尚未上传。"),
  'cloud-drive.observation-004': () => "请先在设备上准备编辑。",
  'cloud-drive.observation-005': (values) => String("" + text(values[0]) + " 的不可变内容已写入两份物理副本，尚未更新文件指针。"),
  'cloud-drive.observation-006': () => "元数据进程不可用或缺少编辑操作。",
  'cloud-drive.observation-007': (values) => String("" + text(values[0]) + " 返回持久记录的原提交结果，未再次改变文件版本。"),
  'cloud-drive.observation-008': () => "删除标记拒绝离线旧版本，必须显式恢复或另存新文件。",
  'cloud-drive.observation-009': () => "拒绝发布指向缺失内容的元数据。",
  'cloud-drive.observation-010': (values) => String("当前 v" + text(values[0]) + " 不等于 base v" + text(values[1]) + "，保留服务器版本与客户端未合并内容。"),
  'cloud-drive.observation-011': (values) => String("文件 " + text(values[0]) + " v" + text(values[1]) + " 已提交，进程在通知前崩溃；" + text((values[2] ? "持久变更日志仍存在" : "变更日志缺失")) + "。"),
  'cloud-drive.observation-012': (values) => String("" + text(values[0]) + " 发布 v" + text(values[1]) + "" + text((values[2] ? "，显式保留冲突分支" : (values[3] ? "，旧 base 盲写覆盖了另一设备的内容" : ""))) + "。"),
  'cloud-drive.observation-013': () => "元数据进程恢复；文件、提交身份与已有变更日志保留。",
  'cloud-drive.observation-014': (values) => String("" + text(values[0]) + " 应用 " + text(values[1]) + " 条真实变更日志，cursor=" + text(values[2]) + "。缺失日志不会由期望状态补造。"),
  'cloud-drive.observation-015': (values) => String((values[0] ? "B 收到 seq=" + text(values[1]) + "，尚未应用；cursor=" + text(values[2]) + "。" : "没有可接收的变更。")),
  'cloud-drive.observation-016': (values) => String("B 应用已收到变更并保存 cursor=" + text(values[0]) + "。"),
  'cloud-drive.observation-017': () => "B 崩溃丢失未应用消息；已保存的文件和 cursor 保留。后续同步从该 cursor 重启。",
  'cloud-drive.observation-018': () => "文件已删除或尚未同步到设备。",
  'cloud-drive.observation-019': () => "存在文件条目，却无法读取它引用的真实对象。",
  'cloud-drive.observation-020': (values) => String("B 按已同步 v" + text(values[0]) + " 下载，实际内容为「" + text(values[1]) + "」。"),
  'cloud-drive.observation-021': () => "没有可用的不同内容旧版本；观察账本不能代替已保存版本索引或对象。",
  'cloud-drive.observation-022': (values) => String("通过保存的版本索引读取 v" + text(values[0]) + "，真实内容「" + text(values[1]) + "」。"),
  'cloud-drive.observation-023': (values) => String("用户显式恢复旧内容引用 " + text(values[0]) + "，产生新版本，保留当前目录与名称。"),
  'cloud-drive.observation-024': () => "已确保存在 /archive；同一父目录的同名文件夹不重复创建。",
  'cloud-drive.observation-025': () => "需要在线元数据服务、可见文件与目标文件夹 /archive。",
  'cloud-drive.observation-026': () => "只修改文件父目录、名字与版本；不重新上传内容。",
  'cloud-drive.observation-027': () => "没有可删除的在线文件。",
  'cloud-drive.observation-028': (values) => String((values[0] ? "保存删除标记和回收站引用，向同步日志追加删除变更。" : "移除文件/版本索引并忘记删除身份；离线旧写可能被当成新文件。")),
  'cloud-drive.observation-029': () => "回收站没有可恢复的文件记录。",
  'cloud-drive.observation-030': () => "用户显式从回收站恢复原引用，产生新元数据版本和同步变更。",
  'cloud-drive.observation-031': () => "授予访客读取 f1 的权限，并保存一个分享链接。",
  'cloud-drive.observation-032': () => "服务端已撤销分享授权；访客手里仍保留旧链接。",
  'cloud-drive.observation-033': (values) => String("" + text((values[0] ? "获授权访客" : "已撤销访客")) + "读取实际内容「" + text(values[1]) + "」。"),
  'cloud-drive.observation-034': () => "拒绝新的访客下载；已下载到访客设备的内容无法被远程抹除。",
}
const { text, format } = messageFormatter(messages)

export function presentCloudDrive(result: ReturnType<typeof runCloudDrive>): ProductView {
  const { changes, history, responses, downloads } = result.state
  const responseLabels = { replayed: '返回原提交', deleted: '文件已删除，拒绝旧写', 'missing-content': '拒绝：内容未保存', conflict: '409：版本冲突', 'lost-response': '响应丢失', forked: '冲突另存', committed: '提交成功' }
  const downloadLabels = { unavailable: '503：授权服务不可用', 'not-visible': '404：文件不可见', 'missing-content': '503：元数据指向缺失内容', authorized: '授权下载', leaked: '撤销后仍泄露', rejected: '拒绝下载' }
  const files = new Map(result.state.files.map(f => [f.id, f]))
  const folders = new Map(Object.entries(result.state.folders))
  const devices = Object.fromEntries(Object.entries(result.state.devices).map(([id,d]) => [id, { ...d, files: new Map(d.files.map(f => [f.id, f])) }]))
  const versionIndex = new Map([["versions", result.state.versionIndex]])
  const nodes = result.state.nodes
  return { events: result.events.map((e) => ({ step: e.step, action: e.action, detail: e.messages.map(format).join('') })), tables: [
    { title: '文件夹', columns: ['ID', '名字', '父目录'], rows: [...folders].map(([id, f]) => [id, f.name, f.parent ?? '—']) },
    { title: '服务器文件元数据', columns: ['File ID', '路径', '版本', '对象引用', '状态'], rows: [...files.values()].map((f) => [f.id, `/${folders.get(f.parent)?.name}/${f.name}`, f.revision, f.blob, f.deleted ? '回收站 / Tombstone' : '可见']) },
    { title: '元数据版本记录（观察账本）', columns: ['File ID', '版本', '对象引用', '删除'], rows: history.map((f) => [f.id, f.revision, f.blob, f.deleted ? '是' : '否']) },
    { title: '持久变更日志', columns: ['Seq', 'File ID', '版本', '类型'], rows: changes.map((c) => [c.sequence, c.file.id, c.file.revision, c.file.deleted ? '删除' : '更新']) },
    { title: '设备同步与本地副本', columns: ['设备', 'Cursor', '未应用 Seq', '文件快照'], rows: Object.entries(devices).map(([id, d]) => [id, d.cursor, d.pending?.sequence ?? '无', [...d.files.values()].map((f) => `${f.id} v${f.revision}${f.deleted ? ' 已删除' : ''}`).join('; ')]) },
    { title: '设备保留的编辑意图', columns: ['设备', 'Operation ID', 'Base 版本', '本地内容'], rows: Object.entries(devices).flatMap(([id, d]) => d.edit ? [[id, d.edit.operationId, d.edit.baseRevision, d.edit.content]] : []) },
    { title: '可读取版本索引', columns: ['File ID', '版本', '对象引用'], rows: [...versionIndex.values()].flat().map((f) => [f.id, f.revision, f.blob]) },
    { title: '提交响应', columns: ['Operation ID', '结果', '文件 / 提交版本'], rows: responses.map(r => [r.operationId, responseLabels[r.status], r.revision === null ? r.fileId : `${r.fileId} v${r.revision}`]) },
    { title: '真实下载内容', columns: ['调用者', '状态/版本', '响应内容'], rows: downloads.map(d => [d.actor, d.status === 'current' ? `v${d.revision}` : d.status === 'previous' ? `历史 v${d.revision}` : downloadLabels[d.status], d.body ?? d.blob ?? '—']) },
    { title: '内容存储节点', columns: ['节点', '状态', '对象数', '实际对象'], rows: replicaRows(nodes) },
  ] }
}
