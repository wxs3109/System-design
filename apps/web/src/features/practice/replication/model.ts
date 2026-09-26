import type { TimelineEvent } from '../protocol/events'
import type { RegisterOperation } from './history'
export type NodeId = 'A' | 'B' | 'C'
export type ClientId = 'X' | 'Y'
export interface Tag { counter: number; writer: string }
export interface Version { tag: Tag; value: string }
export const nodes: readonly NodeId[] = ['A', 'B', 'C']
export const compareTag = (a: Tag, b: Tag) => a.counter - b.counter || (a.writer < b.writer ? -1 : a.writer > b.writer ? 1 : 0)
export const tagLabel = (t: Tag) => `${t.counter}:${t.writer || 'initial'}`
export interface Config { modelVersion: 'replicated-register-v1'; mode: 'primary' | 'quorum'; writeQuorum: number; readQuorum: number; readPolicy: 'any' | 'session' | 'primary'; repair: boolean }
export interface Replica { id: NodeId; online: boolean; isolated: boolean; current: Version; seen: Version[] }
export interface Client { id: ClientId; clock: number; minimum: Tag }
export interface Operation extends RegisterOperation { client: ClientId; target: NodeId; tag: Tag | null; confirmations: NodeId[]; replies: { node: NodeId; version: Version }[] }
export interface Message { id: string; type: 'put' | 'replicate' | 'ack' | 'get' | 'reply' | 'repair'; from: string; to: string; operationId: string; version: Version | null; minimum: Tag; status: 'network' | 'held' | 'delivered' | 'dropped' }
export interface State { step: number; replicas: Replica[]; clients: Client[]; operations: Operation[]; messages: Message[]; events: TimelineEvent[] }
export type Command = { type: 'write'; client: ClientId; value: string } | { type: 'read'; client: ClientId; target: NodeId } | { type: 'deliver' | 'drop'; messageId: string } | { type: 'crash' | 'restart' | 'isolate' | 'heal'; node: NodeId }
export const MAX_COMMANDS = 150
export const defaultConfig = (mode: Config['mode'] = 'primary'): Config => ({ modelVersion: 'replicated-register-v1', mode, writeQuorum: mode === 'primary' ? 1 : 2, readQuorum: 2, readPolicy: 'any', repair: false })
export function parseConfig(value: unknown): Config {
  const c = value as Config | null
  if (!c || c.modelVersion !== 'replicated-register-v1' || !['primary', 'quorum'].includes(c.mode) || ![1, 2, 3].includes(c.writeQuorum) || ![1, 2, 3].includes(c.readQuorum) || !['any', 'session', 'primary'].includes(c.readPolicy) || typeof c.repair !== 'boolean') throw new Error('复制模型配置无效。')
  return { modelVersion: c.modelVersion, mode: c.mode, writeQuorum: c.writeQuorum, readQuorum: c.readQuorum, readPolicy: c.readPolicy, repair: c.repair }
}
export function parseCommand(value: unknown): Command {
  const c = value as Command | null
  if (!c) throw new Error('复制操作无效。')
  if (c.type === 'write') { if (!['X', 'Y'].includes(c.client) || typeof c.value !== 'string' || !/^[a-zA-Z0-9_-]{1,30}$/.test(c.value) || c.value === 'initial') throw new Error('写入值或客户端无效。'); return { type: c.type, client: c.client, value: c.value } }
  if (c.type === 'read') { if (!['X', 'Y'].includes(c.client) || !nodes.includes(c.target)) throw new Error('读取目标无效。'); return { type: c.type, client: c.client, target: c.target } }
  if (c.type === 'deliver' || c.type === 'drop') { if (!/^message-\d+$/.test(c.messageId)) throw new Error('消息 ID 无效。'); return { type: c.type, messageId: c.messageId } }
  if (!['crash', 'restart', 'isolate', 'heal'].includes(c.type) || !('node' in c) || !nodes.includes(c.node)) throw new Error('复制节点操作无效。')
  return { type: c.type, node: c.node }
}
const zero = (): Version => ({ tag: { counter: 0, writer: '' }, value: 'initial' })
function event(s: State, kind: string, from: string, to: string, detail: string, subject: string | null = null) { s.events.push({ index: s.events.length + 1, at: s.step, kind, from, to, detail, subject }) }
function send(s: State, message: Omit<Message, 'id' | 'status'>) {
  if (s.messages.length >= 150) throw new Error('消息预算耗尽。')
  const m: Message = { ...structuredClone(message), id: `message-${s.messages.length + 1}`, status: 'network' }; s.messages.push(m)
  event(s, 'sent', m.from, m.to, `${m.id}：${m.type}，${m.version ? `${m.version.value} @ ${tagLabel(m.version.tag)}` : '等待读取'}。`, m.id)
}
function store(s: State, replica: Replica, version: Version) {
  if (!replica.seen.some((v) => compareTag(v.tag, version.tag) === 0)) replica.seen.push(structuredClone(version))
  if (compareTag(version.tag, replica.current.tag) > 0) replica.current = structuredClone(version)
  event(s, 'stored', replica.id, replica.id, `当前值 ${replica.current.value} @ ${tagLabel(replica.current.tag)}；旧 tag 不覆盖新 tag。`)
}
function serve(s: State, c: Config, m: Message) {
  const replica = s.replicas.find((r) => r.id === m.to)!
  if (c.mode === 'primary' && c.readPolicy === 'session' && compareTag(replica.current.tag, m.minimum) < 0) {
    m.status = 'held'; event(s, 'read-wait', replica.id, replica.id, `版本低于会话令牌 ${tagLabel(m.minimum)}，保留等待，不返回旧值。`, m.operationId); return
  }
  m.status = 'delivered'; send(s, { type: 'reply', from: replica.id, to: m.from, operationId: m.operationId, version: replica.current, minimum: m.minimum })
}
function wake(s: State, c: Config, replica: Replica) {
  if (!replica.online || replica.isolated) return
  for (const m of s.messages.filter((m) => m.type === 'get' && m.to === replica.id && m.status === 'held')) if (compareTag(replica.current.tag, m.minimum) >= 0) serve(s, c, m)
}
export function canDeliver(s: State, m: Message): boolean {
  if (m.status !== 'network') return false
  const destination = s.replicas.find((r) => r.id === m.to); const source = s.replicas.find((r) => r.id === m.from)
  return (!destination || destination.online && !destination.isolated) && !source?.isolated
}
function apply(s: State, c: Config, command: Command) {
  if (command.type === 'write' || command.type === 'read') {
    if (s.operations.length >= 8) throw new Error('最多 8 个用户操作，以完整核验有限历史。')
    const client = s.clients.find((client) => client.id === command.client)!
    const target = command.type === 'read' && c.readPolicy !== 'primary' ? command.target : 'A'
    const tag = command.type === 'write' && c.mode === 'quorum' ? { counter: ++client.clock, writer: client.id } : null
    event(s, 'invoked', client.id, client.id, `发起${command.type === 'write' ? `写入 ${command.value}` : '读取'}。`)
    const op: Operation = { id: `operation-${s.operations.length + 1}`, kind: command.type, client: client.id, target, value: command.type === 'write' ? command.value : '', tag, invoked: s.events.length, returned: null, result: null, confirmations: [], replies: [] }
    s.operations.push(op)
    for (const node of c.mode === 'quorum' ? nodes : [target]) send(s, { type: command.type === 'write' ? 'put' : 'get', from: client.id, to: node, operationId: op.id, version: command.type === 'write' ? { tag: tag ?? { counter: 0, writer: '' }, value: command.value } : null, minimum: client.minimum })
    return
  }
  if ('node' in command) {
    const r = s.replicas.find((r) => r.id === command.node)!
    if (command.type === 'crash') { r.online = false; for (const m of s.messages) if (m.to === r.id && m.status === 'held') m.status = 'dropped' }
    if (command.type === 'restart') r.online = true
    if (command.type === 'isolate') r.isolated = true
    if (command.type === 'heal') r.isolated = false
    event(s, command.type, r.id, r.id, `${r.id} ${command.type}；稳定副本值保留，网络中旧消息不撤回。`); wake(s, c, r); return
  }
  const m = s.messages.find((m) => m.id === command.messageId)
  if (!m || m.status !== 'network' && m.status !== 'held') throw new Error('消息不在网络或等待队列中。')
  if (command.type === 'drop') { m.status = 'dropped'; event(s, 'dropped', m.from, m.to, '消息被丢弃，已经写入的副本不回滚。', m.id); return }
  if (!canDeliver(s, m)) throw new Error('目标离线、链路隔离或消息仍在等待版本。')
  m.status = 'delivered'
  const op = s.operations.find((op) => op.id === m.operationId)!
  const replica = s.replicas.find((r) => r.id === m.to)
  if (m.type === 'put' || m.type === 'replicate' || m.type === 'repair') {
    let version = m.version!
    if (c.mode === 'primary' && m.type === 'put') {
      op.tag ??= { counter: replica!.current.tag.counter + 1, writer: 'primary' }
      version = { value: op.value, tag: op.tag }
      for (const target of ['B', 'C'] as const) send(s, { type: 'replicate', from: 'A', to: target, operationId: op.id, version, minimum: m.minimum })
    }
    store(s, replica!, version); wake(s, c, replica!)
    if (m.type !== 'repair') send(s, { type: 'ack', from: replica!.id, to: op.client, operationId: op.id, version, minimum: m.minimum })
    return
  }
  if (m.type === 'get') { serve(s, c, m); return }
  if (m.type === 'ack') {
    if (!op.confirmations.includes(m.from as NodeId)) op.confirmations.push(m.from as NodeId)
    if (op.returned === null && op.confirmations.length >= c.writeQuorum) {
      event(s, 'returned', op.client, op.client, `${op.id} 收到 ${op.confirmations.length} 个不同副本确认，写入返回成功。`, op.id)
      op.returned = s.events.length; op.result = 'ok'
      const client = s.clients.find((x) => x.id === op.client)!
      if (op.tag && compareTag(op.tag, client.minimum) > 0) client.minimum = { ...op.tag }
      client.clock = Math.max(client.clock, op.tag?.counter ?? 0)
    }
    return
  }
  if (op.returned !== null) { event(s, 'late-reply', m.from, m.to, '操作已经返回；迟到回复不改写已返回的结果和历史。', op.id); return }
  if (!op.replies.some((reply) => reply.node === m.from)) op.replies.push({ node: m.from as NodeId, version: structuredClone(m.version!) })
  if (op.replies.length < (c.mode === 'quorum' ? c.readQuorum : 1)) return
  const latest = op.replies.reduce((a, b) => compareTag(a.version.tag, b.version.tag) >= 0 ? a : b).version
  op.result = latest.value; op.tag = { ...latest.tag }
  event(s, 'returned', m.from, op.client, `${op.id} 返回 ${latest.value} @ ${tagLabel(latest.tag)}，来自本次实际收到的回复。`, op.id); op.returned = s.events.length
  const client = s.clients.find((x) => x.id === op.client)!
  client.clock = Math.max(client.clock, latest.tag.counter)
  if (compareTag(latest.tag, client.minimum) > 0) client.minimum = { ...latest.tag }
  if (c.mode === 'quorum' && c.repair) for (const reply of op.replies) if (compareTag(reply.version.tag, latest.tag) < 0) send(s, { type: 'repair', from: op.client, to: reply.node, operationId: op.id, version: latest, minimum: latest.tag })
}
export function runModel(value: Config, commands: readonly Command[]): State {
  const c = parseConfig(value)
  if (!Array.isArray(commands) || commands.length > MAX_COMMANDS) throw new Error('复制操作预算超限。')
  const s: State = { step: 0, replicas: nodes.map((id) => ({ id, online: true, isolated: false, current: zero(), seen: [zero()] })), clients: (['X', 'Y'] as const).map((id) => ({ id, clock: 0, minimum: zero().tag })), operations: [], messages: [], events: [] }
  Array.from(commands).forEach((raw, i) => { s.step = i + 1; try { apply(s, c, parseCommand(raw)) } catch (e) { throw new Error(`第 ${i + 1} 步：${e instanceof Error ? e.message : '操作无效。'}`) } })
  return s
}
