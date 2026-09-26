import type { TimelineEvent } from '../protocol/events'
export type ParticipantId = 'A' | 'B'
export type ActorId = ParticipantId | 'coordinator'
export type Decision = 'commit' | 'abort'
export interface Config { modelVersion: 'two-phase-commit-v1'; timeoutPolicy: 'wait' | 'abort'; timeoutMs: number; rejectB: boolean }
export interface Participant { id: ParticipantId; online: boolean; phase: 'initial' | 'prepared' | 'committed' | 'aborted'; balance: number; vote: 'yes' | 'no' | null; timeoutAt: number | null; effects: number }
export interface Message { id: string; type: 'prepare' | 'vote' | 'decision' | 'ack'; from: ActorId; to: ActorId; vote: 'yes' | 'no' | null; decision: Decision | null; status: 'network' | 'delivered' | 'dropped' }
export interface State { now: number; started: boolean; coordinatorOnline: boolean; decision: Decision | null; votes: Partial<Record<ParticipantId, 'yes' | 'no'>>; acknowledgements: ParticipantId[]; clientOutcome: Decision | null; participants: Participant[]; messages: Message[]; events: TimelineEvent[]; conflicts: number }
export type Command = { type: 'begin' | 'prepare' | 'decide' | 'broadcast' | 'abort' } | { type: 'advance'; ms: number } | { type: 'deliver' | 'drop'; messageId: string } | { type: 'crash' | 'restart'; actor: ActorId }
export const MAX_COMMANDS = 120
export const defaultConfig = (): Config => ({ modelVersion: 'two-phase-commit-v1', timeoutPolicy: 'wait', timeoutMs: 500, rejectB: false })
export function parseConfig(value: unknown): Config { const c = value as Config | null; if (!c || c.modelVersion !== 'two-phase-commit-v1' || !['wait', 'abort'].includes(c.timeoutPolicy) || ![100, 500, 1000].includes(c.timeoutMs) || typeof c.rejectB !== 'boolean') throw new Error('2PC 配置无效。'); return { modelVersion: c.modelVersion, timeoutPolicy: c.timeoutPolicy, timeoutMs: c.timeoutMs, rejectB: c.rejectB } }
export function parseCommand(value: unknown): Command {
  const c = value as Command | null; if (!c) throw new Error('2PC 操作无效。')
  if (c.type === 'advance') { if (!Number.isInteger(c.ms) || c.ms < 1 || c.ms > 10000) throw new Error('推进时间无效。'); return { type: c.type, ms: c.ms } }
  if (c.type === 'deliver' || c.type === 'drop') { if (!/^message-\d+$/.test(c.messageId)) throw new Error('消息无效。'); return { type: c.type, messageId: c.messageId } }
  if (c.type === 'crash' || c.type === 'restart') { if (!['A', 'B', 'coordinator'].includes(c.actor)) throw new Error('参与者无效。'); return { type: c.type, actor: c.actor } }
  if (!['begin', 'prepare', 'decide', 'broadcast', 'abort'].includes(c.type)) throw new Error('未知 2PC 操作。')
  return { type: c.type }
}
function event(s: State, kind: string, from: string, to: string, detail: string, subject: string | null = null) { s.events.push({ index: s.events.length + 1, at: s.now, kind, from, to, detail, subject }) }
function send(s: State, type: Message['type'], from: ActorId, to: ActorId, vote: Message['vote'] = null, decision: Decision | null = null) { if (s.messages.length >= 80) throw new Error('消息预算耗尽。'); const id = `message-${s.messages.length + 1}`; s.messages.push({ id, type, from, to, vote, decision, status: 'network' }); event(s, 'sent', from, to, `${id} ${type} ${vote ?? decision ?? ''}`, id) }
const online = (s: State, id: ActorId) => id === 'coordinator' ? s.coordinatorOnline : s.participants.find((p) => p.id === id)!.online
export const canDeliver = (s: State, m: Message) => m.status === 'network' && online(s, m.to)
function logDecision(s: State, decision: Decision) { if (s.decision !== null) throw new Error('持久决议不能更改。'); s.decision = decision; event(s, 'decision-logged', 'coordinator', 'coordinator', `先持久记录 ${decision}；随后才能向参与者发送。`, decision) }
function apply(s: State, c: Config, command: Command) {
  if (command.type === 'advance') {
    if (s.now + command.ms > 10000) throw new Error('超过实验时间范围。')
    const target = s.now + command.ms
    for (const p of s.participants.filter((p) => p.online && p.phase === 'prepared' && p.timeoutAt !== null && p.timeoutAt <= target).sort((a, b) => a.timeoutAt! - b.timeoutAt!)) {
      s.now = p.timeoutAt!; p.timeoutAt = null
      if (c.timeoutPolicy === 'wait') event(s, 'blocked', p.id, p.id, '已经持久投 YES，超时不能推断全局决议。保留准备记录和锁，等待协调者恢复。', p.id)
      else { p.phase = 'aborted'; event(s, 'heuristic-abort', p.id, p.id, '危险策略：准备后超时自行中止，违背等待最终决议的承诺。协调者可能已经持久提交。', p.id) }
    }
    s.now = target; event(s, 'clock', 'coordinator', 'coordinator', `推进到 ${s.now} ms。`); return
  }
  if (command.type === 'crash' || command.type === 'restart') {
    const active = command.type === 'restart'
    if (command.actor === 'coordinator') { s.coordinatorOnline = active; s.votes = {}; s.acknowledgements = [] }
    else { const p = s.participants.find((p) => p.id === command.actor)!; p.online = active; if (active && p.phase === 'prepared') p.timeoutAt = s.now + c.timeoutMs }
    event(s, command.type, command.actor, command.actor, `${active ? '恢复' : '崩溃'}：持久决议、准备记录及已提交效果保留；在途消息不撤回。`, command.actor); return
  }
  if ('messageId' in command) {
    const m = s.messages.find((m) => m.id === command.messageId)
    if (!m || m.status !== 'network') throw new Error('消息不在网络中。')
    if (command.type === 'drop') { m.status = 'dropped'; event(s, 'dropped', m.from, m.to, '消息丢失，持久状态不回滚。', m.id); return }
    if (!canDeliver(s, m)) throw new Error('接收方离线。')
    m.status = 'delivered'
    if (m.type === 'prepare') {
      const p = s.participants.find((p) => p.id === m.to)!
      if (p.phase === 'initial') {
        if (p.id === 'B' && c.rejectB) { p.vote = 'no'; p.phase = 'aborted'; event(s, 'vote-no', p.id, p.id, '本地约束拒绝准备，持久中止，不修改业务余额。', p.id) }
        else { p.vote = 'yes'; p.phase = 'prepared'; p.timeoutAt = s.now + c.timeoutMs; event(s, 'prepared', p.id, p.id, '持久保存本地写意图并持有资源锁，然后投 YES；还没有提交余额。', p.id) }
      }
      send(s, 'vote', p.id, 'coordinator', p.phase === 'aborted' ? 'no' : 'yes'); return
    }
    if (m.type === 'vote') { if (!s.decision) s.votes[m.from as ParticipantId] = m.vote!; event(s, 'vote-received', m.from, 'coordinator', `收到 ${m.from} 的 ${m.vote}；同一参与者不重复计票。`, m.from); return }
    if (m.type === 'decision') {
      const p = s.participants.find((p) => p.id === m.to)!
      const desired = m.decision === 'commit' ? 'committed' : 'aborted'
      if (p.phase === 'committed' && desired === 'aborted' || p.phase === 'aborted' && desired === 'committed' || desired === 'committed' && p.phase === 'initial') { s.conflicts++; event(s, 'decision-conflict', 'coordinator', p.id, `全局 ${m.decision} 与本地 ${p.phase} 冲突；不能伪造回滚或自动改写终态。`, p.id); return }
      if (p.phase !== desired) { if (desired === 'committed') { p.balance += p.id === 'A' ? -2 : 2; p.effects++ }; p.phase = desired; p.timeoutAt = null; event(s, 'applied', p.id, p.id, `持久应用 ${m.decision}，余额 ${p.balance}，资源锁释放。`, p.id) }
      else event(s, 'decision-replay', p.id, p.id, '重复决议不重复修改业务余额。', p.id)
      send(s, 'ack', p.id, 'coordinator', null, m.decision); return
    }
    if (m.decision === s.decision && !s.acknowledgements.includes(m.from as ParticipantId)) s.acknowledgements.push(m.from as ParticipantId)
    if (s.acknowledgements.length === 2) { s.clientOutcome = s.decision; event(s, 'client-result', 'coordinator', 'client', `两个参与者均确认 ${s.decision}，客户端获知最终结果。`, s.decision) }
    return
  }
  if (!s.coordinatorOnline) throw new Error('协调者离线。')
  if (command.type === 'begin') { if (s.started) throw new Error('本实验只包含 txn-1。'); s.started = true; event(s, 'begun', 'coordinator', 'coordinator', '持久登记 txn-1：A 向 B 转移 2 个符号单位。'); send(s, 'prepare', 'coordinator', 'A'); send(s, 'prepare', 'coordinator', 'B'); return }
  if (!s.started) throw new Error('请先创建事务。')
  if (command.type === 'prepare') { if (s.decision) throw new Error('已有持久决议，应重发决议。'); send(s, 'prepare', 'coordinator', 'A'); send(s, 'prepare', 'coordinator', 'B'); return }
  if (command.type === 'abort') { logDecision(s, 'abort'); return }
  if (command.type === 'decide') {
    if (s.votes.A === 'no' || s.votes.B === 'no') logDecision(s, 'abort')
    else if (s.votes.A === 'yes' && s.votes.B === 'yes') logDecision(s, 'commit')
    else throw new Error('缺少所有参与者的 YES，不能提交；也可以选择全局中止。')
    return
  }
  if (!s.decision) throw new Error('先持久记录决议。')
  send(s, 'decision', 'coordinator', 'A', null, s.decision); send(s, 'decision', 'coordinator', 'B', null, s.decision)
}
export function runModel(value: Config, commands: readonly Command[]): State {
  const c = parseConfig(value); if (!Array.isArray(commands) || commands.length > MAX_COMMANDS) throw new Error('2PC 操作预算超限。')
  const s: State = { now: 0, started: false, coordinatorOnline: true, decision: null, votes: {}, acknowledgements: [], clientOutcome: null, participants: (['A', 'B'] as const).map((id) => ({ id, online: true, phase: 'initial', balance: 5, vote: null, timeoutAt: null, effects: 0 })), messages: [], events: [], conflicts: 0 }
  Array.from(commands).forEach((raw, i) => { try { apply(s, c, parseCommand(raw)) } catch (e) { throw new Error(`第 ${i + 1} 步：${e instanceof Error ? e.message : '操作无效。'}`) } }); return s
}
