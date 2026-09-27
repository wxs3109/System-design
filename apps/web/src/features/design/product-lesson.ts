import { createProtocolLesson } from '../../core/experiments/protocol-lesson'
import type { DesignConfig, ProductDesign } from './product-types'

export const PRODUCT_COMMAND_LIMIT = 120
export function productLesson(design: ProductDesign) {
  return createProtocolLesson({
    id: design.id, initialConfig: () => ({ ...design.initialConfig }), maxCommands: PRODUCT_COMMAND_LIMIT,
    scenarios: Object.fromEntries([...design.scenarios.map((s) => [s.id, s.title]), ['manual', '自由探索']]),
    parseConfig: (value): DesignConfig => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('设计配置无效。')
      const record = value as Record<string, unknown>
      if (Object.keys(record).length !== design.fields.length || design.fields.some((f) => !Object.hasOwn(record, f.id) || !f.options.some((o) => o.value === record[f.id]))) throw new Error('配置不在本题声明的选项范围内。')
      return Object.fromEntries(design.fields.map((f) => [f.id, String(record[f.id])]))
    },
    parseCommand: (value): string => { if (typeof value !== 'string' || !Object.hasOwn(design.actions, value)) throw new Error('未知设计操作。'); return value },
    runModel: (config, commands) => { if (commands.length > PRODUCT_COMMAND_LIMIT) throw new Error('最多 120 步。'); return design.run(config, commands) },
    assess: (draft, result) => {
      const scenario = design.scenarios.find((s) => s.id === draft.scenario)
      const checks = scenario?.check(result) ?? []
      return { task: !!checks.length && checks.every((c) => c.pass), expected: {}, messages: checks.map((c) => `${c.pass ? '✓' : '○'} ${c.label}：${c.detail}`) }
    },
  })
}
