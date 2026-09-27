import { createProtocolLesson } from '../../../core/experiments/protocol-lesson'
import { checkRegisterHistory } from './history'
import { canDeliver, defaultConfig, MAX_COMMANDS, nodes, parseCommand, parseConfig, runModel, type Command, type Config, type Message, type State } from './model'
export type LabId = 'replica-consistency' | 'quorum-reads'
export const exercises = [
  { kind: 'protocol' as const, id: 'replica-consistency' as const, version: 1, title: '写入成功后，为什么还能读到旧值？', category: '复制与一致性', difficulty: '基础', estimatedMinutes: 25, summary: '延迟副本同步、切换读取目标，比较任意副本、会话版本令牌和固定主节点读取，并检查完整历史。', flow: ['写入与确认', '延迟复制', '路由读取', '核对返回历史'] },
  { kind: 'protocol' as const, id: 'quorum-reads' as const, version: 1, title: 'R + W > N，就一定能读到正确结果吗？', category: 'Quorum 与读修复', difficulty: '进阶', estimatedMinutes: 30, summary: '逐条递送三个副本的写确认与读回复，观察 quorum 交集、异步读修复，以及局部版本号造成的反例。', flow: ['逐副本写入', '凑齐确认集合', '读修复', '检查历史反例'] },
] as const
export const replicaScenarios = { 'stale-read': '写后读取延迟副本', 'monotonic-read': '先读新值再换副本', partition: '副本分区与恢复', manual: '自由实验' }
export const quorumScenarios = { intersection: '读取集合是否相交', repair: '旧副本的读修复', 'clock-counterexample': '多数派也可能不是线性一致', manual: '自由实验' }
export const scenariosFor = (id: LabId) => id === 'replica-consistency' ? replicaScenarios : quorumScenarios
export function scenarioCommands(c: Config, scenario: string): Command[] {
  const commands: Command[] = []
  const state = () => runModel(c, commands)
  const act = (command: Command) => { commands.push(command); return state() }
  const deliver = (predicate: (m: Message) => boolean) => {
    const m = state().messages.find((m) => canDeliver(state(), m) && predicate(m))
    if (m) act({ type: 'deliver', messageId: m.id })
  }
  const messages = (op: string, type: Message['type'], target?: string) => { for (let i = 0; i < 12; i++) { const s = state(); const m = s.messages.find((m) => m.operationId === op && m.type === type && (!target || m.to === target) && canDeliver(s, m)); if (!m) break; act({ type: 'deliver', messageId: m.id }) } }
  const write = (client: 'X' | 'Y', value: string) => {
    const op = act({ type: 'write', client, value }).operations.at(-1)!.id
    if (c.mode === 'primary') { messages(op, 'put', 'A'); deliver((m) => m.operationId === op && m.type === 'ack' && m.from === 'A') }
    else for (const node of nodes.slice(0, c.writeQuorum)) { messages(op, 'put', node); deliver((m) => m.operationId === op && m.type === 'ack' && m.from === node) }
    return op
  }
  const read = (client: 'X' | 'Y', target: 'A' | 'B' | 'C') => {
    const op = act({ type: 'read', client, target }).operations.at(-1)!.id
    if (c.mode === 'primary') { messages(op, 'get'); messages(op, 'reply') }
    else for (const node of ['C', 'B', 'A']) { messages(op, 'get', node); deliver((m) => m.operationId === op && m.type === 'reply' && m.from === node) }
    return op
  }
  if (c.mode === 'primary') {
    const op = write('X', 'v1')
    if (scenario === 'monotonic-read') { messages(op, 'replicate', 'B'); read('X', 'B'); read('X', 'C') }
    else if (scenario === 'partition') { act({ type: 'isolate', node: 'B' }); const readId = read('X', 'B'); act({ type: 'heal', node: 'B' }); messages(readId, 'get'); messages(readId, 'reply') }
    else read('X', 'B')
  } else if (scenario === 'clock-counterexample') { write('Y', 'v1'); write('X', 'v2'); read('Y', 'C') }
  else { write('X', 'v1'); read('Y', 'C'); for (let i = 0; i < 3; i++) deliver((m) => m.type === 'repair') }
  for (let i = 0; i < 100; i++) { const s = state(); const m = s.messages.find((m) => canDeliver(s, m)); if (!m) break; act({ type: 'deliver', messageId: m.id }) }
  return commands
}
export const lastRead = (s: State) => s.operations.filter((op) => op.kind === 'read').at(-1)
export function createLesson(id: LabId) {
  const mode = id === 'replica-consistency' ? 'primary' : 'quorum'
  return createProtocolLesson({ id, initialConfig: () => defaultConfig(mode), scenarios: scenariosFor(id), maxCommands: MAX_COMMANDS,
    parseConfig: (v) => { const c = parseConfig(v); if (c.mode !== mode) throw new Error('记录属于另一复制模型模式。'); return c }, parseCommand, runModel,
    assess: (d, s) => {
      const h = checkRegisterHistory(s.operations); const read = lastRead(s)
      const settled = s.operations.length >= 2 && s.operations.every((op) => op.returned !== null) && s.messages.every((m) => m.status === 'delivered' || m.status === 'dropped')
      const reads = s.operations.filter((op) => op.kind === 'read')
      let task = false
      if (mode === 'primary') {
        const write = s.operations.find((op) => op.kind === 'write')
        const baseline = d.config.writeQuorum === 1 && write?.value === 'v1' && write.returned !== null && reads.length >= (d.scenario === 'monotonic-read' ? 2 : 1) && reads.every((op) => op.result === 'v1' && op.invoked > write!.returned!)
        const delay = s.events.some((e) => e.kind === 'stored' && e.from === (d.scenario === 'monotonic-read' ? 'C' : 'B') && reads.some((op) => e.index > op.invoked))
        const partition = d.scenario !== 'partition' || s.events.some((e) => e.kind === 'isolate' && e.from === 'B') && s.events.some((e) => e.kind === 'heal' && e.from === 'B')
        task = !!baseline && delay && partition && settled && h.status === 'linearizable'
      } else if (d.scenario === 'clock-counterexample') {
        const writes = s.operations.filter((op) => op.kind === 'write')
        task = d.config.writeQuorum === 2 && d.config.readQuorum === 2 && settled && h.status === 'violation' && writes.length === 2 && writes[0]!.client === 'Y' && writes[1]!.client === 'X' && writes[0]!.returned! < writes[1]!.invoked && read?.result === writes[0]!.value
      } else if (d.scenario === 'repair') task = settled && read?.result === 'v1' && s.messages.some((m) => m.type === 'repair' && m.status === 'delivered') && s.replicas.every((r) => r.current.value === 'v1')
      else if (d.scenario === 'intersection') task = settled && read?.result === 'v1' && h.status === 'linearizable' && d.config.writeQuorum + d.config.readQuorum > 3
      return { task, expected: { value: read?.result ?? 'pending', history: h.status, pending: String(s.operations.filter((op) => op.returned === null).length), reason: 'observed-evidence' }, messages: [
        `最后读取返回：${read?.result ?? 'pending'}；有限历史检查：${h.status}。${h.witness.length ? `合法顺序见证：${h.witness.join(' → ')}。` : ''}`,
        '副本后来收敛不会修改先前已经返回的结果。未完成的操作使本检查器报告证据未完整，不静默删除它们。',
        mode === 'primary' ? '固定主节点 A，不建模选主。会话令牌只约束同一客户端后续非重叠读取；没有足够版本时等待，而不是伪造新值。' : '这是带局部逻辑 tag 的 LWW 寄存器，不是共识或 ABD 实现。R/W 交集不负责生成尊重实时顺序的 tag；异步读修复在返回之后执行，不提供原子读写回保证。',
        settled ? '所有用户操作和消息已收尾。' : '仍有用户操作或消息未完成。',
      ] }
    },
  })
}
export const replicaLesson = createLesson('replica-consistency')
export const quorumLesson = createLesson('quorum-reads')
