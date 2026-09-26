import { compare, distribute, fingerprint, makeInput, methods, parseInput, same, type Comparison, type DistributionInput, type DistributionResult, type Method } from './model'

export const hashingExercise = {
  kind: 'algorithm' as const, id: 'consistent-hashing' as const, version: 1,
  title: '扩容时，哪些 key 需要换节点？', category: '数据分布', difficulty: '基础', estimatedMinutes: 20,
  summary: '亲手比较取模、哈希环与虚拟节点，追踪每个 key 的归属变化，区分重映射范围与分布均衡。',
  flow: ['预测变化', '增删节点', '追踪 key', '迁移挑战'],
}
export type Mode = 'add' | 'remove' | 'explore'
export interface Draft {
  mode: Mode
  input: DistributionInput
  baseline: DistributionInput | null
  prediction: string
  movedKey: string
  movedCount: string
  locality: string
  balance: string
  reflection: string
  operations: string[]
}
export interface Evaluation {
  evidence: boolean
  task: boolean
  explanation: boolean
  messages: string[]
}
export interface AlgorithmAttempt {
  id: string
  exerciseId: 'consistent-hashing'
  exerciseVersion: 1
  createdAt: number
  draft: Draft
  result: DistributionResult
  baselineResult: DistributionResult | null
  comparison: Comparison | null
  evaluation: Evaluation
}
export function challenge(mode: Mode = 'add', method: Method = 'modulo', virtualNodes = 32): Draft {
  const input = makeInput(mode === 'remove' ? 'transfer-lab' : 'hash-lab', mode === 'remove' ? 256 : 1024)
  input.method = method
  input.virtualNodes = method === 'vnodes' ? virtualNodes : 1
  if (mode === 'remove') input.nodes.push('node-e')
  return { mode, input, baseline: mode === 'explore' ? null : structuredClone(input), prediction: '', movedKey: '', movedCount: '', locality: '', balance: '', reflection: '', operations: [`开始${mode}实验`] }
}
export function parseDraft(value: unknown): Draft {
  if (!value || typeof value !== 'object') throw new Error('实验记录缺失。')
  const draft = value as Draft
  if (!['add', 'remove', 'explore'].includes(draft.mode)) throw new Error('未知挑战版本。')
  for (const field of ['prediction', 'movedKey', 'movedCount', 'locality', 'balance', 'reflection'] as const) {
    if (typeof draft[field] !== 'string' || draft[field].length > 4000) throw new Error('复盘记录无效。')
  }
  if (!Array.isArray(draft.operations) || draft.operations.some((item) => typeof item !== 'string')) throw new Error('操作记录无效。')
  return { mode: draft.mode, input: parseInput(draft.input), baseline: draft.baseline === null ? null : parseInput(draft.baseline),
    prediction: draft.prediction, movedKey: draft.movedKey, movedCount: draft.movedCount, locality: draft.locality, balance: draft.balance, reflection: draft.reflection, operations: [...draft.operations] }
}
export const experimentIdentity = (draft: Draft) => JSON.stringify([draft.mode, fingerprint(draft.input), draft.baseline ? fingerprint(draft.baseline) : null])
export const responseIdentity = (draft: Draft) => JSON.stringify([draft.prediction, draft.movedKey, draft.movedCount, draft.locality, draft.balance, draft.reflection])

export function evaluate(draft: Draft, result: DistributionResult, baseline: DistributionResult | null): Evaluation {
  try {
    if (!same(distribute(draft.input), result) || !same(draft.baseline ? distribute(draft.baseline) : null, baseline)) throw new Error('输入、结果或基线不匹配。')
  } catch {
    return { evidence: false, task: false, explanation: false, messages: ['证据不完整或无法重算，不能验证这次尝试。'] }
  }
  if (draft.mode === 'explore') return { evidence: true, task: false, explanation: false, messages: ['探索记录已计算；探索模式不计入指导题通过。'] }
  const expected = challenge(draft.mode, draft.input.method, draft.input.virtualNodes)
  const candidate = structuredClone(expected.input)
  candidate.nodes = draft.mode === 'add' ? [...candidate.nodes, 'node-e'] : candidate.nodes.filter((id) => id !== 'node-c')
  const task = !!draft.baseline && fingerprint(expected.input) === fingerprint(draft.baseline) && fingerprint(candidate) === fingerprint(draft.input) && draft.prediction.length > 0
  const comparison = baseline ? compare(baseline, result) : null
  if (!task || !comparison || !baseline) return { evidence: true, task: false, explanation: false, messages: [`按固定条件${draft.mode === 'add' ? '新增 node-e' : '移除 node-c'}，并保存一次预测。`] }
  const oldOwners = new Map(baseline.assignments.map((item) => [item.key, item.owner]))
  const moved = result.assignments.filter((item) => oldOwners.get(item.key) !== item.owner)
  const local = draft.mode === 'add' ? moved.every((item) => item.owner === 'node-e') : moved.every((item) => oldOwners.get(item.key) === 'node-c')
  const keyCorrect = moved.some((item) => item.key === draft.movedKey)
  const countCorrect = /^\d+$/.test(draft.movedCount) && Number(draft.movedCount) === comparison.remapped
  const localityCorrect = draft.locality === (local ? 'local' : 'spread')
  const balanceCorrect = draft.balance === 'separate'
  return { evidence: true, task: true, explanation: keyCorrect && countCorrect && localityCorrect && balanceCorrect,
    messages: [
      `本次 ${comparison.remapped} / ${result.input.keys.length} 个 key 需要重映射。预测允许出错，不影响最终判定。`,
      keyCorrect ? `已定位 ${draft.movedKey}：${oldOwners.get(draft.movedKey)} → ${result.assignments.find((item) => item.key === draft.movedKey)!.owner}。` : '从转移表中选一个实际更换 owner 的 key，填入证据。',
      countCorrect ? '重映射计数与完整 key 集一致。' : '请按本次完整结果填写需要重映射的 key 数。',
      localityCorrect ? '已正确识别本次变化涉及的节点范围。' : `检查所有变化项：${draft.mode === 'add' ? '是否都转向新增节点' : '是否都来自被移除节点'}？`,
      balanceCorrect ? '重映射范围与分布均衡是两个指标；有限样本不保证 V 越大越均衡。' : '低重映射比例不能单独证明分布均衡，请分别查看两个指标。',
      '自由复盘已保留；平台只核对可计算事实，不自动评判文字理解。',
    ] }
}
export function runAttempt(value: Draft): AlgorithmAttempt {
  const draft = parseDraft(value)
  const result = distribute(draft.input)
  const baselineResult = draft.baseline ? distribute(draft.baseline) : null
  return { id: crypto.randomUUID(), exerciseId: 'consistent-hashing', exerciseVersion: 1, createdAt: Date.now(), draft,
    result, baselineResult, comparison: baselineResult ? compare(baselineResult, result) : null, evaluation: evaluate(draft, result, baselineResult) }
}
export function verifyAttempt(value: unknown): value is AlgorithmAttempt {
  try {
    const attempt = value as AlgorithmAttempt
    if (attempt.exerciseId !== 'consistent-hashing' || attempt.exerciseVersion !== 1 || typeof attempt.id !== 'string' || !Number.isFinite(attempt.createdAt)) return false
    const draft = parseDraft(attempt.draft)
    const evaluation = evaluate(draft, attempt.result, attempt.baselineResult)
    return evaluation.evidence && same(evaluation, attempt.evaluation) && same(attempt.comparison, attempt.baselineResult ? compare(attempt.baselineResult, attempt.result) : null)
  } catch { return false }
}
export function learningProgress(attempts: AlgorithmAttempt[]) {
  const valid = attempts.filter((attempt) => attempt.evaluation.evidence && attempt.evaluation.task && attempt.evaluation.explanation)
  return { methods: methods.filter((method) => valid.some((attempt) => attempt.draft.mode === 'add' && attempt.draft.input.method === method)), transfer: valid.some((attempt) => attempt.draft.mode === 'remove') }
}
