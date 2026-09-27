import type { DesignCheck, DesignConfig, ProductDesign, ProductResult, ProductView } from './product-types'

type Field = ProductDesign['fields'][number]
type ConfigOf<F extends readonly Field[]> = { [Entry in F[number] as Entry['id']]: Entry['options'][number]['value'] }
type CommandsOf<A> = Extract<keyof A, string>
type Definition<F extends readonly Field[], A extends Readonly<Record<string, string>>, R extends ProductResult> = Omit<ProductDesign, 'fields' | 'initialConfig' | 'actions' | 'alternatives' | 'scenarios' | 'run' | 'present' | 'metricLabels' | 'versions'> & {
  fields: F; actions: A; initialConfig: NoInfer<ConfigOf<F>>
  alternatives: readonly { title: string; config: NoInfer<ConfigOf<F>> }[]
  versions: { model: NoInfer<R['modelVersion']>; definition: number; assessment: number }
  scenarios: readonly { id: string; title: string; goal: string; script: readonly NoInfer<CommandsOf<A>>[]; check: (result: NoInfer<R>) => DesignCheck[] }[]
  metricLabels: readonly { key: Extract<keyof NoInfer<R['metrics']>, string>; label: string }[]
  run: (config: ConfigOf<F>, commands: readonly CommandsOf<A>[]) => R
  present: (result: NoInfer<R>) => ProductView
}

/** The only type-erasure boundary: authoring is model-specific, host interfaces are generic. */
export function defineProductDesign<const F extends readonly Field[], const A extends Readonly<Record<string, string>>, R extends ProductResult>(definition: Definition<F, A, R>): ProductDesign {
  const parse = (config: DesignConfig): ConfigOf<F> => {
    if (Object.keys(config).length !== definition.fields.length || definition.fields.some(f => !Object.hasOwn(config, f.id) || !f.options.some(o => o.value === config[f.id]))) throw new Error('设计配置不符合声明的字段与选项。')
    return config as ConfigOf<F>
  }
  const run = (config: DesignConfig, commands: readonly string[]) => {
    if (commands.length > 120 || commands.some(c => !Object.hasOwn(definition.actions, c))) throw new Error('设计操作不符合声明或超过预算。')
    const result = definition.run(parse(config), commands as readonly CommandsOf<A>[])
    if (result.modelVersion !== definition.versions.model) throw new Error('模型结果版本不匹配。')
    return result
  }
  const scenarioIds = new Set<string>()
  for (const scenario of definition.scenarios) {
    if (scenarioIds.has(scenario.id) || scenario.id === 'manual' || !scenario.script.length || scenario.script.length > 120 || scenario.script.some(c => !Object.hasOwn(definition.actions, c))) throw new Error(`Invalid scenario registration: ${scenario.id}`)
    scenarioIds.add(scenario.id)
  }
  if (new Set(definition.fields.map(f => f.id)).size !== definition.fields.length) throw new Error('Duplicate design configuration field.')
  parse(definition.initialConfig); definition.alternatives.forEach(a => parse(a.config))
  const validateResult = (result: ProductResult): R => { if (result.modelVersion !== definition.versions.model) throw new Error('不能用另一个模型的结果构造展示或判定。'); return result as R }
  return {
    ...definition, run,
    present: result => definition.present(validateResult(result)),
    scenarios: definition.scenarios.map(s => ({ ...s, check: result => s.check(validateResult(result)) })),
  }
}
