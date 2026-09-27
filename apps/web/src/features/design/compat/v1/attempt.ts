/** Frozen compatibility reader for the product attempts shipped in 3c2105f. */
import { newsFeedDesign } from './news-feed'
import { objectStorageDesign } from './object-storage'
import { mapsDesign } from './maps'
import { dispatchDesign } from './dispatch'
import { cloudDriveDesign } from './cloud-drive'
import type { ProductResult, DesignConfig } from './product-types'

export const legacyDesigns = [newsFeedDesign, objectStorageDesign, mapsDesign, dispatchDesign, cloudDriveDesign]
export interface LegacyProductDraft { scenario: string; config: DesignConfig; commands: string[]; prediction: string; answers: Record<string, string>; reflection: string }
export interface LegacyProductAttempt {
  id: string; exerciseId: string; exerciseVersion: 1; createdAt: number; draft: LegacyProductDraft; result: ProductResult
  evaluation: { evidence: boolean; task: boolean; explanation: boolean; status: 'pass' | 'fail' | 'inconclusive'; messages: string[] }
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
export function legacyEvaluation(designId: string, draft: LegacyProductDraft, result: ProductResult): LegacyProductAttempt['evaluation'] {
  const design = legacyDesigns.find(d => d.id === designId)!
  if (!same(design.run(draft.config, draft.commands), result)) return { evidence: false, task: false, explanation: false, status: 'inconclusive', messages: ['完整状态和事件无法重算核对。'] }
  const checks = design.scenarios.find(s => s.id === draft.scenario)?.check(result) ?? []
  const task = draft.scenario !== 'manual' && checks.length > 0 && checks.every(c => c.pass)
  const explanation = !!draft.prediction.trim()
  return { evidence: true, task, explanation, status: task ? 'pass' : draft.commands.length ? 'fail' : 'inconclusive', messages: [...checks.map(c => `${c.pass ? '✓' : '○'} ${c.label}：${c.detail}`), task ? '实际证据满足本关要求。' : '本关目标尚未完成；自由实验只保存证据。', explanation ? '观察结果与边界解释符合证据。' : '请核对实际状态并完成边界解释。'] }
}
export function verifyLegacyProductAttempt(designId: string, value: unknown): value is LegacyProductAttempt {
  try {
    const a = value as LegacyProductAttempt
    if (!a || 'formatVersion' in a || a.exerciseId !== designId || a.exerciseVersion !== 1 || typeof a.id !== 'string' || !a.id || !Number.isFinite(a.createdAt)) return false
    const definition = legacyDesigns.find(d => d.id === designId)!
    const d = a.draft
    if (!d || (d.scenario !== 'manual' && !definition.scenarios.some(s => s.id === d.scenario)) || !Array.isArray(d.commands) || d.commands.length > 120 || d.commands.some(c => !Object.hasOwn(definition.actions, c))) return false
    if (!d.config || Object.keys(d.config).length !== definition.fields.length || definition.fields.some(f => !f.options.some(o => o.value === d.config[f.id]))) return false
    if ([d.prediction, d.reflection].some(v => typeof v !== 'string' || v.length > 4000) || !d.answers || typeof d.answers !== 'object' || Array.isArray(d.answers)) return false
    if (Object.entries(d.answers).length > 12 || Object.entries(d.answers).some(([k,v]) => !/^[a-zA-Z][a-zA-Z0-9]*$/.test(k) || typeof v !== 'string' || v.length > 4000)) return false
    const evaluation = legacyEvaluation(designId, d, a.result)
    return evaluation.evidence && same(evaluation, a.evaluation)
  } catch { return false }
}
