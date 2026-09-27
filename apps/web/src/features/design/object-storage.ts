import { objectStorageDesign as legacyDefinition } from './compat/v1/object-storage'
import { productV1Reader } from './compat/read-product-v1'
import { defineProductDesign } from './define-product'
import { check, choice } from './product-types'
import { runObjectStorage } from './models/object-storage'
import { presentObjectStorage } from './presentation/object-storage'
export { runObjectStorage } from './models/object-storage'

const readable = (r: ReturnType<typeof runObjectStorage>) => check('最后一次读取正确', r.metrics.lastCorrect === 1, '读取必须获得完整的真实已保存片；不能从期望值恢复内容。')
const safe = { publication: 'manifest', copies: '2', completion: 'idempotent', checksum: 'verify', versions: 'keep' } as const
export const objectStorageDesign = defineProductDesign({
  compatibility: productV1Reader(legacyDefinition, 'object-storage-v1'),
  versions: { model: 'object-storage-v1', definition: 1, assessment: 1 },
  id: 'design-object-storage', kind: 'product-design', category: '综合设计', difficulty: '进阶', estimatedMinutes: 45, title: 'S3 类设计：对象提交与持久性', summary: '上传真实的虚拟分片，处理未完成上传、提交重试、节点数据丢失、校验失败和版本化读取。',
  pains: ['大文件分片并行上传，中断时不能把半个对象当成完整对象。', 'Complete 已成功但响应丢失，重试不应意外创建第二个业务版本。', '确认上传不等于可以承受节点数据丢失；副本必须实际保存数据。', '覆盖写入时，下载者可能仍在读取旧版本，需要稳定的版本引用。'],
  requirements: ['PUT 分片、Complete 发布、GET latest 或指定版本；对象键固定 report.txt，每个上传会话 2 片。', '未提交对象不可读；提交必须核对片清单与内容校验。', '同一 uploadId 的提交重试返回原版本；单个存储节点数据丢失后仍可读。', '保留旧版本，允许新版本发布期间的旧版本读取。'],
  contracts: [{ name: 'CreateMultipartUpload / UploadPart / Complete', description: 'uploadId + partNumber 定位暂存片；Complete 安装不可变片清单。已提交版本不能原地改片。' }, { name: 'GET /objects/report.txt?versionId', description: '元数据选 manifest，数据节点读取实际片。版本索引与物理片分别展示。' }, { name: 'Upload / PartRef / ObjectVersion', description: '内容校验用于发现损坏；教学 hash 不是密码学保证。本题元数据存储可靠，未实现其共识协议。' }],
  decisions: ['ACK 在几个副本保存后返回，影响了什么故障边界与写入成本？', '为什么 Complete 的幂等身份应是上传会话，而不是每次请求新生成的 ID？', '保留多个不可变版本需要怎样的回收策略？'],
  boundary: ['A/B/C 三个虚拟存储节点，最多 8 个上传会话、120 步；实际内容是两段短字符串，不调用真实 S3。', '每步复制同步完成且只有在线节点能确认；节点数据丢失会真正删除其片，修复只能复制幸存内容。', 'metadata 原子提交与可靠保存是明确假设，不实现分区、分布式 metadata、纠删码、权限签名 URL、计费或后台 GC。', '只验证有限的对象协议；这些能力属于独立综合题，不自动改变共享画布的 Object Storage 组件。'],
  relatedLabs: [{ id: 'retry-idempotency', title: '重试与幂等' }, { id: 'durability-recovery', title: '持久性与恢复' }, { id: 'quorum-reads', title: 'Quorum 与修复' }],
  fields: [
    { id: 'publication', label: '对象可见边界', options: [choice('early', '暂存片上传即暴露'), choice('manifest', '完整 manifest 提交后可见')] },
    { id: 'copies', label: '确认前保存副本', options: [choice('1', '1 个副本'), choice('2', '2 个副本'), choice('3', '3 个副本')] },
    { id: 'completion', label: '提交重试', options: [choice('new-version', '每次提交新建版本'), choice('idempotent', '按 uploadId 返回原版本')] },
    { id: 'checksum', label: '内容校验', options: [choice('trust', '只相信片号齐全'), choice('verify', '检查实际片的校验值')] },
    { id: 'versions', label: '覆盖写入', options: [choice('overwrite', '只保留最新版本索引'), choice('keep', '保留不可变版本索引')] },
  ],
  initialConfig: { publication: 'early', copies: '1', completion: 'new-version', checksum: 'trust', versions: 'overwrite' },
  metricLabels: [{ key: 'versions', label: '已发布版本' }, { key: 'minimumCopies', label: '最少在线片副本' }, { key: 'partialReads', label: '半成品读取' }, { key: 'corruptReads', label: '错误内容读取' }, { key: 'unavailable', label: '不可读请求' }],
  actions: { begin: '开始上传', 'begin-overwrite': '开始覆盖上传', part1: '上传第 1 片', part2: '上传第 2 片', 'part2-corrupt': '上传损坏的第 2 片', complete: '提交或重试 Complete', 'complete-lost': '提交后丢失响应', crash: '元数据进程崩溃', restart: '恢复元数据进程', get: '读取最新对象', pin: '客户端固定当前版本', 'read-pinned': '读取固定版本', 'lose-a': 'A 节点丢失全部片', 'recover-a': '恢复空节点 A', repair: '从幸存片修复副本' },
  scenarios: [
    { id: 'visibility', title: '半成品可见性', goal: '在只上传一片时读取，再完成上传；只有完整提交对象可以返回。', script: ['begin', 'part1', 'get', 'part2', 'complete', 'get'], check: (r) => [readable(r), check('检查了提交前读取', r.metrics.beforeCommitReads! > 0, `${r.metrics.beforeCommitReads} 次。`), check('没有暴露半成品', r.metrics.partialReads === 0, `${r.metrics.partialReads} 次半成品返回。`)] },
    { id: 'retry', title: '提交结果未知', goal: 'Complete 响应丢失后重启并重试，同一上传只能产生一个版本。', script: ['begin', 'part1', 'part2', 'complete-lost', 'crash', 'restart', 'complete', 'get'], check: (r) => [readable(r), check('执行了响应丢失与重启', r.metrics.lostAcks! > 0 && r.metrics.restarts! > 0, `${r.metrics.lostAcks} 次丢失响应、${r.metrics.restarts} 次重启。`), check('同一上传只有一个版本', r.metrics.versions === 1 && r.metrics.deduped! > 0, `${r.metrics.versions} 个版本、${r.metrics.deduped} 次复用提交。`)] },
    { id: 'durability', title: '确认后丢失节点', goal: '删除 A 的真实数据，持续读取并从幸存片修复副本。', script: ['begin', 'part1', 'part2', 'complete', 'lose-a', 'get', 'recover-a', 'repair', 'get'], check: (r) => [readable(r), check('故障后成功读取', r.metrics.failures! > 0 && r.metrics.correctAfterLoss! >= 2 && r.metrics.unavailable === 0, `${r.metrics.correctAfterLoss} 次正确读取，${r.metrics.unavailable} 次不可用。`), check('实际副本恢复', r.metrics.minimumCopies! >= 2, `最少 ${r.metrics.minimumCopies} 个在线副本。`)] },
    { id: 'integrity', title: '损坏分片与重传', goal: '拒绝校验不符的 Complete，重传正确片后才能发布。', script: ['begin', 'part1', 'part2-corrupt', 'complete', 'get', 'part2', 'complete', 'get'], check: (r) => [readable(r), check('损坏被拒绝', r.metrics.corruptParts! > 0 && r.metrics.rejected! > 0, `${r.metrics.corruptParts} 个损坏片、${r.metrics.rejected} 次拒绝提交。`), check('没有返回损坏内容', r.metrics.corruptReads === 0 && r.metrics.partialReads === 0, '检查返回的实际内容，而非是否执行过重试。')] },
    { id: 'version', title: '覆盖写与旧版本读取', goal: '固定旧版本，再覆盖对象；旧版本保持原内容，latest 返回新内容。', script: ['begin', 'part1', 'part2', 'complete', 'get', 'pin', 'begin-overwrite', 'part1', 'part2', 'complete', 'read-pinned', 'get'], check: (r) => [readable(r), check('旧版本仍可读', r.metrics.pinnedCorrect === 1 && r.metrics.pinnedDistinct === 1 && r.metrics.versions! >= 2, `${r.metrics.versions} 个版本；固定的较早版本读取 ${r.metrics.pinnedDistinct ? '正确且与新内容不同' : '尚未验证'}。`)] },
  ],
  alternatives: [{ title: '完整提交 + 两份数据', config: safe }, { title: '完整提交 + 三份数据', config: { ...safe, copies: '3' } }],
  architecture: (c) => [`上传控制 API → Upload 会话`, `客户端分片 → ${c.copies} 个数据节点 → ${c.publication === 'manifest' ? '校验后安装 manifest' : '提前暴露暂存对象'}`, `读取 API → ${c.versions === 'keep' ? '版本索引' : '最新索引'} → 真实片 → 返回内容`],
  run: runObjectStorage,
  present: presentObjectStorage,
})
