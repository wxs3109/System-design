import type { TimelineEvent } from '../protocol/events'
export type NodeId = 'A' | 'B' | 'C' | 'D' | 'E'
export interface Config { modelVersion: 'raft-v1'; size: 3 | 5; commitRule: 'current-term' | 'any-term' }
export interface Entry { index: number; term: number; id: string; value: string }
export interface Node { id: NodeId; online: boolean; isolated: boolean; term: number; votedFor: NodeId | null; role: 'follower' | 'candidate' | 'leader'; leader: NodeId | null; votes: NodeId[]; log: Entry[]; commitIndex: number; applied: Entry[]; next: Partial<Record<NodeId, number>>; match: Partial<Record<NodeId, number>>; latestRequest: Partial<Record<NodeId, string>> }
export interface Message { id: string; type: 'request-vote' | 'vote' | 'append' | 'append-result'; from: NodeId; to: NodeId; term: number; lastIndex: number; lastTerm: number; granted: boolean; prevIndex: number; prevTerm: number; entries: Entry[]; leaderCommit: number; success: boolean; matchIndex: number; requestId: string; protectedConflict: boolean; status: 'network' | 'delivered' | 'dropped' }
export interface State { step: number; nodes: Node[]; messages: Message[]; proposals: Entry[]; elections: { term: number; leader: NodeId }[]; applications: { node: NodeId; entry: Entry }[]; acknowledged: string[]; oldMajorities: { node: NodeId; term: number; index: number }[]; violations: string[]; events: TimelineEvent[] }
export type Command = { type: 'campaign' | 'crash' | 'restart' | 'isolate' | 'heal'; node: NodeId } | { type: 'propose'; node: NodeId; value: string } | { type: 'replicate'; from: NodeId; to: NodeId } | { type: 'deliver' | 'drop' | 'duplicate'; messageId: string }
export const MAX_COMMANDS = 240
export const defaultConfig = (): Config => ({ modelVersion: 'raft-v1', size: 3, commitRule: 'current-term' })
export const majority = (c: Config) => Math.floor(c.size / 2) + 1
export function parseConfig(value: unknown): Config { const c = value as Config | null; if (!c || c.modelVersion !== 'raft-v1' || ![3, 5].includes(c.size) || !['current-term', 'any-term'].includes(c.commitRule)) throw new Error('Raft 模型配置无效。'); return { modelVersion: c.modelVersion, size: c.size, commitRule: c.commitRule } }
export function parseCommand(value: unknown): Command {
  const c = value as Command | null; if (!c) throw new Error('Raft 操作无效。')
  const id = (v: unknown): v is NodeId => typeof v === 'string' && ['A', 'B', 'C', 'D', 'E'].includes(v)
  if (c.type === 'deliver' || c.type === 'drop' || c.type === 'duplicate') { if (!/^message-\d+$/.test(c.messageId)) throw new Error('消息 ID 无效。'); return { type: c.type, messageId: c.messageId } }
  if (c.type === 'replicate') { if (!id(c.from) || !id(c.to) || c.from === c.to) throw new Error('复制端点无效。'); return { type: c.type, from: c.from, to: c.to } }
  if (!('node' in c) || !id(c.node)) throw new Error('节点 ID 无效。')
  if (c.type === 'propose') { if (typeof c.value !== 'string' || !/^[a-zA-Z0-9_-]{1,30}$/.test(c.value)) throw new Error('日志值无效。'); return { type: c.type, node: c.node, value: c.value } }
  if (!['campaign', 'crash', 'restart', 'isolate', 'heal'].includes(c.type)) throw new Error('未知 Raft 操作。')
  return { type: c.type, node: c.node }
}
function event(s: State, kind: string, from: string, to: string, detail: string, subject: string | null = null) { s.events.push({ index: s.events.length + 1, at: s.step, kind, from, to, detail, subject }) }
function violation(s: State, reason: string) { if (!s.violations.includes(reason)) s.violations.push(reason); event(s, 'safety-violation', 'A', 'A', reason) }
function node(s: State, id: NodeId): Node { const n = s.nodes.find((n) => n.id === id); if (!n) throw new Error('节点不在当前固定成员集合中。'); return n }
function packet(s: State, type: Message['type'], from: NodeId, to: NodeId, term: number, patch: Partial<Message> = {}): Message {
  if (s.messages.length >= 400) throw new Error('Raft 消息预算耗尽。')
  const m: Message = { id: `message-${s.messages.length + 1}`, type, from, to, term, lastIndex: 0, lastTerm: 0, granted: false, prevIndex: 0, prevTerm: 0, entries: [], leaderCommit: 0, success: false, matchIndex: 0, requestId: '', protectedConflict: false, ...structuredClone(patch), status: 'network' }
  s.messages.push(m); event(s, 'sent', from, to, `${m.id} ${type} / term ${term}${type === 'append' ? ` / prev ${m.prevIndex}:${m.prevTerm} / entries ${m.entries.length}` : ''}`, m.id); return m
}
function stepDown(s: State, n: Node, term: number) {
  if (term > n.term) { n.term = term; n.votedFor = null }
  n.role = 'follower'; n.leader = null; n.votes = []; n.next = {}; n.match = {}; n.latestRequest = {}
  event(s, 'step-down', n.id, n.id, `转为 follower，term ${n.term}；稳定日志与已应用进度保留。`, n.id)
}
function append(s: State, leader: Node, peer: NodeId) {
  if (leader.role !== 'leader' || !leader.online) throw new Error('发送复制需要在线 Leader。')
  node(s, peer)
  const next = leader.next[peer] ?? leader.log.length + 1
  const m = packet(s, 'append', leader.id, peer, leader.term, { prevIndex: next - 1, prevTerm: next === 1 ? 0 : leader.log[next - 2]!.term, entries: leader.log.slice(next - 1), leaderCommit: leader.commitIndex })
  leader.latestRequest[peer] = m.id
}
function applyCommitted(s: State, n: Node) {
  while (n.applied.length < n.commitIndex) {
    const entry = n.log[n.applied.length]!
    const existing = s.applications.find((a) => a.entry.index === entry.index && a.entry.id !== entry.id)
    if (existing) violation(s, `索引 ${entry.index} 应用冲突：${existing.node}/${existing.entry.id} 与 ${n.id}/${entry.id}。`)
    n.applied.push({ ...entry }); s.applications.push({ node: n.id, entry: { ...entry } })
    if (n.role === 'leader' && !s.acknowledged.includes(entry.id)) s.acknowledged.push(entry.id)
    event(s, 'applied', n.id, n.id, `应用 index ${entry.index} / term ${entry.term} / ${entry.value}。`, entry.id)
  }
}
function updateCommit(s: State, c: Config, leader: Node) {
  let nextCommit = leader.commitIndex
  for (let index = leader.commitIndex + 1; index <= leader.log.length; index++) {
    const count = s.nodes.filter((n) => n.id === leader.id || (leader.match[n.id] ?? 0) >= index).length
    if (count < majority(c)) continue
    if (c.commitRule === 'current-term' && leader.log[index - 1]!.term !== leader.term) {
      if (!s.oldMajorities.some((m) => m.node === leader.id && m.term === leader.term && m.index === index)) { s.oldMajorities.push({ node: leader.id, term: leader.term, index }); event(s, 'old-term-held', leader.id, leader.id, `index ${index} 已在多数派，但属于旧任期；不能仅按副本数直接推进提交。`, String(index)) }
    } else nextCommit = index
  }
  if (nextCommit > leader.commitIndex) {
    leader.commitIndex = nextCommit; event(s, 'committed', leader.id, leader.id, `推进 commitIndex 到 ${nextCommit}；前缀一并提交。`, String(nextCommit)); applyCommitted(s, leader)
    for (const peer of s.nodes) if (peer.id !== leader.id) append(s, leader, peer.id)
  }
}
function becomeLeader(s: State, c: Config, n: Node) {
  if (n.role !== 'candidate' || n.votes.length < majority(c)) return
  n.role = 'leader'; n.leader = n.id
  if (s.elections.some((e) => e.term === n.term && e.leader !== n.id)) violation(s, `term ${n.term} 出现两个多数派 Leader。`)
  s.elections.push({ term: n.term, leader: n.id })
  for (const id of s.acknowledged) if (!n.log.some((entry) => entry.id === id)) violation(s, `新 Leader ${n.id}/term ${n.term} 缺少先前已确认的 ${id}。`)
  for (const peer of s.nodes) { n.next[peer.id] = n.log.length + 1; n.match[peer.id] = peer.id === n.id ? n.log.length : 0 }
  event(s, 'elected', n.id, n.id, `获得 ${n.votes.join(', ')} 的多数票，成为 term ${n.term} Leader。`, n.id)
  for (const peer of s.nodes) if (peer.id !== n.id) append(s, n, peer.id)
}
export const canDeliver = (s: State, m: Message) => m.status === 'network' && node(s, m.to).online && !node(s, m.to).isolated && !node(s, m.from).isolated
function receive(s: State, c: Config, m: Message) {
  const n = node(s, m.to)
  if (m.term > n.term) stepDown(s, n, m.term)
  if (m.type === 'request-vote') {
    const last = n.log.at(-1)
    const upToDate = m.lastTerm > (last?.term ?? 0) || m.lastTerm === (last?.term ?? 0) && m.lastIndex >= (last?.index ?? 0)
    const granted = m.term === n.term && (n.votedFor === null || n.votedFor === m.from) && upToDate
    if (granted) n.votedFor = m.from
    event(s, granted ? 'vote-granted' : 'vote-denied', n.id, m.from, granted ? '先稳定记录本任期投票，再发送 YES。' : '任期、已投票或候选日志新旧条件不满足。', m.from)
    packet(s, 'vote', n.id, m.from, n.term, { granted }); return
  }
  if (m.type === 'vote') {
    if (n.role === 'candidate' && n.term === m.term && m.granted && !n.votes.includes(m.from)) { n.votes.push(m.from); becomeLeader(s, c, n) }
    return
  }
  if (m.type === 'append') {
    let success = m.term === n.term
    let protectedConflict = false
    if (success) { if (n.role !== 'follower') stepDown(s, n, m.term); n.leader = m.from }
    if (m.prevIndex > n.log.length || m.prevIndex > 0 && n.log[m.prevIndex - 1]!.term !== m.prevTerm) success = false
    if (success) {
      for (let i = 0; i < m.entries.length; i++) {
        const entry = m.entries[i]!; const existing = n.log[entry.index - 1]
        if (existing && (existing.term !== entry.term || existing.id !== entry.id)) {
          if (entry.index <= n.commitIndex) { violation(s, `${n.id} 收到覆盖已提交 index ${entry.index} 的请求。`); success = false; protectedConflict = true; break }
          n.log = n.log.slice(0, entry.index - 1); event(s, 'suffix-replaced', n.id, n.id, `丢弃未提交冲突后缀，从 index ${entry.index} 重新追加。`, String(entry.index))
        }
        if (n.log.length < entry.index) n.log.push({ ...entry })
      }
      if (success) { n.commitIndex = Math.max(n.commitIndex, Math.min(m.leaderCommit, m.prevIndex + m.entries.length)); applyCommitted(s, n) }
    }
    packet(s, 'append-result', n.id, m.from, n.term, { success, matchIndex: success ? m.prevIndex + m.entries.length : 0, requestId: m.id, protectedConflict })
    event(s, success ? 'append-accepted' : 'append-rejected', n.id, m.from, success ? `只确认匹配到 index ${m.prevIndex + m.entries.length}，不把额外后缀算进去。` : '任期或 prevIndex/prevTerm 不匹配，拒绝复制。', m.id); return
  }
  if (n.role !== 'leader' || m.term !== n.term) return
  if (m.success) {
    n.match[m.from] = Math.max(n.match[m.from] ?? 0, m.matchIndex)
    n.next[m.from] = Math.max(n.next[m.from] ?? 1, m.matchIndex + 1)
    updateCommit(s, c, n)
  } else if (!m.protectedConflict && n.latestRequest[m.from] === m.requestId) {
    n.next[m.from] = Math.max((n.match[m.from] ?? 0) + 1, (n.next[m.from] ?? n.log.length + 1) - 1)
    append(s, n, m.from)
  }
}
function apply(s: State, c: Config, command: Command) {
  if ('messageId' in command) {
    const m = s.messages.find((m) => m.id === command.messageId); if (!m) throw new Error('Raft 消息不存在。')
    if (command.type === 'duplicate') { const { id: _id, status: _status, ...copy } = m; void _id; void _status; packet(s, m.type, m.from, m.to, m.term, copy); return }
    if (m.status !== 'network') throw new Error('消息不在网络中。')
    if (command.type === 'drop') { m.status = 'dropped'; event(s, 'dropped', m.from, m.to, '网络丢失消息，不回滚稳定状态。', m.id); return }
    if (!canDeliver(s, m)) throw new Error('目标离线或链路隔离。')
    m.status = 'delivered'; receive(s, c, m); return
  }
  if (command.type === 'replicate') { append(s, node(s, command.from), command.to); return }
  const n = node(s, command.node)
  if (command.type === 'crash' || command.type === 'restart') {
    if (command.type === 'restart' && n.online || command.type === 'crash' && !n.online) throw new Error('节点当前状态不支持该操作。')
    n.online = command.type === 'restart'; stepDown(s, n, n.term)
    event(s, command.type, n.id, n.id, '任期、投票、日志与已应用记录保留；临时 Leader 角色和复制进度清空。', n.id); return
  }
  if (command.type === 'isolate' || command.type === 'heal') { n.isolated = command.type === 'isolate'; event(s, command.type, n.id, n.id, '只改变消息可达性，不自动宣布或撤销 Leader。', n.id); return }
  if (!n.online) throw new Error('节点离线。')
  if (command.type === 'campaign') {
    if (n.role === 'leader') throw new Error('Leader 不触发自身选举超时；先让其退位或重启。')
    n.term++; n.votedFor = n.id; n.votes = [n.id]; n.role = 'candidate'; n.leader = null; n.next = {}; n.match = {}; n.latestRequest = {}
    event(s, 'campaign', n.id, n.id, `手工触发本地选举超时，稳定增加到 term ${n.term} 并投自己。`, n.id)
    for (const peer of s.nodes) if (peer.id !== n.id) packet(s, 'request-vote', n.id, peer.id, n.term, { lastIndex: n.log.length, lastTerm: n.log.at(-1)?.term ?? 0 })
    return
  }
  if (n.role !== 'leader') throw new Error('只有 Leader 可以追加提案。')
  if (command.type !== 'propose') throw new Error('未知提案操作。')
  if (s.proposals.length >= 10 || n.log.length >= 8) throw new Error('提案或日志预算耗尽。')
  const entry: Entry = { id: `proposal-${s.proposals.length + 1}`, index: n.log.length + 1, term: n.term, value: command.value }
  n.log.push({ ...entry }); s.proposals.push({ ...entry }); n.match[n.id] = n.log.length
  event(s, 'proposed', n.id, n.id, `本地追加 ${entry.id}：index ${entry.index} / term ${entry.term} / ${entry.value}，尚未提交。`, entry.id)
  for (const peer of s.nodes) if (peer.id !== n.id) append(s, n, peer.id)
}
export function runModel(value: Config, commands: readonly Command[]): State {
  const c = parseConfig(value); if (!Array.isArray(commands) || commands.length > MAX_COMMANDS) throw new Error('Raft 操作预算超限。')
  const ids = (['A', 'B', 'C', 'D', 'E'] as const).slice(0, c.size)
  const s: State = { step: 0, nodes: ids.map((id) => ({ id, online: true, isolated: false, term: 0, votedFor: null, role: 'follower', leader: null, votes: [], log: [], commitIndex: 0, applied: [], next: {}, match: {}, latestRequest: {} })), messages: [], proposals: [], elections: [], applications: [], acknowledged: [], oldMajorities: [], violations: [], events: [] }
  Array.from(commands).forEach((raw, i) => { s.step = i + 1; try { apply(s, c, parseCommand(raw)) } catch (e) { throw new Error(`第 ${i + 1} 步：${e instanceof Error ? e.message : '操作无效。'}`) } }); return s
}
