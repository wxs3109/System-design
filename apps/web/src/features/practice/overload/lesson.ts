import { defaultConfig, MAX_COMMANDS, metrics, parseCommand, parseConfig, profileArrivals, runModel, same, type Command, type Config, type Profile, type State } from './model'
export const overloadExercise = { kind: 'protocol' as const, id: 'overload', version: 1, title: '服务已经很慢，重试为什么让它更忙？', category: '过载与背压', difficulty: '基础', estimatedMinutes: 30, summary: '固定原始需求和处理能力，观察超时重试如何增加工作，比较退避、发送窗口、有限队列与截止期过后的无效工作。', flow: ['固定原始需求', '减速与超时', '控制重试和接纳', '核对完成与代价'] } as const
export const scenarioLabels = { 'retry-storm': '减速后的重试放大', 'bounded-burst': '突发流量与有限队列', 'expired-work': '截止后仍在处理', manual: '自由实验' } as const
export type Scenario = keyof typeof scenarioLabels
export const profileFor = (scenario: string): Profile => scenario === 'bounded-burst' ? 'burst' : scenario === 'expired-work' ? 'short-deadline' : 'steady'
export interface Draft { scenario: Scenario; config: Config; commands: Command[]; prediction: string; offeredAnswer: string; attemptsAnswer: string; successAnswer: string; workAnswer: string; reasonAnswer: string; reflection: string }
export interface Evaluation { evidence: boolean; task: boolean; explanation: boolean; status: 'pass' | 'fail' | 'inconclusive'; messages: string[] }
export interface Attempt { id: string; exerciseId: 'overload'; exerciseVersion: 1; createdAt: number; draft: Draft; result: State; evaluation: Evaluation }
export const initialDraft = (): Draft => ({ scenario: 'retry-storm', config: defaultConfig(), commands: [], prediction: '', offeredAnswer: '', attemptsAnswer: '', successAnswer: '', workAnswer: '', reasonAnswer: '', reflection: '' })
export function parseDraft(value: unknown): Draft {
  const d = value as Draft | null
  if (!d || !Object.hasOwn(scenarioLabels, d.scenario) || !Array.isArray(d.commands) || d.commands.length > MAX_COMMANDS) throw new Error('过载实验记录无效。')
  for (const field of ['prediction', 'offeredAnswer', 'attemptsAnswer', 'successAnswer', 'workAnswer', 'reasonAnswer', 'reflection'] as const) if (typeof d[field] !== 'string' || d[field].length > 4000) throw new Error('过载实验作答无效。')
  return { ...d, config: parseConfig(d.config), commands: Array.from(d.commands, parseCommand) }
}
export const scenarioCommands = (scenario: Exclude<Scenario, 'manual'>): Command[] => scenario === 'bounded-burst' ? [{ type: 'start' }, { type: 'advance', ms: 10000 }] : [{ type: 'slow' }, { type: 'start' }, { type: 'advance', ms: 600 }, { type: 'recover' }, { type: 'advance', ms: 9400 }]
export function evaluate(d: Draft, s: State): Evaluation {
  try { if (!same(runModel(d.config, d.commands), s)) throw new Error('mismatch') } catch { return { evidence: false, task: false, explanation: false, status: 'inconclusive', messages: ['状态、采样与事件无法完整重算。'] } }
  const m = metrics(s)
  const conserved = m.attempts === m.completed + m.rejected + m.expired + m.queued + m.running
  const roots = s.roots.filter((r) => r.origin === 'workload')
  const fixedDemand = d.config.profile === profileFor(d.scenario) && d.config.slots === 1 && !s.stopped && roots.length === 12 && s.roots.length === 12 && m.offered === 12 && same(roots.map((r) => r.arrival), profileArrivals(d.config.profile))
  const faults = s.events.filter((e) => e.kind === 'slow' || e.kind === 'recovered')
  const fixedFault = d.scenario === 'bounded-burst' ? !faults.length : faults.length === 2 && faults[0]!.kind === 'slow' && faults[0]!.at === 0 && faults[1]!.kind === 'recovered' && faults[1]!.at === 600
  const settled = !m.queued && !m.running && s.roots.every((r) => r.phase === 'success' || r.phase === 'expired')
  let outcome = false
  if (d.scenario === 'retry-storm') {
    const baseline = metrics(runModel({ ...d.config, retry: 'immediate', maxAttempts: 5, senderLimit: 0, queueLimit: 60, discardExpired: false }, scenarioCommands('retry-storm')))
    outcome = m.successes === 12 && m.attempts < baseline.attempts && m.busyMs < baseline.busyMs
  }
  if (d.scenario === 'bounded-burst') outcome = m.successes === 12 && m.peakQueue <= 2 && m.retries <= 24
  if (d.scenario === 'expired-work') outcome = m.successes > 0 && m.deadlines > 0 && m.expired > 0 && s.attempts.some((a) => a.status === 'completed' && a.finishAt! > s.roots.find((r) => r.id === a.rootId)!.deadline) && s.attempts.every((a) => a.startedAt === null || a.startedAt < s.roots.find((r) => r.id === a.rootId)!.deadline)
  const task = d.scenario !== 'manual' && fixedDemand && fixedFault && conserved && settled && outcome
  const number = (answer: string, value: number) => /^\d+$/.test(answer) && Number(answer) === value
  const explanation = !!d.prediction && number(d.offeredAnswer, m.offered) && number(d.attemptsAnswer, m.attempts) && number(d.successAnswer, m.successes) && number(d.workAnswer, m.completed) && d.reasonAnswer === 'work-and-outcome'
  return { evidence: true, task, explanation, status: task ? 'pass' : d.commands.length ? 'fail' : 'inconclusive', messages: [
    `原始请求 ${m.offered}，实际尝试 ${m.attempts}，客户端及时成功 ${m.successes}，超过总截止期 ${m.deadlines}。服务端实际完成 ${m.completed} 次，其中重复处理同一原始请求 ${m.repeated} 次。`,
    `尝试守恒：完成 ${m.completed} + 拒绝 ${m.rejected} + 过期出队 ${m.expired} + 排队 ${m.queued} + 执行中 ${m.running} = ${m.attempts}。${conserved ? '' : '守恒失败，结果无效。'}`,
    `队列峰值 ${m.peakQueue}；实际执行槽占用 ${m.busyMs} ms。${settled ? '已有工作已收尾。' : '仍有排队、执行或等待客户端结果，不能把未完成工作排除。'}`,
    fixedDemand && fixedFault ? '需求、单个执行槽和故障时刻与本关一致。' : '本关需要固定 12 个原始请求、一个执行槽和预设减速窗口；停止需求、增加容量或改变故障时刻不能冒充修复。',
    outcome ? '结果与保护目标符合本关要求。' : d.scenario === 'expired-work' ? '本关需要观察及时成功、截止失败和迟到完成，同时阻止截止后启动新工作；不能以丢弃全部工作通过。' : '继续控制工作量：保持全部 12 个请求及时成功，并满足本关的重试或队列目标。',
    explanation ? '原始需求、尝试、客户端结果和服务端工作区分正确。' : '请分别核对四个计数。超时不取消已接纳工作，拒绝与过期丢弃不能当作成功。',
  ] }
}
export function runAttempt(value: Draft): Attempt { const draft = parseDraft(value); const result = runModel(draft.config, draft.commands); return { id: crypto.randomUUID(), exerciseId: 'overload', exerciseVersion: 1, createdAt: Date.now(), draft: structuredClone(draft), result, evaluation: evaluate(draft, result) } }
export function verifyAttempt(value: unknown): value is Attempt { try { const a = value as Attempt; if (a.exerciseId !== 'overload' || a.exerciseVersion !== 1 || typeof a.id !== 'string' || !Number.isFinite(a.createdAt)) return false; const e = evaluate(parseDraft(a.draft), a.result); return e.evidence && same(e, a.evaluation) } catch { return false } }
