export interface RegisterOperation { id: string; kind: 'write' | 'read'; value: string; invoked: number; returned: number | null; result: string | null }
export interface HistoryCheck { status: 'linearizable' | 'violation' | 'incomplete'; witness: string[] }
/** Exhaustive bounded register-history checker, with real-time precedence and memoized failed states. */
export function checkRegisterHistory(history: readonly RegisterOperation[]): HistoryCheck {
  if (!history.length || history.length > 8 || history.some((op) => op.returned === null)) return { status: 'incomplete', witness: [] }
  const prerequisites = history.map((op) => history.reduce((mask, before, i) => before.returned! < op.invoked ? mask | 1 << i : mask, 0))
  const failed = new Set<string>(); const full = (1 << history.length) - 1
  const visit = (mask: number, value: string, order: string[]): string[] | null => {
    if (mask === full) return order
    const key = JSON.stringify([mask, value]); if (failed.has(key)) return null
    for (let i = 0; i < history.length; i++) {
      const op = history[i]!
      if (mask & 1 << i || (mask & prerequisites[i]!) !== prerequisites[i] || op.kind === 'read' && op.result !== value) continue
      const witness = visit(mask | 1 << i, op.kind === 'write' ? op.value : value, [...order, op.id])
      if (witness) return witness
    }
    failed.add(key); return null
  }
  const witness = visit(0, 'initial', [])
  return { status: witness ? 'linearizable' : 'violation', witness: witness ?? [] }
}
