import { AlgorithmDatabase, LabRepository } from './repository'
import { LabSession } from './session'
export interface ProtocolDraft<C, Cmd> { scenario: string; config: C; commands: Cmd[]; prediction: string; answers: Record<string, string>; reflection: string }
export interface ProtocolVerdict { evidence: boolean; task: boolean; explanation: boolean; status: 'pass' | 'fail' | 'inconclusive'; messages: string[] }
export interface ProtocolAttempt<C, Cmd, S> { id: string; exerciseId: string; exerciseVersion: 1; createdAt: number; draft: ProtocolDraft<C, Cmd>; result: S; evaluation: ProtocolVerdict }
import { same } from './equality'
export { same } from './equality'
export function createProtocolLesson<C, Cmd, S>(options: {
  id: string; initialConfig: () => C; scenarios: Record<string, string>; maxCommands: number
  parseConfig: (value: unknown) => C; parseCommand: (value: unknown) => Cmd; runModel: (config: C, commands: readonly Cmd[]) => S
  assess: (draft: ProtocolDraft<C, Cmd>, result: S) => { task: boolean; expected: Record<string, string>; messages: string[] }
}) {
  type Draft = ProtocolDraft<C, Cmd>
  type Attempt = ProtocolAttempt<C, Cmd, S>
  const initial = (): Draft => ({ scenario: Object.keys(options.scenarios)[0]!, config: options.initialConfig(), commands: [], prediction: '', answers: {}, reflection: '' })
  const parseDraft = (value: unknown): Draft => {
    const d = value as Draft | null
    if (!d || !Object.hasOwn(options.scenarios, d.scenario) || !Array.isArray(d.commands) || d.commands.length > options.maxCommands || typeof d.prediction !== 'string' || d.prediction.length > 4000 || typeof d.reflection !== 'string' || d.reflection.length > 4000 || !d.answers || typeof d.answers !== 'object' || Array.isArray(d.answers)) throw new Error('实验记录无效。')
    const entries = Object.entries(d.answers)
    if (entries.length > 12 || entries.some(([key, value]) => !/^[a-zA-Z][a-zA-Z0-9]*$/.test(key) || typeof value !== 'string' || value.length > 4000)) throw new Error('实验作答无效。')
    return { scenario: d.scenario, config: options.parseConfig(d.config), commands: Array.from(d.commands, options.parseCommand), prediction: d.prediction, answers: Object.fromEntries(entries), reflection: d.reflection }
  }
  const evaluate = (d: Draft, s: S): ProtocolVerdict => {
    try { if (!same(options.runModel(d.config, d.commands), s)) throw new Error('mismatch') } catch { return { evidence: false, task: false, explanation: false, status: 'inconclusive', messages: ['完整状态和事件无法重算核对。'] } }
    const assessment = options.assess(d, s)
    const task = d.scenario !== 'manual' && assessment.task
    const explanation = !!d.prediction.trim() && Object.entries(assessment.expected).every(([key, value]) => (d.answers[key] ?? '').trim() === value)
    return { evidence: true, task, explanation, status: task ? 'pass' : d.commands.length ? 'fail' : 'inconclusive', messages: [...assessment.messages, task ? '实际证据满足本关要求。' : '本关目标尚未完成；自由实验只保存证据。', explanation ? '观察结果与边界解释符合证据。' : '请核对实际状态并完成边界解释。'] }
  }
  const runAttempt = (value: Draft): Attempt => { const draft = parseDraft(value); const result = options.runModel(draft.config, draft.commands); return { id: crypto.randomUUID(), exerciseId: options.id, exerciseVersion: 1, createdAt: Date.now(), draft: structuredClone(draft), result, evaluation: evaluate(draft, result) } }
  const verifyAttempt = (value: unknown): value is Attempt => { try { const a = value as Attempt; if (a.exerciseId !== options.id || a.exerciseVersion !== 1 || typeof a.id !== 'string' || !a.id || !Number.isFinite(a.createdAt)) return false; const e = evaluate(parseDraft(a.draft), a.result); return e.evidence && same(e, a.evaluation) } catch { return false } }
  const contract = { initial, parseDraft, runAttempt, verifyAttempt }
  const repository = (database = new AlgorithmDatabase()) => new LabRepository(database, `${options.id}:v1`, contract)
  const session = (database?: AlgorithmDatabase) => new LabSession(repository(database))
  return { ...contract, evaluate, repository, session }
}
