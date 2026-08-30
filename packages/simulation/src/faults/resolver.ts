import type { Fault } from '@system-design/model'

export const resolveActiveFault = (faults: readonly Fault[], nodeId: string, type: Fault['type'], timeMs: number) => faults.find((fault) => {
  const start = fault.startAtSeconds * 1_000
  return fault.targetNodeId === nodeId && fault.type === type && timeMs >= start && timeMs < start + fault.durationSeconds * 1_000
})

export const applyCapacityFault = (configuredCapacity: number, fault: Fault | undefined) => fault
  ? Math.max(1, Math.floor(configuredCapacity * Math.min(1, fault.factor ?? 0.5)))
  : configuredCapacity

export const applyLatencyFault = (serviceTimeMs: number, fault: Fault | undefined) => serviceTimeMs * (fault ? fault.factor ?? 3 : 1)
