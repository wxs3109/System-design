import { defaultConfig, parseCommand, parseConfig, runModel, same, MAX_COMMANDS, type Command, type Config, type State } from './model'
export type LabId = 'heartbeat' | 'lease-fencing'
export const exercises = [
  { kind: 'protocol' as const, id: 'heartbeat' as const, version: 1, title: '没收到心跳，节点真的死了吗？', category: '故障检测', difficulty: '基础', estimatedMinutes: 20, summary: '暂停、分区或崩溃 Worker，递送或丢弃心跳，比较实际状态与观察者的怀疑及恢复。', flow: ['发送心跳', '注入故障', '等待超时', '核对观察'] },
  { kind: 'protocol' as const, id: 'lease-fencing' as const, version: 1, title: '新 Worker 接管后，旧写入还能成功吗？', category: '持有权与旧写入', difficulty: '基础', estimatedMinutes: 25, summary: '申请租约、暂停持有者、让新 Worker 接管，再递送旧写入，比较资源端是否执行 fencing 校验。', flow: ['获得租约', '暂停与接管', '新旧写入', '资源端校验'] },
] as const
export const scenarioLabels = { pause: '进程暂停', partition: '网络分区', crash: '进程崩溃', 'stale-write': '接管后的旧写入', 'false-suspicion': '怀疑不等于租约到期', 'fence-window': '资源尚未见到新 token', manual: '自由实验' } as const
export type Scenario = keyof typeof scenarioLabels
export const scenariosFor = (id: LabId): Scenario[] => id === 'heartbeat' ? ['pause', 'partition', 'crash', 'manual'] : ['stale-write', 'false-suspicion', 'fence-window', 'manual']
export interface Draft { labId: LabId; scenario: Scenario; config: Config; commands: Command[]; prediction: string; observedAnswer: string; actualAnswer: string; valueAnswer: string; rejectedAnswer: string; reasonAnswer: string; reflection: string }
export interface Evaluation { evidence: boolean; task: boolean; explanation: boolean; status: 'pass' | 'fail' | 'inconclusive'; messages: string[] }
export interface Attempt { id: string; exerciseId: LabId; exerciseVersion: 1; createdAt: number; draft: Draft; result: State; evaluation: Evaluation }
export const initialDraft = (labId: LabId): Draft => ({ labId, scenario: labId === 'heartbeat' ? 'pause' : 'stale-write', config: defaultConfig(), commands: [], prediction: '', observedAnswer: '', actualAnswer: '', valueAnswer: '', rejectedAnswer: '', reasonAnswer: '', reflection: '' })
export function parseDraft(value: unknown, id: LabId): Draft {
  const d = value as Draft | null
  if (!d || d.labId !== id || !scenariosFor(id).includes(d.scenario) || !Array.isArray(d.commands) || d.commands.length > MAX_COMMANDS) throw new Error('协调实验记录无效。')
  for (const key of ['prediction', 'observedAnswer', 'actualAnswer', 'valueAnswer', 'rejectedAnswer', 'reasonAnswer', 'reflection'] as const) if (typeof d[key] !== 'string' || d[key].length > 4000) throw new Error('作答无效。')
  return { ...d, config: parseConfig(d.config), commands: Array.from(d.commands, parseCommand) }
}
export const identity = (d: Draft) => JSON.stringify([d.labId, d.scenario, d.config, d.commands])
export const answersIdentity = (d: Draft) => JSON.stringify([d.prediction, d.observedAnswer, d.actualAnswer, d.valueAnswer, d.rejectedAnswer, d.reasonAnswer, d.reflection])
export function scenarioCommands(c: Config, scenario: Exclude<Scenario, 'manual'>): Command[] {
  if (scenario === 'pause' || scenario === 'partition' || scenario === 'crash') return [{ type: 'send-heartbeat', worker: 'A' }, { type: 'deliver-heartbeat', heartbeatId: 'heartbeat-1' }, { type: scenario, worker: 'A' }, { type: 'advance', ms: c.timeoutMs }]
  if (scenario === 'false-suspicion') {
    const commands: Command[] = [{ type: 'acquire', worker: 'A' }, { type: 'pause', worker: 'A' }, { type: 'advance', ms: c.timeoutMs }, { type: 'acquire', worker: 'B' }, { type: 'resume', worker: 'A' }, { type: 'prepare-write', worker: 'A', value: 'A-valid' }]
    if (runModel(c, commands).writes.length) commands.push({ type: 'deliver-write', writeId: 'write-1' })
    return commands
  }
  const commands: Command[] = [{ type: 'acquire', worker: 'A' }, { type: 'prepare-write', worker: 'A', value: 'A-old' }, { type: 'pause', worker: 'A' }, { type: 'advance', ms: c.leaseMs }, { type: 'acquire', worker: 'B' }]
  if (scenario === 'fence-window') commands.push({ type: 'resume', worker: 'A' }, { type: 'deliver-write', writeId: 'write-1' })
  commands.push({ type: 'prepare-write', worker: 'B', value: 'B-new' }, { type: 'deliver-write', writeId: 'write-2' })
  if (scenario === 'stale-write') commands.push({ type: 'resume', worker: 'A' }, { type: 'deliver-write', writeId: 'write-1' })
  return commands
}
export function evaluate(d: Draft, s: State): Evaluation {
  try { if (!same(runModel(d.config, d.commands), s)) throw new Error('mismatch') } catch { return { evidence: false, task: false, explanation: false, status: 'inconclusive', messages: ['完整状态和事件不能重算核对。'] } }
  const observation = s.observations[0]!
  const worker = s.workers[0]!
  let task = false
  if (d.labId === 'heartbeat' && ['pause', 'partition', 'crash'].includes(d.scenario)) {
    const kind = d.scenario === 'pause' ? 'paused' : d.scenario === 'crash' ? 'crashed' : 'partition'
    const fault = s.events.find((e) => e.kind === kind && e.subject === 'A')
    task = !!fault && s.events.some((e) => e.kind === 'suspect' && e.subject === 'A' && e.index > fault.index)
  } else if (d.scenario === 'stale-write') task = s.writes[0]?.status === 'rejected' && s.writes[1]?.status === 'accepted' && s.resource.value === 'B-new' && s.events.some((e) => e.kind === 'paused')
  else if (d.scenario === 'false-suspicion') task = s.events.some((e) => e.kind === 'suspect' && e.subject === 'A') && s.events.some((e) => e.kind === 'lease-denied' && e.subject === 'B') && s.writes.some((w) => w.worker === 'A' && w.status === 'accepted') && s.lease?.owner === 'A'
  else if (d.scenario === 'fence-window') task = d.config.fencing && s.writes[0]?.status === 'accepted' && s.writes[1]?.status === 'accepted' && s.events.findIndex((e) => e.kind === 'write-accepted' && e.subject === 'write-1') < s.events.findIndex((e) => e.kind === 'write-accepted' && e.subject === 'write-2') && s.resource.value === 'B-new'
  task &&= !s.budgetHit
  const numeric = /^\d+$/.test(d.rejectedAnswer) && Number(d.rejectedAnswer) === s.writes.filter((w) => w.status === 'rejected').length
  const explanation = !!d.prediction && d.observedAnswer === observation.status && d.actualAnswer === worker.status && (d.labId === 'heartbeat' ? d.reasonAnswer === 'observation-not-proof' : d.valueAnswer === s.resource.value && numeric && d.reasonAnswer === 'resource-token-check')
  return { evidence: true, task, explanation, status: s.budgetHit ? 'inconclusive' : task ? 'pass' : d.commands.length ? 'fail' : 'inconclusive', messages: [
    `A 的实际进程状态：${worker.status}；观察者状态：${observation.status}；最近接收心跳时刻：${observation.lastReceivedAt ?? '尚未接收'}。`,
    '观察者只使用已收到心跳和自己的超时，不读取上方“真实进程状态”。故障怀疑不证明节点死亡。',
    ...(d.labId === 'lease-fencing' ? [`资源当前值 ${s.resource.value}，已接受最高 token ${s.resource.highestToken}，拒绝写入 ${s.writes.filter((w) => w.status === 'rejected').length} 次。`, '租约到期不删除网络中的旧写入；资源只按已见世代校验，不同步查询授予者。同一 token 内的顺序还需其他规则。'] : []),
    task ? '已经执行并观察到本关要求的故障与保护边界。' : d.scenario === 'false-suspicion' && d.config.timeoutMs >= d.config.leaseMs ? '当前租约在怀疑产生之前已到期。要观察本关边界，检测超时需短于租约有效期。' : '本关的故障或保护条件尚未满足，继续操作或调整策略。',
    explanation ? '观察、真实状态及边界解释符合证据。' : '请分别填写观察者判断与实际状态；资源实验还需核对结果及拒绝计数。',
    ...(s.budgetHit ? ['已达到样本预算，不能把预算造成的缺少心跳解释为系统故障。'] : []),
  ] }
}
export function runAttempt(value: Draft, id: LabId): Attempt { const draft = parseDraft(value, id); const result = runModel(draft.config, draft.commands); return { id: crypto.randomUUID(), exerciseId: id, exerciseVersion: 1, createdAt: Date.now(), draft: structuredClone(draft), result, evaluation: evaluate(draft, result) } }
export function verifyAttempt(value: unknown, id: LabId): value is Attempt { try { const a = value as Attempt; if (a.exerciseId !== id || a.exerciseVersion !== 1 || typeof a.id !== 'string' || !Number.isFinite(a.createdAt)) return false; const d = parseDraft(a.draft, id); const verdict = evaluate(d, a.result); return verdict.evidence && same(verdict, a.evaluation) } catch { return false } }
