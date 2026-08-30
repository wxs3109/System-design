import type { RuntimeEvent } from '@system-design/model'

export interface RuntimeFaultWindow {
  id: string
  startSeconds: number
  endSeconds: number
  reason: RuntimeEvent['reason']
  target: string
}

const faultKey = (event: RuntimeEvent) => [
  String(event.attributes.executionFaultId ?? event.attributes.faultId ?? `sequence-${event.sequence}`),
  String(event.attributes.targetKind ?? ''),
  String(event.attributes.targetId ?? event.nodeId ?? event.edgeId ?? ''),
].join(':')

export function runtimeFaultWindows(events: readonly RuntimeEvent[], simulatedDurationMs: number): RuntimeFaultWindow[] {
  const active = new Map<string, RuntimeFaultWindow>()
  const completed: RuntimeFaultWindow[] = []

  for (const event of events) {
    if (event.type === 'fault-activated') {
      const target = String(event.attributes.targetId ?? event.nodeId ?? event.edgeId ?? 'unknown target')
      active.set(faultKey(event), {
        id: String(event.attributes.faultId ?? `fault-${event.sequence}`),
        startSeconds: event.timestampMs / 1_000,
        endSeconds: simulatedDurationMs / 1_000,
        reason: event.reason,
        target,
      })
      continue
    }
    if (event.type !== 'fault-recovered') continue
    const key = faultKey(event)
    const window = active.get(key)
    if (!window) continue
    completed.push({ ...window, endSeconds: Math.min(simulatedDurationMs, event.timestampMs) / 1_000 })
    active.delete(key)
  }

  completed.push(...active.values())
  return completed
    .filter((window) => window.endSeconds >= window.startSeconds)
    .sort((left, right) => left.startSeconds - right.startSeconds || left.id.localeCompare(right.id))
}
