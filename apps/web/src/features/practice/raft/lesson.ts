import { timelineEvidence } from '../../../core/experiments/timeline-evidence'
import { createProtocolLesson } from '../../../core/experiments/protocol-lesson'
import { canDeliver, defaultConfig, MAX_COMMANDS, parseCommand, parseConfig, runModel, type Command, type Config, type Message, type NodeId } from './model'
export const exercise = { kind: 'protocol' as const, id: 'raft-consensus', version: 1, title: '选出 Leader 以后，哪些日志真的提交了？', category: 'Raft 选举与日志安全', difficulty: '进阶', estimatedMinutes: 40, summary: '手动触发选举、递送投票与 AppendEntries，观察分票、少数派旧 Leader、冲突后缀，以及旧任期多数副本为何不能直接提交。', flow: ['触发选举', '逐条复制日志', '分区与恢复', '核对安全性和进展'] } as const
export const scenarios = { 'split-vote': '分票后重新选举', minority: '少数派旧 Leader', 'conflict-repair': '恢复冲突日志', 'old-term': '旧任期已有多数副本', manual: '自由实验' }
const cache = new Map<string, Command[]>()
export function scenarioCommands(c: Config, scenario: string): Command[] {
  const key = JSON.stringify([c, scenario]); const saved = cache.get(key); if (saved) return structuredClone(saved)
  const commands: Command[] = []; const state = () => runModel(c, commands); const act = (command: Command) => { commands.push(command); return state() }
  const drain = (predicate: (m: Message) => boolean = () => true) => { for (let i = 0; i < 350; i++) { const s = state(); const m = s.messages.find((m) => canDeliver(s, m) && predicate(m)); if (!m) break; act({ type: 'deliver', messageId: m.id }) } }
  const group = (...ids: NodeId[]) => (m: Message) => ids.includes(m.from) && ids.includes(m.to)
  const elect = (node: NodeId) => { act({ type: 'campaign', node }); drain() }
  if (scenario === 'split-vote') {
    for (const n of state().nodes) act({ type: 'campaign', node: n.id })
    drain(); elect('A'); act({ type: 'propose', node: 'A', value: 'v1' }); drain()
  } else if (scenario === 'old-term' && c.size === 5) {
    elect('A'); act({ type: 'propose', node: 'A', value: 'old' }); drain(group('A', 'B')); act({ type: 'isolate', node: 'A' })
    act({ type: 'campaign', node: 'C' }); drain(group('C', 'D', 'E')); act({ type: 'propose', node: 'C', value: 'replacement' }); act({ type: 'isolate', node: 'C' })
    act({ type: 'crash', node: 'A' }); act({ type: 'restart', node: 'A' }); act({ type: 'heal', node: 'A' }); act({ type: 'campaign', node: 'A' }); act({ type: 'campaign', node: 'A' })
    drain((m) => group('A', 'B', 'D')(m) && !(m.type === 'append' && m.leaderCommit > 0))
    act({ type: 'isolate', node: 'A' }); act({ type: 'isolate', node: 'B' }); act({ type: 'heal', node: 'C' }); act({ type: 'crash', node: 'C' }); act({ type: 'restart', node: 'C' }); act({ type: 'campaign', node: 'C' }); act({ type: 'campaign', node: 'C' })
    drain(group('C', 'D', 'E')); act({ type: 'propose', node: 'C', value: 'barrier' }); drain(group('C', 'D', 'E'))
  } else {
    elect('A'); act({ type: 'isolate', node: 'A' }); act({ type: 'propose', node: 'A', value: 'orphan' })
    if (scenario === 'conflict-repair') { act({ type: 'propose', node: 'A', value: 'orphan2' }); act({ type: 'crash', node: 'A' }) }
    act({ type: 'campaign', node: 'B' }); drain(); act({ type: 'propose', node: 'B', value: 'safe' }); drain()
    if (scenario === 'conflict-repair') { act({ type: 'propose', node: 'B', value: 'safe2' }); drain(); act({ type: 'restart', node: 'A' }) }
    act({ type: 'heal', node: 'A' }); act({ type: 'replicate', from: 'B', to: 'A' }); drain()
  }
  cache.set(key, structuredClone(commands)); return commands
}
export const lesson = createProtocolLesson({ id: exercise.id, initialConfig: defaultConfig, scenarios, maxCommands: MAX_COMMANDS, parseConfig, parseCommand, runModel, resultEvidence: (s) => timelineEvidence(s, { counted: ['violations'] }),
  assess: (d, s) => {
    const safe = s.violations.length === 0
    const committed = s.acknowledged.length
    let window = false
    if (d.scenario === 'split-vote') window = s.elections.some((e) => e.term >= 2) && s.events.some((e) => e.kind === 'vote-denied') && s.nodes.every((n) => n.applied[0]?.value === 'v1')
    if (d.scenario === 'minority') window = s.elections.some((e) => e.leader === 'B') && s.proposals.some((p) => p.value === 'orphan' && !s.acknowledged.includes(p.id)) && s.nodes.every((n) => n.applied[0]?.value === 'safe')
    if (d.scenario === 'conflict-repair') window = s.events.some((e) => e.kind === 'suffix-replaced') && s.events.some((e) => e.kind === 'restart' && e.subject === 'A') && s.nodes.every((n) => n.applied.map((e) => e.value).join() === 'safe,safe2')
    if (d.scenario === 'old-term') window = d.config.size === 5 && s.oldMajorities.some((m) => m.node === 'A') && s.nodes.filter((n) => ['C', 'D', 'E'].includes(n.id)).every((n) => n.applied.map((e) => e.value).join() === 'replacement,barrier') && !s.acknowledged.includes(s.proposals.find((p) => p.value === 'old')?.id ?? '')
    const leaders = s.nodes.filter((n) => n.online && n.role === 'leader').map((n) => n.id).join(',') || 'none'
    return { task: safe && window && committed > 0 && !s.messages.some((m) => canDeliver(s, m)), expected: { leaders, committed: String(committed), violations: String(s.violations.length), reason: 'term-and-prefix' }, messages: [`当前自认 Leader：${leaders}；曾向客户端确认的提案 ${committed}；安全性反例 ${s.violations.length}。`, '不同任期的节点可能同时自认 Leader；少数派旧 Leader 不能据此提交。选举票与复制确认均按不同成员计数。', '本任期条目在多数派后推进 commitIndex，并间接提交其前缀；旧任期条目不能仅凭多数份复制直接提交。', ...s.violations, '被隔离的消息仍保留。恢复和安全性按实际投票、日志前缀与应用记录检查，不用“当前有一个 Leader”替代安全性证明。'] }
  },
})
