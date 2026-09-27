import { sameAssessment, sameTimelineEvidence } from '../../../core/experiments/timeline-evidence'
import { clientStatus, defaultConfig, isSettled, MAX_COMMANDS, parseCommand, parseConfig, runProtocol, same, type Command, type ProtocolState, type RetryConfig } from './model'

export const retryExercise = { kind: 'protocol' as const, id: 'retry-idempotency' as const, version: 1,
  title: '任务创建了，响应却丢了', category: '请求可靠性', difficulty: '基础', estimatedMinutes: 25,
  summary: '亲手递送或丢弃请求与响应，推进超时，观察普通重试如何重复创建任务，以及原子幂等怎样重放结果。',
  flow: ['提交请求', '制造故障', '观察重试', '核对业务效果'] }
export const scenarioLabels = { 'response-lost': '创建后丢响应', 'request-lost': '请求没有到达', 'late-request': '旧请求延迟到达', manual: '自由实验' } as const
export type Scenario = keyof typeof scenarioLabels
export interface RetryDraft {
  scenario: Scenario; config: RetryConfig; commands: Command[]
  prediction: string; createdAnswer: string; clientAnswer: string; reasonAnswer: string; reflection: string
}
export interface Evaluation {
  evidence: boolean; faultObserved: boolean; noDuplicate: boolean; clientInformed: boolean; settled: boolean; explanation: boolean
  status: 'pass' | 'fail' | 'inconclusive'; messages: string[]
}
export interface RetryAttempt {
  id: string; exerciseId: 'retry-idempotency'; exerciseVersion: 1; createdAt: number; draft: RetryDraft; result: ProtocolState; evaluation: Evaluation
}
export const initialDraft = (): RetryDraft => ({ scenario: 'response-lost', config: defaultConfig(), commands: [], prediction: '', createdAnswer: '', clientAnswer: '', reasonAnswer: '', reflection: '' })
export function parseDraft(value: unknown): RetryDraft {
  if (!value || typeof value !== 'object') throw new Error('实验记录缺失。')
  const draft = value as RetryDraft
  if (!Object.hasOwn(scenarioLabels, draft.scenario) || !Array.isArray(draft.commands) || draft.commands.length > MAX_COMMANDS) throw new Error('未知场景或操作预算超限。')
  for (const key of ['prediction', 'createdAnswer', 'clientAnswer', 'reasonAnswer', 'reflection'] as const) if (typeof draft[key] !== 'string' || draft[key].length > 4000) throw new Error('作答无效。')
  return { scenario: draft.scenario, config: parseConfig(draft.config), commands: Array.from(draft.commands, parseCommand), prediction: draft.prediction, createdAnswer: draft.createdAnswer, clientAnswer: draft.clientAnswer, reasonAnswer: draft.reasonAnswer, reflection: draft.reflection }
}
export const experimentIdentity = (draft: RetryDraft) => JSON.stringify([draft.scenario, draft.config, draft.commands])
export const responseIdentity = (draft: RetryDraft) => JSON.stringify([draft.prediction, draft.createdAnswer, draft.clientAnswer, draft.reasonAnswer, draft.reflection])

/** Drives the same command reducer as manual controls. No expected metrics are
 * injected. A disabled/exhausted retry policy simply has no second request. */
export function scenarioCommands(config: RetryConfig, scenario: Exclude<Scenario, 'manual'>): Command[] {
  const commands: Command[] = [{ type: 'submit' }]
  const finish = (id: number) => commands.push({ type: 'deliver-request', requestId: `request-${id}` }, { type: 'commit', requestId: `request-${id}` }, { type: 'deliver-response', responseId: `response-${id}` })
  if (scenario === 'response-lost') commands.push({ type: 'deliver-request', requestId: 'request-1' }, { type: 'commit', requestId: 'request-1' }, { type: 'drop-response', responseId: 'response-1' })
  if (scenario === 'request-lost') commands.push({ type: 'drop-request', requestId: 'request-1' })
  commands.push({ type: 'advance', ms: config.timeoutMs + config.retryDelayMs })
  const state = runProtocol(config, commands)
  if (state.requests.some((request) => request.id === 'request-2')) finish(2)
  if (scenario === 'late-request') finish(1)
  return commands
}
export function evaluate(draft: RetryDraft, result: ProtocolState): Evaluation {
  const invalid: Evaluation = { evidence: false, faultObserved: false, noDuplicate: false, clientInformed: false, settled: false, explanation: false, status: 'inconclusive', messages: ['输入或运行证据不能完整重算，无法验证。'] }
  try { if (!sameTimelineEvidence(runProtocol(draft.config, draft.commands), result)) return invalid } catch { return invalid }
  const events = result.events
  const firstDropResponse = events.some((event) => event.kind === 'response-dropped' && event.requestId === 'request-1')
  const firstDropRequest = events.some((event) => event.kind === 'request-dropped' && event.requestId === 'request-1')
  const secondCommit = events.find((event) => event.kind.startsWith('transaction-') && event.requestId === 'request-2')?.index
  const firstArrival = events.find((event) => event.kind === 'request-delivered' && event.requestId === 'request-1')?.index
  const faultObserved = draft.scenario === 'manual' ? true : draft.scenario === 'response-lost' ? firstDropResponse : draft.scenario === 'request-lost' ? firstDropRequest : secondCommit !== undefined && firstArrival !== undefined && secondCommit < firstArrival
  const tasks = result.store.tasks
  const noDuplicate = tasks.length <= 1
  const sameIntent = result.requests.every((request) => request.callerId === draft.config.callerId && same(request.payload, draft.config.payload))
  const clientInformed = tasks.length === 1 && result.knownTaskIds.length === 1 && tasks[0]!.id === result.knownTaskIds[0] && same(tasks[0]!.payload, draft.config.payload) && result.rejectedRequestIds.length === 0 && sameIntent
  const settled = isSettled(result)
  const explanation = draft.prediction.length > 0 && /^\d+$/.test(draft.createdAnswer) && Number(draft.createdAnswer) === tasks.length && draft.clientAnswer === clientStatus(result) && draft.reasonAnswer === 'unknown-does-not-mean-failed'
  const status = !settled ? 'inconclusive' : !noDuplicate || !clientInformed || !faultObserved ? 'fail' : 'pass'
  return { evidence: true, faultObserved, noDuplicate, clientInformed, settled, explanation, status, messages: [
    `服务端实际创建 ${tasks.length} 个任务；客户端获知 ${result.knownTaskIds.length ? result.knownTaskIds.join('、') : '零个任务结果'}。这是两个不同视角。`,
    noDuplicate ? tasks.length ? '目前只有一个业务任务。' : '目前没有重复，但也没有任务完成，不能靠不执行获得通过。' : '发现重复业务效果：同一次提交意图产生了多个任务。',
    clientInformed ? '客户端已经收到唯一任务的合法结果。' : '客户端尚未获知唯一合法结果，或请求意图/参数存在冲突。',
    settled ? '所有在途消息和计时器已结算。' : '仍有在途消息、未提交请求或计时器；后续动作可能改变结果，当前不能定论。',
    faultObserved ? draft.scenario === 'manual' ? '自由实验已记录；不计入指定故障挑战进度。' : '已观察到本关要求的故障时序。' : '尚未实际执行本关要求的故障时序。',
    explanation ? '任务计数、客户端视角与超时解释符合当前证据。初始预测允许出错。' : '请根据当前证据填写创建次数、客户端状态，并解释超时的含义。',
    ...(events.some((event) => event.kind === 'dedupe-expired') ? ['去重记录已经到期。保留期外的迟到请求可能再次创建任务；任务表本身并未被清空。'] : []),
  ] }
}
export function runAttempt(value: RetryDraft): RetryAttempt {
  const draft = parseDraft(value)
  const result = runProtocol(draft.config, draft.commands)
  return { id: crypto.randomUUID(), exerciseId: 'retry-idempotency', exerciseVersion: 1, createdAt: Date.now(), draft: structuredClone(draft), result, evaluation: evaluate(draft, result) }
}
export function verifyAttempt(value: unknown): value is RetryAttempt {
  try {
    const attempt = value as RetryAttempt
    if (attempt.exerciseId !== 'retry-idempotency' || attempt.exerciseVersion !== 1 || typeof attempt.id !== 'string' || !Number.isFinite(attempt.createdAt)) return false
    const draft = parseDraft(attempt.draft)
    const evaluation = evaluate(draft, attempt.result)
    return evaluation.evidence && sameAssessment(evaluation, attempt.evaluation)
  } catch { return false }
}
export function progress(attempts: readonly RetryAttempt[]) {
  return (['response-lost', 'request-lost', 'late-request'] as const).filter((scenario) => attempts.some((attempt) => attempt.draft.scenario === scenario && attempt.evaluation.status === 'pass' && attempt.evaluation.explanation))
}
