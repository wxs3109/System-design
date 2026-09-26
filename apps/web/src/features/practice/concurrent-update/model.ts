import type { TimelineEvent } from '../protocol/events'

export type WorkerId = 'A' | 'B'
export type Strategy = 'read-write' | 'cas' | 'row-lock'
export const strategyLabels: Record<Strategy, string> = { 'read-write': '先读后写，不检查版本', cas: '版本 CAS，冲突后重读', 'row-lock': '行锁覆盖读取到提交' }
export interface Config { modelVersion: 'concurrent-update-v1'; strategy: Strategy; idempotent: boolean; capacity: number }
export interface Worker { id: WorkerId; status: 'idle' | 'ready' | 'waiting' | 'conflict' | 'sold-out' | 'committed' | 'crashed' | 'aborted'; snapshot: { remaining: number; version: number } | null; reads: number; conflicts: number }
export interface Reservation { id: string; intent: WorkerId; before: number; after: number; version: number }
export interface State { remaining: number; version: number; workers: Worker[]; reservations: Reservation[]; lock: WorkerId | null; waiting: WorkerId[]; events: TimelineEvent[] }
export type Command = { type: 'read' | 'commit' | 'abort' | 'crash' | 'restart'; worker: WorkerId }
export const MAX_COMMANDS = 60
export const defaultConfig = (): Config => ({ modelVersion: 'concurrent-update-v1', strategy: 'read-write', idempotent: false, capacity: 1 })
export const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
export function parseConfig(value: unknown): Config {
  const c = value as Config | null
  if (!c || c.modelVersion !== 'concurrent-update-v1' || !Object.hasOwn(strategyLabels, c.strategy) || typeof c.idempotent !== 'boolean' || ![1, 2, 3].includes(c.capacity)) throw new Error('并发模型版本或配置无效。')
  return { modelVersion: c.modelVersion, strategy: c.strategy, idempotent: c.idempotent, capacity: c.capacity }
}
export function parseCommand(value: unknown): Command {
  const c = value as Command | null
  if (!c || !['read', 'commit', 'abort', 'crash', 'restart'].includes(c.type) || !['A', 'B'].includes(c.worker)) throw new Error('并发操作无效。')
  return { type: c.type, worker: c.worker }
}
function event(s: State, kind: string, from: string, to: string, detail: string, subject: string | null = null) {
  // This model schedules logical operations, not service time. Event order carries the interleaving.
  s.events.push({ index: s.events.length + 1, at: 0, kind, from, to, detail, subject })
}
function unlock(s: State, owner: WorkerId) {
  s.waiting = s.waiting.filter((id) => id !== owner)
  if (s.lock !== owner) return
  s.lock = null
  event(s, 'unlock', 'store', owner, '事务结束，数据库释放行锁。', owner)
  const next = s.waiting.shift()
  if (next) {
    s.lock = next
    s.workers.find((w) => w.id === next)!.status = 'idle'
    event(s, 'lock-granted', 'store', next, '等待者获得行锁，需要读取当前值，不能使用等待前的旧快照。', next)
  }
}
function apply(s: State, c: Config, command: Command) {
  const w = s.workers.find((worker) => worker.id === command.worker)!
  if (command.type === 'crash') {
    if (w.status === 'crashed') throw new Error('该任务进程已崩溃。')
    w.status = 'crashed'; w.snapshot = null; unlock(s, w.id)
    event(s, 'crashed', w.id, 'store', '客户端崩溃；本模型假定数据库已确认会话结束，未提交事务中止并释放锁。已提交预订保留。', w.id)
    return
  }
  if (command.type === 'restart') {
    if (w.status !== 'crashed') throw new Error('只有崩溃的任务需要重启。')
    w.status = 'idle'; w.snapshot = null
    event(s, 'restarted', w.id, w.id, '任务重启，以原业务意图重读；不能依赖崩溃前的内存。', w.id)
    return
  }
  if (w.status === 'crashed') throw new Error('任务已离线，请先重启。')
  if (command.type === 'abort') {
    if (!['ready', 'waiting', 'idle', 'conflict'].includes(w.status)) throw new Error('当前没有可中止的事务。')
    w.status = 'aborted'; w.snapshot = null; unlock(s, w.id)
    event(s, 'aborted', w.id, 'store', '主动中止未提交的事务，释放锁；已提交的预订没有撤销。', w.id)
    return
  }
  if (command.type === 'read') {
    if (w.status === 'waiting') throw new Error('行锁仍由另一事务持有。')
    if (c.idempotent && s.reservations.some((r) => r.intent === w.id)) {
      w.status = 'committed'; w.snapshot = null; unlock(s, w.id)
      event(s, 'dedupe', 'store', w.id, '相同业务意图已提交，重放原预订；另一个任务使用不同意图，不能因此被去重。', w.id)
      return
    }
    if (c.strategy === 'row-lock') {
      if (s.lock && s.lock !== w.id) {
        w.status = 'waiting'; w.snapshot = null
        if (!s.waiting.includes(w.id)) s.waiting.push(w.id)
        event(s, 'lock-wait', w.id, 'store', `等待 ${s.lock} 结束事务，尚未读取库存。`, w.id)
        return
      }
      if (!s.lock) { s.lock = w.id; event(s, 'lock-granted', 'store', w.id, '获得库存行锁，持有到提交或中止。', w.id) }
    }
    w.snapshot = { remaining: s.remaining, version: s.version }; w.status = 'ready'; w.reads++
    event(s, 'read', 'store', w.id, `读取剩余 ${s.remaining}，版本 ${s.version}；这只是本次事务的观察。`, w.id)
    return
  }
  if (w.status !== 'ready' || !w.snapshot) throw new Error('提交前需要读取库存。')
  if (c.strategy === 'row-lock' && s.lock !== w.id) throw new Error('提交需要持有行锁。')
  if (c.idempotent && s.reservations.some((r) => r.intent === w.id)) {
    w.status = 'committed'; w.snapshot = null; unlock(s, w.id)
    event(s, 'dedupe', 'store', w.id, '在原子提交边界内检查到同一意图已存在，返回原结果。', w.id)
    return
  }
  if (c.strategy === 'cas' && w.snapshot.version !== s.version) {
    w.status = 'conflict'; w.conflicts++; w.snapshot = null
    event(s, 'conflict', 'store', w.id, '版本已变化，整个提交拒绝；没有扣库存或新增预订。需要重读后再判断。', w.id)
    return
  }
  if (w.snapshot.remaining <= 0) {
    w.status = 'sold-out'; w.snapshot = null; unlock(s, w.id)
    event(s, 'sold-out', 'store', w.id, '读取到没有剩余名额，业务拒绝本次预订。', w.id)
    return
  }
  if (s.reservations.length >= 12) throw new Error('已达到预订记录预算。')
  const before = s.remaining
  s.remaining = w.snapshot.remaining - 1; s.version++
  const reservation = { id: `reservation-${s.reservations.length + 1}`, intent: w.id, before, after: s.remaining, version: s.version }
  // Every strategy commits the counter and ledger atomically; the unsafe strategy lacks isolation.
  s.reservations.push(reservation); w.status = 'committed'; w.snapshot = null
  event(s, 'committed', w.id, 'store', `一起提交库存 ${before} → ${s.remaining} 与 ${reservation.id}。当前有 ${s.reservations.length} 份预订。`, w.id)
  unlock(s, w.id)
}
export function runModel(value: Config, commands: readonly Command[]): State {
  const c = parseConfig(value)
  if (!Array.isArray(commands) || commands.length > MAX_COMMANDS) throw new Error('并发命令预算超限。')
  const s: State = { remaining: c.capacity, version: 0, workers: (['A', 'B'] as const).map((id) => ({ id, status: 'idle', snapshot: null, reads: 0, conflicts: 0 })), reservations: [], lock: null, waiting: [], events: [] }
  Array.from(commands).forEach((raw, index) => { try { apply(s, c, parseCommand(raw)) } catch (e) { throw new Error(`第 ${index + 1} 步：${e instanceof Error ? e.message : '操作无效。'}`) } })
  return s
}
