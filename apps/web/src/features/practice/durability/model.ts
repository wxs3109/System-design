import type { TimelineEvent } from '../protocol/events'
export interface Config { modelVersion: 'durability-v1'; acknowledgement: 'memory' | 'wal' }
export interface LogRecord { lsn: number; transaction: string; kind: 'update' | 'commit'; delta: number; durable: boolean; intact: boolean }
export interface Snapshot { value: number; through: number; transactions: string[] }
export interface Archive { id: string; records: LogRecord[] }
export interface Recovery { source: 'wal' | 'archive'; records: LogRecord[]; position: number; target: number; pending: Record<string, number>; base: Snapshot }
export interface State {
  phase: 'online' | 'offline' | 'recovering' | 'blocked'; value: number | null; disk: Snapshot | null; wal: LogRecord[]; applied: string[]; appliedThrough: number
  active: { id: string; delta: number; updateLsn: number | null; commitLsn: number | null; applied: boolean } | null
  intentions: { id: string; delta: number }[]; acknowledgements: { transaction: string; lsn: number }[]
  backups: { id: string; snapshot: Snapshot }[]; archives: Archive[]; recovery: Recovery | null; restoredTarget: number | null; error: string; events: TimelineEvent[]
}
export type Command = { type: 'begin'; delta: number } | { type: 'append-update' | 'append-commit' | 'flush-wal' | 'apply' | 'ack' | 'checkpoint' | 'backup' | 'archive' | 'crash' | 'restart' | 'replay' | 'lose-disk' } | { type: 'restore'; backup: string; archive: string; target: number } | { type: 'corrupt' | 'remove'; archive: string; lsn: number }
export const MAX_COMMANDS = 120
export const defaultConfig = (): Config => ({ modelVersion: 'durability-v1', acknowledgement: 'memory' })
export function parseConfig(value: unknown): Config { const c = value as Config | null; if (!c || c.modelVersion !== 'durability-v1' || !['memory', 'wal'].includes(c.acknowledgement)) throw new Error('持久恢复配置无效。'); return { modelVersion: c.modelVersion, acknowledgement: c.acknowledgement } }
export function parseCommand(value: unknown): Command {
  const c = value as Command | null; if (!c) throw new Error('恢复操作无效。')
  if (c.type === 'begin') { if (![1, 2, 3].includes(c.delta)) throw new Error('增量无效。'); return { type: c.type, delta: c.delta } }
  if (c.type === 'restore') { if (!/^backup-[12]$/.test(c.backup) || !/^archive-[12]$/.test(c.archive) || !Number.isInteger(c.target) || c.target < 0 || c.target > 8) throw new Error('恢复来源或目标无效。'); return { type: c.type, backup: c.backup, archive: c.archive, target: c.target } }
  if (c.type === 'corrupt' || c.type === 'remove') { if (!/^archive-[12]$/.test(c.archive) || !Number.isInteger(c.lsn) || c.lsn < 1 || c.lsn > 8) throw new Error('归档记录无效。'); return { type: c.type, archive: c.archive, lsn: c.lsn } }
  if (!['append-update', 'append-commit', 'flush-wal', 'apply', 'ack', 'checkpoint', 'backup', 'archive', 'crash', 'restart', 'replay', 'lose-disk'].includes(c.type)) throw new Error('未知持久恢复操作。')
  return { type: c.type }
}
const initialSnapshot = (): Snapshot => ({ value: 0, through: 0, transactions: [] })
function event(s: State, kind: string, from: string, to: string, detail: string, subject: string | null = null) { s.events.push({ index: s.events.length + 1, at: s.events.length + 1, kind, from, to, detail, subject }) }
function block(s: State, reason: string) { s.phase = 'blocked'; s.error = reason; s.value = null; s.recovery = null; event(s, 'recovery-blocked', 'wal', 'memory', reason) }
function finishRecovery(s: State) {
  s.phase = 'online'; s.error = ''
  if (s.recovery?.source === 'archive') {
    s.disk = { value: s.value!, through: s.recovery.target, transactions: [...s.applied] }
    s.wal = structuredClone(s.recovery.records)
  }
  if (s.recovery && Object.keys(s.recovery.pending).length) event(s, 'uncommitted-skipped', 'wal', 'memory', '日志中只有 update 而没有 commit 的事务不应用。')
  event(s, 'recovery-complete', 'wal', 'memory', `恢复完成，值 ${s.value}，已恢复事务 ${s.applied.join(', ') || '无'}。`)
}
function recover(s: State, base: Snapshot, records: LogRecord[], target: number, source: Recovery['source']) {
  s.error = ''; s.active = null
  if (target < base.through) { block(s, '目标早于快照，不能用较新的快照倒推过去。'); return }
  const replay = records.filter((record) => record.lsn > base.through && record.lsn <= target).sort((a, b) => a.lsn - b.lsn)
  for (let lsn = base.through + 1; lsn <= target; lsn++) {
    const found = replay.filter((record) => record.lsn === lsn)
    if (found.length !== 1 || !found[0]!.intact || !found[0]!.durable) { block(s, `恢复范围在 LSN ${lsn} 缺失、损坏或未持久化；不能跳过后声称成功。`); return }
  }
  if (source === 'archive' && target > base.through && replay.at(-1)?.kind !== 'commit') { block(s, '指定时点恢复必须选择完整提交边界，不能停在事务中间。'); return }
  s.value = base.value; s.applied = [...base.transactions]; s.appliedThrough = base.through; s.phase = 'recovering'
  s.recovery = { source, base: structuredClone(base), records: structuredClone(replay), position: 0, target, pending: {} }
  event(s, 'recovery-started', source === 'archive' ? 'backup' : 'disk', 'memory', `从快照值 ${base.value} / LSN ${base.through} 开始，仅重放到 LSN ${target}。`)
  if (!replay.length) finishRecovery(s)
}
function apply(s: State, c: Config, command: Command) {
  if (command.type === 'corrupt' || command.type === 'remove') {
    const a = s.archives.find((a) => a.id === command.archive); const record = a?.records.find((r) => r.lsn === command.lsn)
    if (!a || !record) throw new Error('指定归档记录不存在。')
    if (command.type === 'corrupt') record.intact = false; else a.records = a.records.filter((r) => r !== record)
    event(s, command.type, 'backup', 'backup', `${a.id} LSN ${command.lsn} ${command.type === 'corrupt' ? '完整性检查失败' : '丢失'}；另一份归档不受影响。`); return
  }
  if (command.type === 'crash' || command.type === 'lose-disk') {
    s.phase = 'offline'; s.value = null; s.active = null; s.applied = []; s.appliedThrough = 0; s.recovery = null; s.error = ''
    s.wal = command.type === 'crash' ? s.wal.filter((r) => r.durable) : []
    if (command.type === 'lose-disk') s.disk = null
    event(s, command.type, 'memory', 'disk', command.type === 'crash' ? '进程内存和未刷盘 WAL 丢失，磁盘快照与稳定 WAL 保留。' : '模拟本地磁盘丢失；只有独立备份和归档仍存在。'); return
  }
  if (command.type === 'restart') {
    if (s.phase === 'online' || s.phase === 'recovering') throw new Error('进程尚未停止。')
    if (!s.disk) { block(s, '本地数据盘已丢失，需要选择外部备份和归档恢复。'); return }
    recover(s, s.disk, s.wal.filter((r) => r.durable), Math.max(s.disk.through, ...s.wal.filter((r) => r.durable).map((r) => r.lsn)), 'wal'); return
  }
  if (command.type === 'restore') {
    if (s.phase === 'online' || s.phase === 'recovering') throw new Error('先停止进程或模拟磁盘丢失再恢复。')
    const backup = s.backups.find((b) => b.id === command.backup); const archive = s.archives.find((a) => a.id === command.archive)
    if (!backup || !archive) throw new Error('恢复来源不存在。')
    s.restoredTarget = command.target; recover(s, backup.snapshot, archive.records, command.target, 'archive'); return
  }
  if (command.type === 'replay') {
    if (s.phase !== 'recovering' || !s.recovery) throw new Error('当前没有待重放的恢复记录。')
    const recovery = s.recovery; const r = recovery.records[recovery.position++]!
    if (r.kind === 'update') { recovery.pending[r.transaction] = r.delta; event(s, 'redo-buffered', 'wal', 'memory', `读取 ${r.transaction} 的 update，尚无 commit，不应用。`, String(r.lsn)) }
    else {
      const delta = recovery.pending[r.transaction]
      if (delta === undefined) { block(s, `LSN ${r.lsn} 的 commit 缺少对应 update，恢复不能继续。`); return }
      if (!s.applied.includes(r.transaction)) { s.value! += delta; s.applied.push(r.transaction); event(s, 'redone', 'wal', 'memory', `重放已提交 ${r.transaction}，增量 ${delta}，值为 ${s.value}。`, String(r.lsn)) }
      s.appliedThrough = r.lsn; delete recovery.pending[r.transaction]
    }
    if (recovery.position === recovery.records.length) finishRecovery(s)
    return
  }
  if (s.phase !== 'online') throw new Error('服务尚未完成恢复。')
  if (s.restoredTarget !== null) throw new Error('本题的指定时点恢复结果只读；新时间线的写入请重开实验。')
  if (command.type === 'begin') {
    if (s.active) throw new Error('先完成当前事务。'); if (s.intentions.length >= 4) throw new Error('最多四个事务意图。')
    const id = `txn-${s.intentions.length + 1}`; s.intentions.push({ id, delta: command.delta }); s.active = { id, delta: command.delta, updateLsn: null, commitLsn: null, applied: false }
    event(s, 'begun', 'client', 'memory', `${id} 增加 ${command.delta}，还未写入 WAL。`, id); return
  }
  if (command.type === 'flush-wal') { for (const record of s.wal) record.durable = true; event(s, 'wal-flushed', 'memory', 'wal', `WAL 前缀已刷盘至 LSN ${s.wal.at(-1)?.lsn ?? 0}。`); return }
  if (command.type === 'checkpoint') {
    if (s.wal.some((r) => r.lsn <= s.appliedThrough && !r.durable)) throw new Error('WAL 尚未刷盘到数据页对应的提交边界，不能先持久化数据页。')
    s.disk = { value: s.value!, through: s.appliedThrough, transactions: [...s.applied] }; event(s, 'checkpoint', 'memory', 'disk', `原子安装检查点，值 ${s.value}，恢复起点 LSN ${s.appliedThrough}。`); return
  }
  if (command.type === 'backup') { if (!s.disk || s.backups.length >= 2) throw new Error('没有磁盘快照或已经有两份备份。'); const id = `backup-${s.backups.length + 1}`; s.backups.push({ id, snapshot: structuredClone(s.disk) }); event(s, 'backup', 'disk', 'backup', `${id} 捕获磁盘检查点，不会自动捕获更晚的内存值。`, id); return }
  if (command.type === 'archive') { if (s.archives.length >= 2) throw new Error('最多两份独立归档。'); const id = `archive-${s.archives.length + 1}`; s.archives.push({ id, records: structuredClone(s.wal.filter((r) => r.durable)) }); event(s, 'archive', 'wal', 'backup', `${id} 复制已经刷盘的 WAL，未刷盘记录不在归档内。`, id); return }
  const active = s.active; if (!active) throw new Error('请先开始事务。')
  if (command.type === 'append-update' || command.type === 'append-commit') {
    if (command.type === 'append-update' ? active.updateLsn !== null : active.updateLsn === null || active.commitLsn !== null) throw new Error('WAL 记录顺序无效。')
    const lsn = (s.wal.at(-1)?.lsn ?? s.disk?.through ?? 0) + 1
    s.wal.push({ lsn, transaction: active.id, kind: command.type === 'append-update' ? 'update' : 'commit', delta: command.type === 'append-update' ? active.delta : 0, durable: false, intact: true })
    if (command.type === 'append-update') active.updateLsn = lsn; else active.commitLsn = lsn
    event(s, 'wal-appended', 'memory', 'memory', `LSN ${lsn} ${command.type} 仍在易失 WAL 缓冲中。`, active.id); return
  }
  if (command.type === 'apply') {
    if (active.commitLsn === null || active.applied) throw new Error('需要未应用的 commit 记录。')
    s.value! += active.delta; s.applied.push(active.id); s.appliedThrough = active.commitLsn; active.applied = true
    event(s, 'memory-applied', 'memory', 'memory', `内存值更新为 ${s.value}；不等于磁盘已经保留。`, active.id); return
  }
  if (!active.applied || active.commitLsn === null) throw new Error('确认前需要完成本地提交并应用。')
  if (c.acknowledgement === 'wal' && !s.wal.find((r) => r.lsn === active.commitLsn)?.durable) throw new Error('提交 WAL 未刷盘，不能返回持久成功。')
  s.acknowledgements.push({ transaction: active.id, lsn: active.commitLsn }); event(s, 'acknowledged', 'memory', 'client', `客户端收到 ${active.id} 成功。确认事实保留，恢复不能假装它没发生。`, active.id); s.active = null
}
export function runModel(value: Config, commands: readonly Command[]): State {
  const c = parseConfig(value); if (!Array.isArray(commands) || commands.length > MAX_COMMANDS) throw new Error('恢复操作预算超限。')
  const s: State = { phase: 'online', value: 0, disk: initialSnapshot(), wal: [], applied: [], appliedThrough: 0, active: null, intentions: [], acknowledgements: [], backups: [], archives: [], recovery: null, restoredTarget: null, error: '', events: [] }
  Array.from(commands).forEach((raw, i) => { try { apply(s, c, parseCommand(raw)) } catch (e) { throw new Error(`第 ${i + 1} 步：${e instanceof Error ? e.message : '操作无效。'}`) } }); return s
}
