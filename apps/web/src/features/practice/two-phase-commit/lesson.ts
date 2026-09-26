import { createProtocolLesson } from '../protocol/lesson'
import { canDeliver, defaultConfig, MAX_COMMANDS, parseCommand, parseConfig, runModel, type Command, type Config, type Message } from './model'
export const exercise = { kind: 'protocol' as const, id: 'two-phase-commit', version: 1, title: '已经投了 YES，超时后还能自行退出吗？', category: '两阶段提交', difficulty: '进阶', estimatedMinutes: 30, summary: '观察准备记录、资源锁、持久决议与业务提交的不同阶段；让协调者或参与者崩溃，再从各自日志恢复。', flow: ['准备与投票', '持久决议', '故障与阻塞', '恢复与确认'] } as const
export const scenarios = { blocking: '准备后协调者崩溃', 'decision-gap': '决议只到达一个参与者', 'participant-recovery': '参与者恢复与重复决议', rejection: '参与者拒绝准备', manual: '自由实验' }
export function scenarioCommands(c: Config, scenario: string): Command[] {
  const commands: Command[] = []; const state = () => runModel(c, commands); const act = (command: Command) => { commands.push(command); return state() }
  const drain = (predicate: (m: Message) => boolean = () => true) => { for (let i = 0; i < 70; i++) { const s = state(); const m = s.messages.find((m) => canDeliver(s, m) && predicate(m)); if (!m) break; act({ type: 'deliver', messageId: m.id }) } }
  act({ type: 'begin' }); drain()
  if (scenario === 'blocking') { act({ type: 'crash', actor: 'coordinator' }); act({ type: 'advance', ms: c.timeoutMs }); act({ type: 'restart', actor: 'coordinator' }); act({ type: 'prepare' }); drain(); act({ type: 'decide' }); act({ type: 'broadcast' }); drain() }
  else if (scenario === 'decision-gap') { act({ type: 'decide' }); act({ type: 'broadcast' }); drain((m) => m.to !== 'B'); act({ type: 'crash', actor: 'coordinator' }); act({ type: 'advance', ms: c.timeoutMs }); act({ type: 'restart', actor: 'coordinator' }); act({ type: 'broadcast' }); drain() }
  else if (scenario === 'participant-recovery') { act({ type: 'crash', actor: 'B' }); act({ type: 'decide' }); act({ type: 'broadcast' }); drain(); act({ type: 'restart', actor: 'B' }); drain(); act({ type: 'broadcast' }); drain() }
  else { act({ type: 'decide' }); act({ type: 'broadcast' }); drain() }
  return commands
}
export const lesson = createProtocolLesson({ id: exercise.id, initialConfig: defaultConfig, scenarios, maxCommands: MAX_COMMANDS, parseConfig, parseCommand, runModel,
  assess: (d, s) => {
    const expectDecision = d.scenario === 'rejection' ? 'abort' : 'commit'
    const correct = s.decision === expectDecision && s.clientOutcome === expectDecision && s.conflicts === 0 && s.participants.every((p) => p.phase === (expectDecision === 'commit' ? 'committed' : 'aborted') && p.balance === (expectDecision === 'abort' ? 5 : p.id === 'A' ? 3 : 7) && p.effects === (expectDecision === 'commit' ? 1 : 0))
    const window = d.scenario === 'blocking' ? s.events.some((e) => e.kind === 'blocked') && s.events.some((e) => e.kind === 'crash' && e.subject === 'coordinator') : d.scenario === 'decision-gap' ? s.events.some((e) => e.kind === 'blocked' && e.subject === 'B') && s.events.some((e) => e.kind === 'crash' && e.subject === 'coordinator') : d.scenario === 'participant-recovery' ? s.events.some((e) => e.kind === 'crash' && e.subject === 'B') && s.events.some((e) => e.kind === 'decision-replay') : d.scenario === 'rejection' && s.events.some((e) => e.kind === 'vote-no')
    return { task: correct && window && s.messages.every((m) => m.status !== 'network'), expected: { decision: s.decision ?? 'unknown', prepared: String(s.participants.filter((p) => p.phase === 'prepared').length), effects: String(s.participants.reduce((n, p) => n + p.effects, 0)), reason: 'durable-decision' }, messages: [`持久决议 ${s.decision ?? 'unknown'}；客户端结果 ${s.clientOutcome ?? 'unknown'}；冲突 ${s.conflicts}。`, 'Prepared 是持久承诺和锁，不是业务提交。超时不能告诉参与者协调者是否已持久记录 commit。', '各参与者收到决议的时刻可以不同；准备状态的资源仍锁定。本题不模拟跨库快照读取，不能把瞬时物理余额之和当成全局一致读。', '2PC 的阻塞通过等待或恢复解决；它不提供 Saga 式业务补偿，也没有可用多数派替代协调者的机制。'] }
  },
})
