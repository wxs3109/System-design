import { AlgorithmDatabase, LabRepository } from '../../core/experiments/repository'
import { LabSession } from '../../core/experiments/session'
import { same } from '../../core/experiments/equality'
import { sameVersions, type ExperimentVersions } from '../../core/experiments/versions'
import { verifyLegacyProductAttempt, type LegacyProductAttempt, type LegacyProductDraft } from './compat/v1/attempt'
import type { ProductDesign, ProductResult } from './product-types'

export const PRODUCT_COMMAND_LIMIT = 120
export type ProductDraft = LegacyProductDraft
export interface ProductAssessment { evidence: boolean; task: boolean; status: 'pass' | 'fail' | 'inconclusive'; checks: { id: string; passed: boolean }[] }
export interface CurrentProductAttempt {
  id: string; exerciseId: string; exerciseVersion: number; createdAt: number; formatVersion: 2
  versions: ExperimentVersions; draft: ProductDraft; result: ProductResult; evaluation: ProductAssessment
}
export type ProductAttempt = CurrentProductAttempt | LegacyProductAttempt
export const isCurrentProductAttempt = (attempt: ProductAttempt): attempt is CurrentProductAttempt => 'formatVersion' in attempt && attempt.formatVersion === 2

export function productLesson(design: ProductDesign) {
  const initial = (): ProductDraft => ({ scenario: design.scenarios[0]!.id, config: { ...design.initialConfig }, commands: [], prediction: '', answers: {}, reflection: '' })
  const parseDraft = (value: unknown): ProductDraft => {
    const d = value as ProductDraft
    if (!d || (d.scenario !== 'manual' && !design.scenarios.some(s => s.id === d.scenario))) throw new Error('未知设计场景。')
    if (!d.config || typeof d.config !== 'object' || Array.isArray(d.config) || Object.keys(d.config).length !== design.fields.length || design.fields.some(f => !Object.hasOwn(d.config, f.id) || !f.options.some(o => o.value === d.config[f.id]))) throw new Error('配置不在本题声明的选项范围内。')
    if (!Array.isArray(d.commands) || d.commands.length > PRODUCT_COMMAND_LIMIT || d.commands.some(c => typeof c !== 'string' || !Object.hasOwn(design.actions, c))) throw new Error('未知操作或超过操作预算。')
    if ([d.prediction, d.reflection].some(v => typeof v !== 'string' || v.length > 4000) || !d.answers || typeof d.answers !== 'object' || Array.isArray(d.answers) || Object.entries(d.answers).length > 12 || Object.entries(d.answers).some(([k,v]) => !/^[a-zA-Z][a-zA-Z0-9]*$/.test(k) || typeof v !== 'string' || v.length > 4000)) throw new Error('设计笔记格式无效。')
    return structuredClone({ scenario: d.scenario, config: Object.fromEntries(design.fields.map(f => [f.id, d.config[f.id]!])), commands: d.commands, prediction: d.prediction, answers: d.answers, reflection: d.reflection })
  }
  const assess = (draft: ProductDraft, result: ProductResult): ProductAssessment => {
    const checks = design.scenarios.find(s => s.id === draft.scenario)?.check(result).map((c, i) => ({ id: `${draft.scenario}:${i + 1}`, passed: c.pass })) ?? []
    const task = checks.length > 0 && checks.every(c => c.passed)
    return { evidence: true, task, status: task ? 'pass' : draft.commands.length ? 'fail' : 'inconclusive', checks }
  }
  const evaluate = (draft: ProductDraft, result: ProductResult): ProductAssessment => {
    try { if (result.modelVersion !== design.versions.model || !same(design.run(draft.config, draft.commands), result)) throw new Error('mismatch') }
    catch { return { evidence: false, task: false, status: 'inconclusive', checks: [] } }
    return assess(draft, result)
  }
  const runAttempt = (value: ProductDraft): CurrentProductAttempt => {
    const draft = parseDraft(value); const result = design.run(draft.config, draft.commands)
    if (result.modelVersion !== design.versions.model) throw new Error('模型版本与注册信息不一致。')
    return { id: crypto.randomUUID(), exerciseId: design.id, exerciseVersion: design.versions.definition, createdAt: Date.now(), formatVersion: 2, versions: { ...design.versions }, draft, result, evaluation: assess(draft, result) }
  }
  const verifyAttempt = (value: unknown): value is ProductAttempt => {
    if (verifyLegacyProductAttempt(design.id, value)) return true
    try {
      const a = value as CurrentProductAttempt
      if (!a || a.formatVersion !== 2 || a.exerciseId !== design.id || a.exerciseVersion !== design.versions.definition || typeof a.id !== 'string' || !a.id || !Number.isFinite(a.createdAt) || !a.versions || !sameVersions(a.versions, design.versions)) return false
      const evaluation = evaluate(parseDraft(a.draft), a.result)
      return evaluation.evidence && same(evaluation, a.evaluation)
    } catch { return false }
  }
  const contract = { initial, parseDraft, runAttempt, verifyAttempt, versions: design.versions, draftVersion: 1 }
  const repository = (db = new AlgorithmDatabase()) => new LabRepository<ProductDraft, ProductAttempt>(db, `${design.id}:v1`, contract)
  const session = (db?: AlgorithmDatabase) => new LabSession(repository(db))
  return { ...contract, evaluate, repository, session }
}
export function productFeedback(design: ProductDesign, attempt: ProductAttempt): string[] {
  // v1's final message was a protocol-explanation prompt. Its position is part of that frozen format.
  if (!isCurrentProductAttempt(attempt)) return attempt.evaluation.messages.slice(0, -1)
  const checks = design.scenarios.find(s => s.id === attempt.draft.scenario)?.check(attempt.result) ?? []
  return [...checks.map(c => `${c.pass ? '✓' : '○'} ${c.label}：${c.detail}`), attempt.evaluation.task ? '实际证据满足本关要求。' : '本关目标尚未完成；自由实验只保存证据。']
}
export function compatibleProductAttempt(design: ProductDesign, attempt: ProductAttempt): boolean {
  if (attempt.exerciseId !== design.id) return false
  if (isCurrentProductAttempt(attempt)) return sameVersions(attempt.versions, design.versions)
  const legacyModels: Record<string, string> = { 'design-news-feed': 'news-feed-v1', 'design-object-storage': 'object-storage-v1', 'design-maps': 'maps-v1', 'design-dispatch': 'dispatch-v1', 'design-cloud-drive': 'cloud-drive-v1' }
  return sameVersions({ model: legacyModels[attempt.exerciseId] ?? '', definition: 1, assessment: 1 }, design.versions)
}
