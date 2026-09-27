export type EvidenceValue = null | boolean | number | string | EvidenceValue[] | { [key: string]: EvidenceValue }
export interface SemanticMessage { code: string; values: EvidenceValue[] }
export interface SemanticEvent { step: number; action: string; messages: SemanticMessage[] }

/** Capture values now; later model mutations cannot change earlier observations. */
export function evidenceValue(value: unknown): EvidenceValue {
  if (value === undefined || value === null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value)
  if (typeof value === 'string' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.map(evidenceValue)
  if (value instanceof Map) return evidenceValue(Object.fromEntries(value))
  if (value instanceof Set) return evidenceValue([...value])
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, evidenceValue(v)]))
  throw new Error('Model evidence must contain serializable values, not UI or runtime instances.')
}
export function semanticMessage(code: string, values: unknown[] = []): SemanticMessage {
  return { code, values: values.map(evidenceValue) }
}
