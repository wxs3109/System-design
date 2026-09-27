export type ChoiceSchema<C> = { [K in keyof C]: readonly C[K][] }
/** Parse finite authored scalar choices and discard undeclared fields. */
export function parseChoiceConfig<C extends object>(value: unknown, schema: ChoiceSchema<C>): C {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('实验配置无效。')
  const source = value as C
  return Object.fromEntries((Object.keys(schema) as (keyof C)[]).map(key => {
    if (!schema[key].includes(source[key])) throw new Error(`配置选项无效：${String(key)}`)
    return [key, source[key]]
  })) as C
}
