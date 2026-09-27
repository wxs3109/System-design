import { ObjectReplicas } from './object-replicas'
import { check, choice, type DesignConfig, type DesignEvent, type ProductDesign, type ProductResult } from './product-types'

export function runCloudDrive(config: DesignConfig, commands: readonly string[]): ProductResult {
  interface File { id: string; parent: string; name: string; revision: number; blob: string; deleted: boolean }
  interface Change { sequence: number; file: File }
  interface Edit { fileId: string; operationId: string; baseRevision: number; blob: string; content: string }
  interface Device { files: Map<string, File>; cursor: number; pending?: Change; edit?: Edit; edits: number }
  const blobs = new ObjectReplicas(); blobs.write('initial-blob', 'initial content', 2)
  const initial: File = { id: 'f1', parent: 'docs', name: 'report.txt', revision: 1, blob: 'initial-blob', deleted: false }
  const files = new Map([['f1', { ...initial }]])
  const folders = new Map([['root', { name: '/', parent: '—' }], ['docs', { name: 'docs', parent: 'root' }]])
  const devices: Record<string, Device> = { A: { files: new Map([['f1', { ...initial }]]), cursor: 0, edits: 0 }, B: { files: new Map([['f1', { ...initial }]]), cursor: 0, edits: 0 } }
  const changes: Change[] = []; const history: File[] = [{ ...initial }]
  const versionIndex = new Map<string, File[]>([['f1', [{ ...initial }]]])
  const completed = new Map<string, string>(); const effects: { operation: string; file: string }[] = []
  const responses: (string | number)[][] = []; const downloads: (string | number)[][] = []; const events: DesignEvent[] = []
  // Observer history is not consulted to reconstruct missing server metadata or bytes.
  const retired = new Set<string>()
  let online = true; let step = 0; let lastMutation = 0; let share = false; let bearer = false
  let missingRejected = 0; let danglingReads = 0; let conflicts = 0; let conflictCopies = 0; let silentOverwrites = 0; let commitGaps = 0; let replays = 0; let deviceCrashes = 0; let deletes = 0; let restores = 0; let resurrections = 0; let grants = 0; let revocations = 0; let guestAllowed = 0; let guestDeniedAfterRevoke = 0; let leaks = 0; let moved = 0; let editAttempts = 0
  let lastDownload: { file: File; body: string; step: number } | undefined
  let previousDownloads = 0; let versionRestores = 0
  let deletedWriteRejected = 0; let bVersionConflicts = 0; let crashesWithPending = 0
  const install = (file: File, gap = false) => {
    files.set(file.id, { ...file }); history.push({ ...file }); lastMutation = step
    versionIndex.set(file.id, [...(versionIndex.get(file.id) ?? []), { ...file }])
    if (config.changefeed === 'atomic' || !gap) changes.push({ sequence: changes.length + 1, file: { ...file } })
  }
  const receive = (device: Device) => {
    if (!online || device.pending) return
    const entry = changes.find((c) => c.sequence > device.cursor)
    if (!entry) return
    device.pending = structuredClone(entry)
    if (config.checkpoint === 'early') device.cursor = entry.sequence
  }
  const apply = (device: Device) => {
    if (!device.pending) return
    const entry = device.pending; const current = device.files.get(entry.file.id)
    if (!current || entry.file.revision > current.revision) device.files.set(entry.file.id, { ...entry.file })
    device.cursor = Math.max(device.cursor, entry.sequence); delete device.pending
  }
  const sync = (device: Device) => {
    let count = 0
    for (let i = 0; i < 256; i++) { receive(device); if (!device.pending) break; apply(device); count++ }
    return count
  }
  for (const [index, command] of commands.entries()) {
    step = index + 1; let detail = ''
    if (!online && ['create-folder', 'rename-move', 'delete', 'restore', 'restore-previous', 'share', 'revoke', 'guest-get'].includes(command)) {
      if (command === 'guest-get') downloads.push(['Guest', '503：授权服务不可用', '—'])
      events.push({ step, action: command, detail: '元数据/授权进程不可用，未执行该操作；这不是业务成功或权限撤销的证明。' })
      continue
    }
    if (command === 'prepare-a' || command === 'prepare-b' || command === 'prepare-new-a') {
      const name = command.endsWith('a') ? 'A' : 'B'; const device = devices[name]!; const view = device.files.get('f1')
      const creating = command === 'prepare-new-a'
      if ((!creating && (!view || view.deleted)) || device.edits >= 6) detail = '本地没有可编辑文件，或达到该设备 6 次编辑上限。'
      else { const number = ++device.edits; device.edit = { fileId: creating ? 'f2' : 'f1', operationId: `${name}-${number}`, baseRevision: creating ? 0 : view!.revision, blob: `edit-${name}-${number}`, content: `${name} edit ${number}` }; detail = `${name} ${creating ? '准备新文件 notes.txt' : `从本地 v${view!.revision} 编辑`}，operationId=${device.edit.operationId}；内容尚未上传。` }
    } else if (command === 'upload-a' || command === 'upload-b') {
      const name = command.endsWith('a') ? 'A' : 'B'; const edit = devices[name]!.edit
      if (!edit) detail = '请先在设备上准备编辑。'
      else { blobs.write(edit.blob, edit.content, 2); detail = `${edit.operationId} 的不可变内容已写入两份物理副本，尚未更新文件指针。` }
    } else if (command === 'commit-a' || command === 'commit-b' || command === 'commit-a-gap') {
      const name = command === 'commit-b' ? 'B' : 'A'; const edit = devices[name]!.edit; const current = edit ? files.get(edit.fileId) : undefined
      editAttempts++
      if (!online || !edit) detail = '元数据进程不可用或缺少编辑操作。'
      else if (config.idempotency === 'key' && completed.has(edit.operationId)) { replays++; responses.push([edit.operationId, '返回原提交', completed.get(edit.operationId)!]); detail = `${edit.operationId} 返回持久记录的原提交结果，未再次改变文件版本。` }
      else if (current?.deleted) { conflicts++; deletedWriteRejected++; responses.push([edit.operationId, '文件已删除，拒绝旧写', edit.fileId]); detail = '删除标记拒绝离线旧版本，必须显式恢复或另存新文件。' }
      else if (config.publication === 'durable' && blobs.read(edit.blob) === undefined) { missingRejected++; responses.push([edit.operationId, '拒绝：内容未保存', 'f1']); detail = '拒绝发布指向缺失内容的元数据。' }
      else if (current && current.revision !== edit.baseRevision && config.conflict === 'reject') { conflicts++; if (name === 'B') bVersionConflicts++; responses.push([edit.operationId, '409：版本冲突', edit.fileId]); detail = `当前 v${current.revision} 不等于 base v${edit.baseRevision}，保留服务器版本与客户端未合并内容。` }
      else {
        const conflict = !!current && current.revision !== edit.baseRevision
        const copy = conflict && config.conflict === 'copy'
        const id = copy ? `${edit.fileId}-conflict-${edit.operationId}` : edit.fileId
        const file: File = { id, parent: current?.parent ?? 'docs', name: copy ? `report (conflict ${edit.operationId}).txt` : current?.name ?? (edit.fileId === 'f2' ? 'notes.txt' : 'report.txt'), revision: copy ? 1 : (current?.revision ?? edit.baseRevision) + 1, blob: edit.blob, deleted: false }
        if (copy) { conflicts++; conflictCopies++; if (name === 'B') bVersionConflicts++ }
        else if (conflict) silentOverwrites++
        if (!current && retired.has(edit.fileId)) resurrections++
        const gap = command === 'commit-a-gap'
        install(file, gap); completed.set(edit.operationId, `${id} v${file.revision}`); effects.push({ operation: edit.operationId, file: id })
        if (gap) { online = false; commitGaps++; responses.push([edit.operationId, '响应丢失', id]); detail = `文件 ${id} v${file.revision} 已提交，进程在通知前崩溃；${config.changefeed === 'atomic' ? '持久变更日志仍存在' : '变更日志缺失'}。` }
        else { responses.push([edit.operationId, copy ? '冲突另存' : '提交成功', `${id} v${file.revision}`]); detail = `${id} 发布 v${file.revision}${copy ? '，显式保留冲突分支' : conflict ? '，旧 base 盲写覆盖了另一设备的内容' : ''}。` }
      }
    } else if (command === 'restart-server') { online = true; detail = '元数据进程恢复；文件、提交身份与已有变更日志保留。' }
    else if (command === 'sync-a' || command === 'sync-b') {
      const name = command.endsWith('a') ? 'A' : 'B'; const count = sync(devices[name]!); detail = `${name} 应用 ${count} 条真实变更日志，cursor=${devices[name]!.cursor}。缺失日志不会由期望状态补造。`
    } else if (command === 'receive-b') { receive(devices.B!); detail = devices.B!.pending ? `B 收到 seq=${devices.B!.pending.sequence}，尚未应用；cursor=${devices.B!.cursor}。` : '没有可接收的变更。' }
    else if (command === 'apply-b') { apply(devices.B!); detail = `B 应用已收到变更并保存 cursor=${devices.B!.cursor}。` }
    else if (command === 'crash-b') { if (devices.B!.pending) crashesWithPending++; delete devices.B!.pending; deviceCrashes++; detail = 'B 崩溃丢失未应用消息；已保存的文件和 cursor 保留。后续同步从该 cursor 重启。' }
    else if (command === 'download-b' || command === 'download-new-b') {
      const fileId = command === 'download-b' ? 'f1' : 'f2'
      const file = devices.B!.files.get(fileId); const authoritative = files.get(fileId)
      if (!file || file.deleted || !authoritative || authoritative.deleted) { downloads.push(['B', '404：文件不可见', '—']); lastDownload = undefined; detail = '文件已删除或尚未同步到设备。' }
      else { const body = blobs.read(file.blob); if (body === undefined) { danglingReads++; lastDownload = undefined; downloads.push(['B', '503：元数据指向缺失内容', file.blob]); detail = '存在文件条目，却无法读取它引用的真实对象。' } else { lastDownload = { file: { ...file }, body, step }; downloads.push(['B', `v${file.revision}`, body]); detail = `B 按已同步 v${file.revision} 下载，实际内容为「${body}」。` } }
    } else if (command === 'download-previous' || command === 'restore-previous') {
      const current = files.get('f1')
      const previous = current && !current.deleted ? versionIndex.get('f1')?.filter((f) => !f.deleted && f.blob !== current.blob).at(-1) : undefined
      const body = previous ? blobs.read(previous.blob) : undefined
      if (!online || !previous || body === undefined || !current) detail = '没有可用的不同内容旧版本；观察账本不能代替已保存版本索引或对象。'
      else if (command === 'download-previous') { previousDownloads++; downloads.push(['B', `历史 v${previous.revision}`, body]); detail = `通过保存的版本索引读取 v${previous.revision}，真实内容「${body}」。` }
      else { install({ ...current, blob: previous.blob, revision: current.revision + 1 }); versionRestores++; detail = `用户显式恢复旧内容引用 ${previous.blob}，产生新版本，保留当前目录与名称。` }
    } else if (command === 'create-folder') { if (!folders.has('archive')) folders.set('archive', { name: 'archive', parent: 'root' }); detail = '已确保存在 /archive；同一父目录的同名文件夹不重复创建。' }
    else if (command === 'rename-move') {
      const file = files.get('f1')
      if (!online || !file || file.deleted || !folders.has('archive')) detail = '需要在线元数据服务、可见文件与目标文件夹 /archive。'
      else { install({ ...file, parent: 'archive', name: 'report-final.txt', revision: file.revision + 1 }); moved++; detail = '只修改文件父目录、名字与版本；不重新上传内容。' }
    } else if (command === 'delete') {
      const file = files.get('f1')
      if (!online || !file || file.deleted) detail = '没有可删除的在线文件。'
      else { install({ ...file, deleted: true, revision: file.revision + 1 }); if (config.deletion === 'forget') { files.delete('f1'); versionIndex.delete('f1') }; retired.add('f1'); deletes++; detail = config.deletion === 'tombstone' ? '保存删除标记和回收站引用，向同步日志追加删除变更。' : '移除文件/版本索引并忘记删除身份；离线旧写可能被当成新文件。' }
    } else if (command === 'restore') {
      const file = files.get('f1')
      if (!online || !file?.deleted) detail = '回收站没有可恢复的文件记录。'
      else { install({ ...file, deleted: false, revision: file.revision + 1 }); retired.delete('f1'); restores++; detail = '用户显式从回收站恢复原引用，产生新元数据版本和同步变更。' }
    } else if (command === 'share') { share = true; bearer = true; grants++; detail = '授予访客读取 f1 的权限，并保存一个分享链接。' }
    else if (command === 'revoke') { share = false; revocations++; detail = '服务端已撤销分享授权；访客手里仍保留旧链接。' }
    else if (command === 'guest-get') {
      const file = files.get('f1'); const allowed = share || (config.sharing === 'bearer' && bearer)
      const body = file && !file.deleted && allowed ? blobs.read(file.blob) : undefined
      if (body !== undefined) { guestAllowed++; if (!share) leaks++; downloads.push(['Guest', share ? '授权下载' : '撤销后仍泄露', body]); detail = `${share ? '获授权访客' : '已撤销访客'}读取实际内容「${body}」。` }
      else { if (revocations > 0 && !share && !allowed && file && !file.deleted && blobs.read(file.blob) !== undefined) guestDeniedAfterRevoke++; downloads.push(['Guest', '拒绝下载', '—']); detail = '拒绝新的访客下载；已下载到访客设备的内容无法被远程抹除。' }
    } else throw new Error(`Unknown drive action: ${command}`)
    events.push({ step, action: command, detail })
  }
  const visible = (entries: Map<string, File>) => JSON.stringify([...entries.values()].filter((f) => !f.deleted).sort((a, b) => a.id.localeCompare(b.id)))
  const current = files.get('f1'); const currentBody = current && !current.deleted ? blobs.read(current.blob) : undefined
  const downloadedFile = lastDownload ? files.get(lastDownload.file.id) : undefined
  const downloadCurrent = !!lastDownload && !!downloadedFile && lastDownload.step >= lastMutation && JSON.stringify(lastDownload.file) === JSON.stringify(downloadedFile) && lastDownload.body === blobs.read(downloadedFile.blob)
  const namespaceUnique = new Set([...files.values()].filter((f) => !f.deleted).map((f) => `${f.parent}/${f.name}`)).size === [...files.values()].filter((f) => !f.deleted).length
  const wrongReferences = [...files.values()].filter((f) => !f.deleted && blobs.read(f.blob) === undefined).length
  return { events, metrics: { missingRejected, danglingReads, conflicts, conflictCopies, silentOverwrites, commitGaps, replays, deviceCrashes, crashesWithPending, bVersionConflicts, deletedWriteRejected, deletes, restores, resurrections, grants, revocations, guestAllowed, guestDeniedAfterRevoke, leaks, moved, editAttempts, previousDownloads, versionRestores, newFileDownloaded: Number(downloadCurrent && lastDownload?.file.id === 'f2' && lastDownload.body === devices.A!.edit?.content), editEffects: effects.length, duplicateEffects: effects.length - new Set(effects.map((e) => e.operation)).size, changes: changes.length, versions: history.length, fileCount: [...files.values()].filter((f) => !f.deleted).length, wrongReferences, namespaceUnique: Number(namespaceUnique), deviceACurrent: Number(visible(devices.A!.files) === visible(files)), deviceBCurrent: Number(visible(devices.B!.files) === visible(files)), downloadCurrent: Number(downloadCurrent), canonicalDownloaded: Number(downloadCurrent && lastDownload?.file.id === 'f1'), canonicalMatchesA: Number(!!devices.A!.edit && currentBody === devices.A!.edit.content), canonicalDeleted: Number(!current || current.deleted), archivePath: Number(current?.parent === 'archive' && current.name === 'report-final.txt' && !current.deleted), cursorB: devices.B!.cursor }, tables: [
    { title: '文件夹', columns: ['ID', '名字', '父目录'], rows: [...folders].map(([id, f]) => [id, f.name, f.parent]) },
    { title: '服务器文件元数据', columns: ['File ID', '路径', '版本', '对象引用', '状态'], rows: [...files.values()].map((f) => [f.id, `/${folders.get(f.parent)?.name}/${f.name}`, f.revision, f.blob, f.deleted ? '回收站 / Tombstone' : '可见']) },
    { title: '元数据版本记录（观察账本）', columns: ['File ID', '版本', '对象引用', '删除'], rows: history.map((f) => [f.id, f.revision, f.blob, f.deleted ? '是' : '否']) },
    { title: '持久变更日志', columns: ['Seq', 'File ID', '版本', '类型'], rows: changes.map((c) => [c.sequence, c.file.id, c.file.revision, c.file.deleted ? '删除' : '更新']) },
    { title: '设备同步与本地副本', columns: ['设备', 'Cursor', '未应用 Seq', '文件快照'], rows: Object.entries(devices).map(([id, d]) => [id, d.cursor, d.pending?.sequence ?? '无', [...d.files.values()].map((f) => `${f.id} v${f.revision}${f.deleted ? ' 已删除' : ''}`).join('; ')]) },
    { title: '设备保留的编辑意图', columns: ['设备', 'Operation ID', 'Base 版本', '本地内容'], rows: Object.entries(devices).flatMap(([id, d]) => d.edit ? [[id, d.edit.operationId, d.edit.baseRevision, d.edit.content]] : []) },
    { title: '可读取版本索引', columns: ['File ID', '版本', '对象引用'], rows: [...versionIndex.values()].flat().map((f) => [f.id, f.revision, f.blob]) },
    { title: '提交响应', columns: ['Operation ID', '结果', '文件 / 提交版本'], rows: responses },
    { title: '真实下载内容', columns: ['调用者', '状态/版本', '响应内容'], rows: downloads },
    { title: '内容存储节点', columns: ['节点', '状态', '对象数', '实际对象'], rows: blobs.rows() },
  ] }
}

const safe: DesignConfig = { publication: 'durable', conflict: 'reject', changefeed: 'atomic', checkpoint: 'atomic', deletion: 'tombstone', sharing: 'recheck', idempotency: 'key' }
const consistent = (r: ProductResult) => [check('文件引用与命名空间有效', r.metrics.wrongReferences === 0 && r.metrics.namespaceUnique === 1, `${r.metrics.wrongReferences} 个缺失内容引用；同一父目录下名称唯一。`), check('设备 B 收敛到当前元数据', r.metrics.deviceBCurrent === 1, '必须消费实际日志并应用文件变化，不根据服务器期望状态伪造同步。')]
export const cloudDriveDesign: ProductDesign = {
  id: 'design-cloud-drive', kind: 'product-design', category: '综合设计', difficulty: '综合', estimatedMinutes: 60, title: '云盘设计：文件、同步、冲突与分享', summary: '串起不可变内容、目录元数据、并发编辑、同步进度、离线删除、回收站和分享撤销，验证完整的有限用户流程。',
  pains: ['上传内容与发布文件条目跨越两个存储边界，半成功会产生打不开的文件。', '两台设备从同一个旧版本编辑，不能静默覆盖另一台设备的修改。', '同步通知丢失或 checkpoint 提前推进，会让设备长期停在旧状态。', '离线设备带着旧文件回来，可能复活已删除文件；旧分享链接也可能绕过撤销。'],
  requirements: ['同一账户的 A/B 两台设备、一个初始文件、docs/archive 两级目录；实际上传与下载内容。', '内容保存后才发布引用；用 baseRevision 检查并发，显式拒绝或另存冲突分支。', '元数据修改和变更日志一致；同步文件效果与 cursor 一起持久化。', '保留删除标记，支持用户显式回收站恢复；撤销分享后拒绝新的访客下载。', '支持重命名、移动、旧版本下载与恢复；每个确认的操作身份只产生一次编辑效果。'],
  contracts: [{ name: 'Upload(blobId) → Commit(fileId, baseRevision, operationId)', description: '内容不可变、元数据指针可变；Complete 重试使用同一个业务操作身份。' }, { name: 'GET /changes?after=cursor', description: '真实持久顺序日志驱动设备视图；接收消息与应用/checkpoint 可分开操作并注入崩溃。' }, { name: 'File / Folder / Tombstone / ShareGrant', description: '名字唯一性属于父目录命名空间；删除不是上传一个空文件；分享撤销由每次新下载的授权检查执行。' }],
  decisions: ['为什么“上传成功”与“文件条目可见”需要分别定义？', '版本冲突时，拒绝提交与另存副本各有什么用户体验代价？', '同步检查点应该保护什么本地效果，通知丢失后如何发现与修复？', '为何删除标记和分享撤销无法抹除用户以前已经复制的内容？'],
  boundary: ['有限学习云盘：2 台同账户设备、1 位访客、1 个初始文件及新上传文件/冲突副本、每设备最多 6 次编辑、120 步。包含目录、内容、同步、冲突、回收站和分享的联动，不是生产文件服务。', '实际内容保存在复用的两份虚拟对象副本中；版本观察账本只作证据，不用来重建已遗忘的服务器记录。', '不实现任意目录深度、跨租户 ACL、块级差量/去重、加密、配额、杀毒、大文件传输、GC 或长期日志压缩。', '元数据原子写入与本地持久存储可靠；不另行实现共识。访客下载通过受控授权入口，不能把此结论套用成任意预签名 URL 可即时撤销。', '通过场景只证明声明的小数据与故障序列。此前下载的字节不会因撤销权限而消失。'],
  relatedLabs: [{ id: 'concurrent-update', title: '条件更新与冲突' }, { id: 'transactional-outbox', title: 'Outbox 与双写' }, { id: 'ack-checkpoint', title: 'Checkpoint 与重放' }, { id: 'retry-idempotency', title: '请求重试与幂等' }],
  fields: [
    { id: 'publication', label: '文件发布边界', options: [choice('early', '先发布元数据，再等内容'), choice('durable', '确认内容存在后发布')] },
    { id: 'conflict', label: '并发编辑处理', options: [choice('overwrite', '忽略 baseVersion 直接覆盖'), choice('reject', '条件更新，明确拒绝冲突'), choice('copy', '条件更新，冲突另存副本')] },
    { id: 'changefeed', label: '元数据与同步日志', options: [choice('split', '先提交，稍后发通知'), choice('atomic', '同一提交保存变更日志')] },
    { id: 'checkpoint', label: '设备同步检查点', options: [choice('early', '收到消息即推进 cursor'), choice('atomic', '应用文件与 cursor 一起保存')] },
    { id: 'deletion', label: '删除与离线旧写', options: [choice('forget', '移除索引，忘记删除身份'), choice('tombstone', '保留删除标记与回收站')] },
    { id: 'sharing', label: '分享撤销语义', options: [choice('bearer', '永久信任已经发出的链接'), choice('recheck', '每次新下载核验当前授权')] },
    { id: 'idempotency', label: '文件提交幂等', options: [choice('append', '每次请求重新执行提交'), choice('key', '按 operationId 返回原结果')] },
  ],
  initialConfig: { publication: 'early', conflict: 'overwrite', changefeed: 'split', checkpoint: 'early', deletion: 'forget', sharing: 'bearer', idempotency: 'append' },
  metricLabels: [{ key: 'fileCount', label: '可见文件' }, { key: 'silentOverwrites', label: '静默覆盖' }, { key: 'danglingReads', label: '缺失内容读取' }, { key: 'conflicts', label: '显式冲突' }, { key: 'leaks', label: '撤销后泄露' }, { key: 'cursorB', label: '设备 B 同步进度' }],
  actions: { 'prepare-a': 'A 从本地版本准备编辑', 'prepare-new-a': 'A 准备新文件 notes.txt', 'prepare-b': 'B 从本地版本准备编辑', 'upload-a': 'A 上传不可变内容', 'upload-b': 'B 上传不可变内容', 'commit-a': 'A 提交或重试元数据', 'commit-b': 'B 提交或重试元数据', 'commit-a-gap': 'A 提交后、通知前崩溃并丢响应', 'restart-server': '恢复元数据进程', 'sync-a': 'A 拉取并应用变更', 'sync-b': 'B 拉取并应用变更', 'receive-b': 'B 只接收下一条变更', 'apply-b': 'B 应用已接收变更', 'crash-b': 'B 在应用前崩溃', 'download-b': 'B 下载其已同步文件版本', 'download-new-b': 'B 下载新文件 notes.txt', 'download-previous': 'B 下载不同内容的旧版本', 'restore-previous': '显式恢复旧版本内容', 'create-folder': '创建 archive 文件夹', 'rename-move': '重命名并移动到 archive', delete: '删除文件', restore: '从回收站显式恢复', share: '授予访客分享权限', revoke: '撤销分享权限', 'guest-get': '访客用保存的链接下载' },
  scenarios: [
    { id: 'create', title: '新文件上传与目录同步', goal: '创建独立的新文件 notes.txt，上传、发布、同步并实际下载，同时保留原文件。', script: ['prepare-new-a', 'upload-a', 'commit-a', 'sync-b', 'download-new-b'], check: (r) => [...consistent(r), check('新文件可列出并实际下载', r.metrics.fileCount === 2 && r.metrics.newFileDownloaded === 1, `${r.metrics.fileCount} 个可见文件；notes.txt 的下载必须来自新上传的真实内容。`)] },
    { id: 'publication', title: '内容与文件条目', goal: '先尝试提交尚未上传的编辑，之后上传并重试；不能让设备读到悬空引用。', script: ['prepare-a', 'commit-a', 'sync-b', 'download-b', 'upload-a', 'commit-a', 'sync-b', 'download-b'], check: (r) => [...consistent(r), check('缺失内容不会发布', r.metrics.missingRejected! > 0 && r.metrics.danglingReads === 0, `${r.metrics.missingRejected} 次拒绝，${r.metrics.danglingReads} 次悬空读取。`), check('最终下载了新内容', r.metrics.canonicalMatchesA === 1 && r.metrics.canonicalDownloaded === 1, 'B 必须实际读到 A 新上传的内容。')] },
    { id: 'concurrent', title: '两台设备并发编辑', goal: 'A/B 都从 v1 编辑，A 先提交；B 必须得到显式冲突或冲突副本，不能静默覆盖 A。', script: ['prepare-a', 'prepare-b', 'upload-a', 'upload-b', 'commit-a', 'commit-b', 'sync-a', 'sync-b', 'download-b'], check: (r) => [...consistent(r), check('两个意图已竞争', r.metrics.editAttempts! >= 2 && r.metrics.bVersionConflicts! > 0, `${r.metrics.editAttempts} 次提交尝试、${r.metrics.conflicts} 次显式冲突。`), check('保留第一次成功修改', r.metrics.silentOverwrites === 0 && r.metrics.canonicalMatchesA === 1 && r.metrics.canonicalDownloaded === 1, `${r.metrics.silentOverwrites} 次静默覆盖。拒绝或另存冲突副本都可通过。`)] },
    { id: 'gap', title: '提交中断与重试同步', goal: '元数据提交后崩溃且响应丢失，恢复后重试同一操作，再让设备从实际日志追上。', script: ['prepare-a', 'upload-a', 'commit-a-gap', 'restart-server', 'commit-a', 'sync-b', 'download-b'], check: (r) => [...consistent(r), check('中断后复用提交', r.metrics.commitGaps! > 0 && r.metrics.replays! > 0 && r.metrics.duplicateEffects === 0, `${r.metrics.commitGaps} 次中断、${r.metrics.replays} 次复用提交、${r.metrics.duplicateEffects} 个重复编辑效果。`), check('同步后新内容可读', r.metrics.canonicalMatchesA === 1 && r.metrics.canonicalDownloaded === 1, '不能用旧版本下载来证明新提交已经同步。')] },
    { id: 'checkpoint', title: '同步设备崩溃', goal: 'B 收到但尚未应用变更时崩溃，重启同步后不能跳过这次修改。', script: ['prepare-a', 'upload-a', 'commit-a', 'receive-b', 'crash-b', 'sync-b', 'download-b'], check: (r) => [...consistent(r), check('恢复未应用的变更', r.metrics.crashesWithPending! > 0 && r.metrics.canonicalMatchesA === 1 && r.metrics.canonicalDownloaded === 1, `${r.metrics.deviceCrashes} 次设备崩溃；文件效果和 cursor 必须一致。`)] },
    { id: 'offline-delete', title: '离线旧写与删除', goal: 'B 离线编辑旧文件，服务器删除后 B 再提交，不能悄悄复活原文件。', script: ['prepare-b', 'upload-b', 'delete', 'commit-b', 'sync-b'], check: (r) => [...consistent(r), check('删除没有被旧写撤销', r.metrics.deletes! > 0 && r.metrics.editAttempts! > 0 && r.metrics.canonicalDeleted === 1 && r.metrics.resurrections === 0 && r.metrics.deletedWriteRejected! > 0, `${r.metrics.resurrections} 次非显式恢复，${r.metrics.conflicts} 次拒绝旧写。`)] },
    { id: 'sharing', title: '分享链接撤销', goal: '访客先下载，再撤销权限；保留旧链接不应获得新的下载。', script: ['share', 'guest-get', 'revoke', 'guest-get'], check: (r) => [check('覆盖授权与撤销后的访问', r.metrics.grants! > 0 && r.metrics.revocations! > 0 && r.metrics.guestAllowed! > 0 && r.metrics.guestDeniedAfterRevoke! > 0, '既要成功服务授权访问，也要拒绝撤销后的新请求。'), check('没有撤销后泄露', r.metrics.leaks === 0, `${r.metrics.leaks} 次撤销后的实际内容返回。`)] },
    { id: 'lifecycle', title: '文件夹、移动与回收站', goal: '创建文件夹、移动重命名、同步下载，再删除、同步、恢复并再次下载原内容。', script: ['create-folder', 'rename-move', 'sync-b', 'download-b', 'delete', 'sync-b', 'download-b', 'restore', 'sync-b', 'download-b'], check: (r) => [...consistent(r), check('完成目录与回收站流程', r.metrics.moved! > 0 && r.metrics.deletes! > 0 && r.metrics.restores! > 0 && r.metrics.archivePath === 1, '最终文件位于 /archive/report-final.txt，用户显式恢复成功。'), check('恢复后实际下载正确', r.metrics.canonicalDownloaded === 1 && r.metrics.danglingReads === 0, '移动和恢复只修改元数据，仍读取保存的真实内容。')] },
    { id: 'versions', title: '文件版本与内容恢复', goal: '提交新内容后实际下载旧版本，再显式恢复旧内容，并同步到设备。', script: ['prepare-a', 'upload-a', 'commit-a', 'sync-b', 'download-b', 'download-previous', 'restore-previous', 'sync-b', 'download-b'], check: (r) => [...consistent(r), check('实际读取并恢复旧版本', r.metrics.previousDownloads! > 0 && r.metrics.versionRestores! > 0 && r.metrics.canonicalDownloaded === 1, `${r.metrics.previousDownloads} 次历史下载、${r.metrics.versionRestores} 次显式恢复；最终读取必须匹配恢复后的新版本。`)] },
  ],
  alternatives: [{ title: '条件提交，冲突明确拒绝', config: safe }, { title: '条件提交，冲突另存副本', config: { ...safe, conflict: 'copy' } }],
  architecture: (c) => ['设备编辑 → 不可变内容上传 → 对象副本', `Commit API → ${c.conflict === 'overwrite' ? '覆盖文件指针' : 'baseRevision 条件提交'} → ${c.changefeed === 'atomic' ? '元数据 + 持久变更日志' : '稍后通知'}`, `设备同步 → ${c.checkpoint === 'atomic' ? '文件与 cursor 同时保存' : '提前保存 cursor'} → 版本下载`, `删除/分享 API → ${c.deletion === 'tombstone' ? '删除身份与回收站' : '移除索引'} / ${c.sharing === 'recheck' ? '当前权限校验' : '永久旧链接'}`],
  run: runCloudDrive,
}
