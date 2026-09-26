import { defaultConfig, MAX_COMMANDS, nextOperation, parseCommand, parseConfig, runModel, same, type Command, type Config, type State } from './model'
export const sagaExercise = { kind: 'protocol' as const, id: 'saga-recovery', version: 1, title: '视频流程部分成功，怎样收场？', category: '跨服务恢复', difficulty: '基础', estimatedMinutes: 30, summary: '预留配额、生成产物后让发布失败，逐步补偿，并处理补偿响应丢失、协调者崩溃与补偿失败。', flow: ['局部成功', '业务失败', '补偿与重试', '核对最终状态'] } as const
export const scenarioLabels = { 'response-lost': '补偿响应丢失', 'coordinator-crash': '补偿后、记进度前崩溃', 'compensation-failure': '补偿本身失败', manual: '自由实验' } as const
export type Scenario = keyof typeof scenarioLabels
export interface Draft { scenario: Scenario; config: Config; commands: Command[]; prediction: string; phaseAnswer: string; quotaAnswer: string; artifactsAnswer: string; workAnswer: string; reasonAnswer: string; reflection: string }
export interface Evaluation { evidence: boolean; task: boolean; explanation: boolean; settled: boolean; status: 'pass' | 'fail' | 'inconclusive'; messages: string[] }
export interface Attempt { id: string; exerciseId: 'saga-recovery'; exerciseVersion: 1; createdAt: number; draft: Draft; result: State; evaluation: Evaluation }
export const initialDraft = (): Draft => ({ scenario: 'response-lost', config: defaultConfig(), commands: [], prediction: '', phaseAnswer: '', quotaAnswer: '', artifactsAnswer: '', workAnswer: '', reasonAnswer: '', reflection: '' })
export function parseDraft(value: unknown): Draft { const d = value as Draft | null; if (!d || !Object.hasOwn(scenarioLabels, d.scenario) || !Array.isArray(d.commands) || d.commands.length > MAX_COMMANDS) throw new Error('Saga 记录无效。'); for (const field of ['prediction', 'phaseAnswer', 'quotaAnswer', 'artifactsAnswer', 'workAnswer', 'reasonAnswer', 'reflection'] as const) if (typeof d[field] !== 'string' || d[field].length > 4000) throw new Error('Saga 作答无效。'); return { ...d, config: parseConfig(d.config), commands: Array.from(d.commands, parseCommand) } }
export const identity = (d: Draft) => JSON.stringify([d.scenario, d.config, d.commands])
export const answersIdentity = (d: Draft) => JSON.stringify([d.prediction, d.phaseAnswer, d.quotaAnswer, d.artifactsAnswer, d.workAnswer, d.reasonAnswer, d.reflection])
export function scenarioCommands(c: Config, scenario: Exclude<Scenario, 'manual'>): Command[] {
  const commands: Command[] = []
  const apply = (command: Command) => { commands.push(command); return runModel(c, commands) }
  const send = () => apply({ type: 'send' }).packets.at(-1)!.id
  const finish = (id: string) => { apply({ type: 'deliver-request', packetId: id }); apply({ type: 'deliver-response', packetId: id }); apply({ type: 'checkpoint', packetId: id }) }
  apply({ type: 'start' }); finish(send()); finish(send()); apply({ type: 'block', operation: 'publish' }); finish(send())
  if (runModel(c, commands).phase !== 'compensating') return commands
  if (scenario === 'coordinator-crash') {
    const id = send(); apply({ type: 'deliver-request', packetId: id }); apply({ type: 'deliver-response', packetId: id }); apply({ type: 'crash' }); apply({ type: 'restart' }); finish(send()); finish(send())
  } else if (scenario === 'compensation-failure') {
    apply({ type: 'block', operation: 'cleanup' })
    for (let i = 0; i < c.maxAttempts; i++) finish(send())
    apply({ type: 'repair', operation: 'cleanup' }); apply({ type: 'resume-review' }); finish(send()); finish(send())
  } else {
    finish(send())
    const id = send(); apply({ type: 'deliver-request', packetId: id }); apply({ type: 'drop-response', packetId: id }); apply({ type: 'advance', ms: c.timeoutMs }); finish(send())
  }
  return commands
}
export function evaluate(d: Draft, s: State): Evaluation {
  try { if (!same(runModel(d.config, d.commands), s)) throw new Error('mismatch') } catch { return { evidence: false, task: false, explanation: false, settled: false, status: 'inconclusive', messages: ['完整状态和事件无法重算，不能核验证据。'] } }
  const settled = !s.packets.some((p) => p.status === 'network' || p.response === 'network' || p.response === 'delivered')
  const r = s.resource
  const quota = 1 - r.reserved + r.released
  const correct = s.phase === 'compensated' && s.journal.publish === 'rejected' && s.journal.cleanup === 'ok' && s.journal.release === 'ok' && !r.published && r.reserved === 1 && r.released === 1 && r.artifacts === 0 && r.transcodeWork === 1
  let fault = false
  if (d.scenario === 'response-lost') fault = s.packets.some((p) => p.operation === 'release' && p.outcome === 'ok' && p.response === 'dropped') && s.packets.filter((p) => p.operation === 'release').length >= 2
  if (d.scenario === 'coordinator-crash') { const effect = s.events.find((e) => e.kind === 'effect' && s.packets.find((p) => p.id === e.subject)?.operation === 'cleanup'); const crash = s.events.find((e) => e.kind === 'crashed' && effect && e.index > effect.index); fault = !!crash && s.events.some((e) => e.kind === 'checkpoint' && e.index > crash.index && s.packets.find((p) => p.id === e.subject)?.operation === 'cleanup') && !s.events.some((e) => e.kind === 'checkpoint' && e.index < crash.index && s.packets.find((p) => p.id === e.subject)?.operation === 'cleanup') }
  if (d.scenario === 'compensation-failure') fault = s.events.some((e) => e.kind === 'attention' && e.subject === 'cleanup') && s.events.some((e) => e.kind === 'review-resumed') && s.packets.some((p) => p.operation === 'cleanup' && p.outcome === 'unavailable')
  const task = correct && settled && fault
  const number = (answer: string, value: number) => /^-?\d+$/.test(answer) && Number(answer) === value
  const explanation = !!d.prediction && d.phaseAnswer === s.phase && number(d.quotaAnswer, quota) && number(d.artifactsAnswer, r.artifacts) && number(d.workAnswer, r.transcodeWork) && d.reasonAnswer === 'business-correction'
  return { evidence: true, task, explanation, settled, status: task ? 'pass' : d.commands.length ? 'fail' : 'inconclusive', messages: [
    `流程状态 ${s.phase}；可用配额 ${quota} / 1；剩余产物 ${r.artifacts}；累计转码工作 ${r.transcodeWork}；发布${r.published ? '成功' : '未成功'}。`,
    s.phase === 'attention' ? `当前需要人工核查，恢复位置为 ${nextOperation(s)}。修复后仍须执行并确认业务操作。` : '持久进度只使用协调者已经收到并保存的结果；服务端实际效果可能发生得更早。',
    correct ? '产物已清理、配额恰好返还一次；转码已经消耗的工作没有被撤销。' : '补偿后的业务账本尚未满足目标。重复返还、遗留产物或流程未收尾都不能当作成功。',
    settled ? '没有未递送或尚待记录的调用与响应。' : '仍有在途调用或未记录响应，不能认为最终状态已经稳定。',
    fault ? '已包含本关要求的补偿故障与恢复证据。' : '尚未经历本关要求的故障窗口；自由实验不自动算作本关验证。',
    explanation ? '最终状态与补偿边界解释符合证据。' : '请核对流程结果、可用配额、产物和累计工作；已补偿不等于发布成功，也不等于从未执行。',
  ] }
}
export function runAttempt(value: Draft): Attempt { const draft = parseDraft(value); const result = runModel(draft.config, draft.commands); return { id: crypto.randomUUID(), exerciseId: 'saga-recovery', exerciseVersion: 1, createdAt: Date.now(), draft: structuredClone(draft), result, evaluation: evaluate(draft, result) } }
export function verifyAttempt(value: unknown): value is Attempt { try { const a = value as Attempt; if (a.exerciseId !== 'saga-recovery' || a.exerciseVersion !== 1 || typeof a.id !== 'string' || !Number.isFinite(a.createdAt)) return false; const d = parseDraft(a.draft); const verdict = evaluate(d, a.result); return verdict.evidence && same(verdict, a.evaluation) } catch { return false } }
