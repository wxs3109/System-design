import { createProtocolLesson } from '../../../core/experiments/protocol-lesson'
import { defaultConfig, MAX_COMMANDS, missingAcknowledged, parseCommand, parseConfig, runModel, type Command, type State } from './model'

export const exercise = { kind: 'algorithm' as const, id: 'quality-goals', version: 1, title: '返回成功，目标就达成了吗？', category: '基础设计决策', difficulty: '入门', estimatedMinutes: 20, summary: '固定需求与故障，分别检查请求可用、确认后数据保留和允许降级；观察增加副本解决了什么、没有解决什么。', flow: ['声明成功条件', '选择策略', '执行故障', '核对证据与代价'] } as const
export const scenarios = { availability: '故障窗口仍可用', durability: '确认以后数据还在', degradation: '附加依赖失败', manual: '自由实验' }
export const goals: Record<keyof typeof scenarios, string> = {
  availability: '四次相同读取，中间让故障域 A 退出。要求每次在 100 ms 内返回核心服务内容；保留全部请求作为分母。',
  durability: '确认两个写入，令存储崩溃并恢复。允许恢复期间请求失败，但两个已确认记录必须仍可读。服务副本不代表数据副本。',
  degradation: '四次读取，中间让附加依赖退出。本关明确允许只返回核心内容，但仍要求 100 ms 内响应；同时检查完整内容要求下的结果。',
  manual: '自行交错请求、故障和恢复；观察账本，不自动计入挑战通过。',
}
export function scenarioCommands(scenario: string): Command[] {
  if (scenario === 'availability') return [{ type: 'read' }, { type: 'fail-domain', domain: 'A' }, { type: 'read' }, { type: 'read' }, { type: 'recover-domain', domain: 'A' }, { type: 'read' }]
  if (scenario === 'durability') return [{ type: 'write' }, { type: 'write' }, { type: 'crash-storage' }, { type: 'read-confirmed' }, { type: 'recover-storage' }, { type: 'read-confirmed' }]
  if (scenario === 'degradation') return [{ type: 'read' }, { type: 'fail-dependency' }, { type: 'read' }, { type: 'read' }, { type: 'recover-dependency' }, { type: 'read' }]
  return []
}
export function measures(state: State, allowDegraded: boolean) {
  const full = state.requests.filter(r => r.status === 'complete' && r.latencyMs <= 100).length
  const degraded = state.requests.filter(r => r.status === 'degraded' && r.latencyMs <= 100).length
  const good = full + (allowDegraded ? degraded : 0)
  return { offered: state.requests.length, full, degraded, good, fraction: state.requests.length ? good / state.requests.length : null, missing: missingAcknowledged(state).length }
}
const reasons = { availability: 'failure-domains', durability: 'commit-boundary', degradation: 'allowed-degradation', manual: 'declared-scope' }
export const lesson = createProtocolLesson({
  id: exercise.id, versions: { model: 'quality-goals-v1', definition: 1, assessment: 1 }, initialConfig: defaultConfig, scenarios, maxCommands: MAX_COMMANDS, parseConfig, parseCommand, runModel,
  assess: (draft, state) => {
    const m = measures(state, draft.scenario === 'degradation')
    const fixed = draft.scenario !== 'manual' && JSON.stringify(draft.commands) === JSON.stringify(scenarioCommands(draft.scenario))
    const durable = state.acknowledgements.length === 2 && m.missing === 0 && state.storage.online && state.requests.at(-1)?.operation === 'read-confirmed' && state.requests.at(-1)?.status === 'complete'
    const task = fixed && (draft.scenario === 'durability' ? durable : m.offered === 4 && m.good === 4)
    return {
      task, expected: { offered: String(m.offered), good: String(m.good), missing: String(m.missing), reason: reasons[draft.scenario as keyof typeof reasons] },
      messages: [
        `完整返回 ${m.full}，合约内成功 ${m.good} / ${m.offered}；降级返回 ${m.degraded}。所有请求都保留在账本中。`,
        `客户端曾确认 ${state.acknowledgements.length} 条；当前稳定存储 ${state.storage.stable.length} 条；易失与稳定集合均缺失 ${m.missing} 条。`,
        fixed ? '已执行本关固定需求与故障脚本。' : '本关按固定请求与故障检查；请完成原脚本，不能通过省略请求或故障改变条件。',
        draft.scenario === 'durability' ? '本关允许存储恢复期间短时不可用，检查确认后数据是否保留；稳定保存不等于持续可用。' : draft.scenario === 'degradation' ? '核心内容降级由本关需求明确允许；如果要求完整内容，只能计算完整返回。' : '服务副本必须覆盖本次故障范围；同域副本和共享依赖仍有共同失败的可能。',
        '这里的比例只描述本次有界请求脚本，不能推断全年可用性或持久性概率。',
      ],
    }
  },
})
