import { same } from './equality'

/** Explicit adapter for existing protocol states. Only timeline captions are display data.
 * Payloads, packets, event identity/order, clocks and all other state remain evidence.
 */
export function timelineEvidence(value: unknown, diagnostics: { text?: readonly string[]; counted?: readonly string[] } = {}): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const result = { ...value } as Record<string, unknown>
  if (Array.isArray(result.events)) result.events = result.events.map(event => {
    if (!event || typeof event !== 'object' || Array.isArray(event)) return event
    const copy = { ...event } as Record<string, unknown>
    if (typeof copy.kind === 'string' && typeof copy.index === 'number' && typeof copy.at === 'number' && typeof copy.detail === 'string') delete copy.detail
    return copy
  })
  for (const key of diagnostics.text ?? []) if (typeof result[key] === 'string') result[key] = Boolean(result[key])
  for (const key of diagnostics.counted ?? []) if (Array.isArray(result[key]) && result[key].every(v => typeof v === 'string')) result[key] = { count: result[key].length }
  return result
}
export const sameTimelineEvidence = (a: unknown, b: unknown) => same(timelineEvidence(a), timelineEvidence(b))
/** Assessment messages are a view cache; all verdict flags and structured checks remain binding. */
export function sameAssessment(a: unknown, b: unknown): boolean {
  const evidence = (value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value
    const copy = { ...value } as Record<string, unknown>
    if (Array.isArray(copy.messages) && copy.messages.every(m => typeof m === 'string')) delete copy.messages
    return copy
  }
  return same(evidence(a), evidence(b))
}
