import { fingerprint, same } from '../distribution/model'
import { compareHot, defaultHotInput, generateWorkload, hotFingerprint, parseHotInput, runHotModel, topKeys, type HotComparison, type HotInput, type HotResult } from './model'

export const hotKeyExercise = { kind: 'algorithm' as const, id: 'hot-key' as const, version: 1,
  title: '数据均匀，为什么请求仍集中？', category: '热点与缓存', difficulty: '基础', estimatedMinutes: 25,
  summary: '对同一批 key 添加热点读取，观察虚拟节点的边界，再用逐条读缓存证据比较后端访问。',
  flow: ['观察热度', '改变分片', '验证缓存', '解释边界'] }
export const stageLabels = { hotspot: '发现热点', shards: '虚拟节点的边界', cache: '缓存对照', explore: '自由探索' } as const
export type Stage = keyof typeof stageLabels
export const caseLabels = { shortlink: '热门短链接', feed: '热门 Feed 内容', video: '热门视频资源', chat: '热门群会话' } as const
export interface HotDraft {
  stage: Stage; input: HotInput; baseline: HotInput | null
  prediction: string; keyAnswer: string; requestAnswer: string; ownerAnswer: string; backendAnswer: string; meaning: string; caseId: string; caseMeaning: string; reflection: string
  operations: string[]
}
export interface HotEvaluation { evidence: boolean; task: boolean; explanation: boolean; messages: string[] }
export interface HotAttempt {
  id: string; exerciseId: 'hot-key'; exerciseVersion: 1; createdAt: number
  draft: HotDraft; result: HotResult; baselineResult: HotResult | null; comparison: HotComparison | null; evaluation: HotEvaluation
}
export function hotChallenge(stage: Stage = 'hotspot'): HotDraft {
  const input = defaultHotInput()
  if (stage === 'hotspot') input.workload = generateWorkload(input.distribution, { pattern: 'uniform' })
  if (stage === 'shards') input.distribution.virtualNodes = 8
  return { stage, input, baseline: stage === 'explore' ? null : structuredClone(input), prediction: '', keyAnswer: '', requestAnswer: '', ownerAnswer: '', backendAnswer: '', meaning: '', caseId: '', caseMeaning: '', reflection: '', operations: [`开始：${stageLabels[stage]}`] }
}
export function parseHotDraft(value: unknown): HotDraft {
  if (!value || typeof value !== 'object') throw new Error('热点实验记录缺失。')
  const draft = value as HotDraft
  if (!Object.hasOwn(stageLabels, draft.stage)) throw new Error('未知热点挑战版本。')
  for (const key of ['prediction', 'keyAnswer', 'requestAnswer', 'ownerAnswer', 'backendAnswer', 'meaning', 'caseId', 'caseMeaning', 'reflection'] as const) if (typeof draft[key] !== 'string' || draft[key].length > 4000) throw new Error('作答内容无效。')
  if (!Array.isArray(draft.operations) || draft.operations.some((item) => typeof item !== 'string')) throw new Error('操作记录无效。')
  return { ...draft, input: parseHotInput(draft.input), baseline: draft.baseline === null ? null : parseHotInput(draft.baseline), operations: [...draft.operations] }
}
export const hotIdentity = (draft: HotDraft) => JSON.stringify([draft.stage, hotFingerprint(draft.input), draft.baseline ? hotFingerprint(draft.baseline) : null])
export const hotResponses = (draft: HotDraft) => JSON.stringify([draft.prediction, draft.keyAnswer, draft.requestAnswer, draft.ownerAnswer, draft.backendAnswer, draft.meaning, draft.caseId, draft.caseMeaning, draft.reflection])

function gradeComputed(draft: HotDraft, result: HotResult, baseline: HotResult | null): HotEvaluation {
  if (draft.stage === 'explore') return { evidence: true, task: false, explanation: false, messages: ['探索结果已记录；探索模式不计指导题通过。可固定基线并只改变一个条件。'] }
  const expected = hotChallenge(draft.stage)
  let task = !!draft.baseline && hotFingerprint(draft.baseline) === hotFingerprint(expected.input) && !!draft.prediction
  const input = draft.input
  if (draft.stage === 'hotspot') {
    expected.input.workload = generateWorkload(expected.input.distribution, { pattern: 'hotspot', probability: input.workload.probability })
    task &&= hotFingerprint(input) === hotFingerprint(expected.input)
  } else if (draft.stage === 'shards') {
    expected.input.distribution.virtualNodes = input.distribution.virtualNodes
    expected.input.distribution.nodes = input.distribution.nodes
    task &&= same(input.distribution.nodes, ['node-a', 'node-b', 'node-c', 'node-d']) || same(input.distribution.nodes, ['node-a', 'node-b', 'node-c', 'node-d', 'node-e'])
    task &&= input.distribution.method === 'vnodes' && [8, 32, 128].includes(input.distribution.virtualNodes) && hotFingerprint(input) === hotFingerprint(expected.input) && fingerprint(input.distribution) !== fingerprint(draft.baseline!.distribution)
  } else {
    expected.input.cache = input.cache
    task &&= input.cache.enabled && hotFingerprint(input) === hotFingerprint(expected.input)
  }
  const comparison = baseline && draft.baseline ? compareHot(draft.baseline, baseline, input, result) : null
  if (!task || !comparison) return { evidence: true, task: false, explanation: false, messages: [draft.stage === 'hotspot' ? '先记录预测，再将固定均匀负载改为热点负载。' : draft.stage === 'shards' ? '保持请求序列，增加虚拟节点或新增 node-e，验证热门 key 的归属。' : '保持同一请求序列和分配方式，启用只读缓存完成对照。'] }
  const hot = topKeys(result)[0]!
  const numeric = (text: string, value: number) => /^\d+$/.test(text) && Number(text) === value
  const keyCorrect = draft.keyAnswer === hot.key
  const requestsCorrect = numeric(draft.requestAnswer, hot.requests)
  const ownerCorrect = draft.ownerAnswer === hot.owner
  const backendCorrect = numeric(draft.backendAnswer, result.totals.backendReads)
  const meaningCorrect = draft.meaning === (draft.stage === 'cache' ? 'cache-boundary' : 'single-owner')
  const caseCorrect = Object.hasOwn(caseLabels, draft.caseId) && draft.caseMeaning === 'read-hotspot'
  return { evidence: true, task: true, explanation: keyCorrect && requestsCorrect && ownerCorrect && backendCorrect && meaningCorrect && caseCorrect, messages: [
    `${hot.key} 实际读取 ${hot.requests} / ${result.totals.reads} 次，物理 owner 为 ${hot.owner}。目标概率与本次实际比例分别展示。`,
    keyCorrect && requestsCorrect && ownerCorrect ? '热门 key、请求计数和节点归属与逐条证据一致。' : '从热度表选择实际最热门的 key，并核对它的请求次数和物理 owner。',
    backendCorrect ? `后端读取数已核对：${result.totals.backendReads}。` : '请核对本次总后端读取次数；命中返回不算后端访问。',
    meaningCorrect ? draft.stage === 'cache' ? '后端访问减少；本模型没有评估缓存自身容量，因此不能断言系统没有瓶颈。' : '一个 key 的所有读取仍映射到一个物理 owner；虚拟节点不能自动拆散这个 key。' : '重新区分 key 数、请求数和后端读取数；这些计数不是吞吐上限或延迟。',
    caseCorrect ? `已关联${caseLabels[draft.caseId as keyof typeof caseLabels]}的读取热点。` : '选择一个应用背景：这里验证读取集中，不验证 Celebrity 写扩散或消息交付。',
    `比较类型：${comparison.kind === 'workload' ? '负载变化，采样值保持相同' : '策略变化，完整请求序列保持相同'}。预测不计对错；自由复盘保存原文，不自动判分。`,
  ] }
}
export function runHotAttempt(value: HotDraft): HotAttempt {
  const draft = parseHotDraft(value)
  const result = runHotModel(draft.input)
  const baselineResult = draft.baseline ? runHotModel(draft.baseline) : null
  return { id: crypto.randomUUID(), exerciseId: 'hot-key', exerciseVersion: 1, createdAt: Date.now(), draft: structuredClone(draft), result, baselineResult,
    comparison: baselineResult && draft.baseline ? compareHot(draft.baseline, baselineResult, draft.input, result) : null,
    evaluation: gradeComputed(draft, result, baselineResult) }
}
export function verifyHotAttempt(value: unknown): value is HotAttempt {
  try {
    const attempt = value as HotAttempt
    if (attempt.exerciseId !== 'hot-key' || attempt.exerciseVersion !== 1 || typeof attempt.id !== 'string' || !Number.isFinite(attempt.createdAt)) return false
    const draft = parseHotDraft(attempt.draft)
    const result = runHotModel(draft.input)
    const baseline = draft.baseline ? runHotModel(draft.baseline) : null
    return same(result, attempt.result) && same(baseline, attempt.baselineResult) && same(gradeComputed(draft, result, baseline), attempt.evaluation) && same(baseline && draft.baseline ? compareHot(draft.baseline, baseline, draft.input, result) : null, attempt.comparison)
  } catch { return false }
}
export const hotProgress = (attempts: HotAttempt[]) => (['hotspot', 'shards', 'cache'] as const).filter((stage) => attempts.some((attempt) => attempt.draft.stage === stage && attempt.evaluation.evidence && attempt.evaluation.task && attempt.evaluation.explanation))
