import type { Fault, FaultTarget, FaultType, ReasonCode } from '@system-design/model'

const faultTarget = (fault: Fault): FaultTarget | undefined =>
  fault.target ?? (fault.targetNodeId === undefined ? undefined : { kind: 'node', id: fault.targetNodeId })

export const faultStartsAtMs = (fault: Fault) => fault.startAtSeconds * 1_000
export const faultEndsAtMs = (fault: Fault) => (fault.startAtSeconds + fault.durationSeconds) * 1_000

export const isFaultActive = (fault: Fault, timeMs: number) =>
  fault.enabled && timeMs >= faultStartsAtMs(fault) && timeMs < faultEndsAtMs(fault)

export const resolveActiveFaults = (
  faults: readonly Fault[],
  targetKind: FaultTarget['kind'],
  targetId: string,
  type: FaultType,
  timeMs: number,
) => faults.filter((fault) => {
  const target = faultTarget(fault)
  return target?.kind === targetKind && target.id === targetId && fault.type === type && isFaultActive(fault, timeMs)
})

/** Backwards-compatible node lookup used by older runtime integrations. */
export const resolveActiveFault = (faults: readonly Fault[], nodeId: string, type: FaultType, timeMs: number) =>
  resolveActiveFaults(faults, 'node', nodeId, type, timeMs)[0]

const product = (faults: readonly Fault[], defaultFactor: number) => faults.reduce(
  (value, fault) => value * (fault.factor ?? defaultFactor),
  1,
)

export const applyCapacityFaults = (configuredCapacity: number, faults: readonly Fault[]) =>
  Math.max(1, Math.floor(configuredCapacity * Math.min(1, Math.max(0, product(faults, 0.5)))))

export const applyCapacityFault = (configuredCapacity: number, fault: Fault | undefined) =>
  applyCapacityFaults(configuredCapacity, fault === undefined ? [] : [fault])

export const applyLatencyFaults = (serviceTimeMs: number, faults: readonly Fault[]) =>
  serviceTimeMs * Math.max(1, product(faults, 3))

export const applyLatencyFault = (serviceTimeMs: number, fault: Fault | undefined) =>
  applyLatencyFaults(serviceTimeMs, fault === undefined ? [] : [fault])

export const composeLossProbability = (faults: readonly Fault[]) => 1 - faults.reduce(
  (survival, fault) => survival * (1 - Math.min(1, Math.max(0, fault.factor ?? 0.1))),
  1,
)

export const faultReason = (type: FaultType): ReasonCode => {
  switch (type) {
    case 'node-down': return 'node_down'
    case 'latency-spike': return 'latency_spike'
    case 'capacity-drop': return 'capacity_reduced'
    case 'bandwidth-drop': return 'bandwidth_reduced'
    case 'packet-loss': return 'packet_loss'
    case 'traffic-spike': return 'traffic_spike'
    case 'hot-key': return 'hot_key'
    case 'region-outage': return 'region_outage'
  }
}
