import type { NodeMetrics, RuntimeEvent } from '@system-design/model'
import { round } from './math'

export type BottleneckRuleId =
  | 'sustained-saturation'
  | 'retry-amplification'
  | 'hot-shard'
  | 'cache-miss-database-load'
  | 'open-circuit-rejections'

export type EvidenceUnit = 'count' | 'ratio' | 'multiplier' | 'requests'

export interface BottleneckEvidence {
  key: string
  label: string
  value: number
  unit: EvidenceUnit
  threshold?: number
  sourceEventSequences: number[]
}

export interface BottleneckFinding {
  id: string
  ruleId: BottleneckRuleId
  title: string
  summary: string
  interval: { startMs: number; endMs: number }
  target: { nodeId?: string; edgeId?: string; relatedNodeId?: string }
  evidence: BottleneckEvidence[]
  traceIds: string[]
}

const SATURATION_THRESHOLD = 0.8
const MIN_CORRELATED_MISSES = 5
const MAX_TRACE_LINKS = 8

const numericAttribute = (event: RuntimeEvent, key: string) => {
  const value = event.attributes[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

const nodeName = (nodes: readonly Pick<NodeMetrics, 'nodeId' | 'nodeName'>[], nodeId: string | undefined) =>
  nodes.find((node) => node.nodeId === nodeId)?.nodeName ?? nodeId ?? 'Unknown component'

const uniqueTraceIds = (events: readonly RuntimeEvent[]) => [...new Set(events.flatMap((event) => event.traceId === undefined ? [] : [event.traceId]))]
  .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
  .slice(0, MAX_TRACE_LINKS)

const sequences = (events: readonly RuntimeEvent[]) => [...new Set(events.map((event) => event.sequence))].sort((left, right) => left - right)

const intervalOf = (events: readonly RuntimeEvent[]) => ({
  startMs: Math.min(...events.map((event) => event.timestampMs)),
  endMs: Math.max(...events.map((event) => event.timestampMs)),
})

const findingId = (ruleId: BottleneckRuleId, target: string, startMs: number, endMs: number) =>
  `${ruleId}:${target}:${startMs}-${endMs}`

const groupBy = <T,>(values: readonly T[], keyOf: (value: T) => string | undefined) => {
  const groups = new Map<string, T[]>()
  for (const value of values) {
    const key = keyOf(value)
    if (key === undefined) continue
    const group = groups.get(key) ?? []
    group.push(value)
    groups.set(key, group)
  }
  return groups
}

const explainSaturation = (events: readonly RuntimeEvent[], nodes: readonly Pick<NodeMetrics, 'nodeId' | 'nodeName'>[]): BottleneckFinding[] => {
  const snapshots = events.filter((event) => event.type === 'node-snapshot' && event.nodeId !== undefined)
  const findings: BottleneckFinding[] = []
  for (const [nodeId, nodeSnapshots] of groupBy(snapshots, (event) => event.nodeId)) {
    let sustained: RuntimeEvent[] = []
    const flush = () => {
      if (sustained.length < 2) { sustained = []; return }
      const firstQueue = numericAttribute(sustained[0]!, 'queueLength')
      const lastQueue = numericAttribute(sustained.at(-1)!, 'queueLength')
      if (lastQueue <= firstQueue) { sustained = []; return }
      const interval = intervalOf(sustained)
      const queueEvents = events.filter((event) => event.nodeId === nodeId && event.type === 'request-queued' && event.timestampMs >= interval.startMs && event.timestampMs <= interval.endMs)
      const utilization = Math.min(...sustained.map((event) => numericAttribute(event, 'utilization')))
      const sources = sequences(sustained)
      findings.push({
        id: findingId('sustained-saturation', nodeId, interval.startMs, interval.endMs),
        ruleId: 'sustained-saturation',
        title: `${nodeName(nodes, nodeId)} stayed saturated while its queue grew`,
        summary: `Measured utilization stayed at or above ${Math.round(SATURATION_THRESHOLD * 100)}% as the queue grew by ${round(lastQueue - firstQueue)} request(s).`,
        interval, target: { nodeId }, traceIds: uniqueTraceIds(queueEvents),
        evidence: [
          { key: 'minimum-utilization', label: 'Minimum utilization', value: round(utilization), unit: 'ratio', threshold: SATURATION_THRESHOLD, sourceEventSequences: sources },
          { key: 'queue-growth', label: 'Queue growth', value: round(lastQueue - firstQueue), unit: 'requests', threshold: 0, sourceEventSequences: sources },
          { key: 'queued-requests', label: 'Queued request events', value: queueEvents.length, unit: 'count', sourceEventSequences: sequences(queueEvents) },
        ],
      })
      sustained = []
    }
    for (const snapshot of nodeSnapshots) {
      if (numericAttribute(snapshot, 'utilization') >= SATURATION_THRESHOLD) sustained.push(snapshot)
      else flush()
    }
    flush()
  }
  return findings
}

const explainRetryAmplification = (events: readonly RuntimeEvent[], nodes: readonly Pick<NodeMetrics, 'nodeId' | 'nodeName'>[]): BottleneckFinding[] => {
  const findings: BottleneckFinding[] = []
  const retriesByEdge = groupBy(events.filter((event) => event.type === 'retry-scheduled' && event.edgeId !== undefined), (event) => event.edgeId)
  for (const [edgeId, retries] of retriesByEdge) {
    const timeouts = events.filter((event) => event.edgeId === edgeId && event.type === 'timeout-fired')
    if (timeouts.length === 0) continue
    const attempts = events.filter((event) => event.edgeId === edgeId && event.type === 'attempt-started')
    const requestIds = new Set(attempts.flatMap((event) => event.requestId === undefined ? [] : [event.requestId]))
    const amplification = requestIds.size === 0 ? 0 : attempts.length / requestIds.size
    if (amplification <= 1) continue
    const sources = [...timeouts, ...retries, ...attempts]
    const interval = intervalOf(sources)
    const targetNodeId = timeouts.find((event) => event.nodeId !== undefined)?.nodeId
    findings.push({
      id: findingId('retry-amplification', edgeId, interval.startMs, interval.endMs),
      ruleId: 'retry-amplification',
      title: `Retries amplified traffic to ${nodeName(nodes, targetNodeId)}`,
      summary: `${timeouts.length} timeout(s) caused ${retries.length} scheduled retry attempt(s) on this dependency.`,
      interval, target: { edgeId, ...(targetNodeId === undefined ? {} : { nodeId: targetNodeId }) }, traceIds: uniqueTraceIds(sources),
      evidence: [
        { key: 'timeouts', label: 'Timeouts', value: timeouts.length, unit: 'count', threshold: 0, sourceEventSequences: sequences(timeouts) },
        { key: 'scheduled-retries', label: 'Scheduled retries', value: retries.length, unit: 'count', threshold: 0, sourceEventSequences: sequences(retries) },
        { key: 'attempt-amplification', label: 'Attempts per request', value: round(amplification), unit: 'multiplier', threshold: 1, sourceEventSequences: sequences(attempts) },
      ],
    })
  }
  return findings
}

interface ShardSnapshot {
  event: RuntimeEvent
  counts: number[]
  total: number
  hottestIndex: number
  hottestShare: number
  threshold: number
}

const shardSnapshot = (event: RuntimeEvent): ShardSnapshot | undefined => {
  const counts = Object.entries(event.attributes)
    .flatMap(([key, value]) => {
      const match = /^requestsByShard(\d+)$/.exec(key)
      return match && typeof value === 'number' ? [{ index: Number(match[1]), value }] : []
    })
    .sort((left, right) => left.index - right.index)
    .map((entry) => entry.value)
  if (counts.length < 2) return undefined
  const total = counts.reduce((sum, value) => sum + value, 0)
  const hottest = Math.max(...counts)
  const hottestIndex = counts.indexOf(hottest)
  const hottestShare = total === 0 ? 0 : hottest / total
  const expectedShare = 1 / counts.length
  const threshold = expectedShare + (1 - expectedShare) * 0.35
  return { event, counts, total, hottestIndex, hottestShare, threshold }
}

const explainHotShards = (events: readonly RuntimeEvent[], nodes: readonly Pick<NodeMetrics, 'nodeId' | 'nodeName'>[]): BottleneckFinding[] => {
  const findings: BottleneckFinding[] = []
  const snapshots = events.filter((event) => event.type === 'node-snapshot' && event.nodeId !== undefined).flatMap((event) => {
    const snapshot = shardSnapshot(event)
    return snapshot === undefined ? [] : [snapshot]
  })
  for (const [nodeId, nodeSnapshots] of groupBy(snapshots, (snapshot) => snapshot.event.nodeId)) {
    const qualifying = nodeSnapshots.filter((snapshot) => snapshot.total >= 10 && snapshot.hottestShare >= snapshot.threshold)
    if (qualifying.length === 0) continue
    const first = qualifying[0]!
    const last = qualifying.at(-1)!
    const interval = { startMs: first.event.timestampMs, endMs: last.event.timestampMs }
    const shardEvents = events.filter((event) => event.nodeId === nodeId && (event.type === 'database-read' || event.type === 'database-written') && Number(event.attributes.shard) === last.hottestIndex && event.timestampMs <= interval.endMs)
    const sourceEvents = qualifying.map((snapshot) => snapshot.event)
    findings.push({
      id: findingId('hot-shard', nodeId, interval.startMs, interval.endMs),
      ruleId: 'hot-shard',
      title: `${nodeName(nodes, nodeId)} routed disproportionate traffic to shard ${last.hottestIndex}`,
      summary: `Shard ${last.hottestIndex} handled ${Math.round(last.hottestShare * 100)}% of measured database operations across ${last.counts.length} shards.`,
      interval, target: { nodeId }, traceIds: uniqueTraceIds(shardEvents),
      evidence: [
        { key: 'hottest-shard-share', label: 'Hottest shard share', value: round(last.hottestShare), unit: 'ratio', threshold: round(last.threshold), sourceEventSequences: sequences(sourceEvents) },
        { key: 'hottest-shard-requests', label: `Shard ${last.hottestIndex} requests`, value: last.counts[last.hottestIndex] ?? 0, unit: 'requests', sourceEventSequences: sequences(sourceEvents) },
        { key: 'database-requests', label: 'Measured database requests', value: last.total, unit: 'requests', threshold: 10, sourceEventSequences: sequences(sourceEvents) },
      ],
    })
  }
  return findings
}

const explainCacheMissLoad = (events: readonly RuntimeEvent[], nodes: readonly Pick<NodeMetrics, 'nodeId' | 'nodeName'>[]): BottleneckFinding[] => {
  const findings: BottleneckFinding[] = []
  const missesByNode = groupBy(events.filter((event) => event.type === 'cache-miss' && event.nodeId !== undefined && event.traceId !== undefined), (event) => event.nodeId)
  const databaseByNode = groupBy(events.filter((event) => (event.type === 'database-read' || event.type === 'database-written') && event.nodeId !== undefined && event.traceId !== undefined), (event) => event.nodeId)
  for (const [cacheNodeId, misses] of missesByNode) {
    if (misses.length < MIN_CORRELATED_MISSES) continue
    for (const [databaseNodeId, databaseEvents] of databaseByNode) {
      const correlatedMisses = misses.filter((miss) => databaseEvents.some((databaseEvent) => databaseEvent.traceId === miss.traceId && databaseEvent.timestampMs >= miss.timestampMs))
      const correlation = correlatedMisses.length / misses.length
      if (correlatedMisses.length < MIN_CORRELATED_MISSES || correlation < 0.6) continue
      const traceIds = new Set(correlatedMisses.map((event) => event.traceId))
      const correlatedDatabaseEvents = databaseEvents.filter((event) => event.traceId !== undefined && traceIds.has(event.traceId))
      const sources = [...misses, ...correlatedDatabaseEvents]
      const interval = intervalOf(sources)
      findings.push({
        id: findingId('cache-miss-database-load', `${cacheNodeId}:${databaseNodeId}`, interval.startMs, interval.endMs),
        ruleId: 'cache-miss-database-load',
        title: `${nodeName(nodes, cacheNodeId)} misses drove load to ${nodeName(nodes, databaseNodeId)}`,
        summary: `${correlatedMisses.length} of ${misses.length} cache miss event(s) shared a trace with a later database operation.`,
        interval, target: { nodeId: cacheNodeId, relatedNodeId: databaseNodeId }, traceIds: uniqueTraceIds([...correlatedMisses, ...correlatedDatabaseEvents]),
        evidence: [
          { key: 'cache-misses', label: 'Cache misses', value: misses.length, unit: 'count', threshold: MIN_CORRELATED_MISSES, sourceEventSequences: sequences(misses) },
          { key: 'correlated-miss-share', label: 'Misses reaching database', value: round(correlation), unit: 'ratio', threshold: 0.6, sourceEventSequences: sequences(sources) },
          { key: 'database-operations', label: 'Correlated database operations', value: correlatedDatabaseEvents.length, unit: 'count', sourceEventSequences: sequences(correlatedDatabaseEvents) },
        ],
      })
    }
  }
  return findings
}

const explainOpenCircuits = (events: readonly RuntimeEvent[], nodes: readonly Pick<NodeMetrics, 'nodeId' | 'nodeName'>[]): BottleneckFinding[] => {
  const findings: BottleneckFinding[] = []
  const openedByEdge = groupBy(events.filter((event) => event.type === 'circuit-opened' && event.edgeId !== undefined), (event) => event.edgeId)
  for (const [edgeId, opened] of openedByEdge) {
    const rejected = events.filter((event) => event.edgeId === edgeId && event.type === 'attempt-started' && event.reason === 'circuit_open' && event.status === 'rejected')
    if (rejected.length === 0) continue
    const closed = events.filter((event) => event.edgeId === edgeId && (event.type === 'circuit-half-opened' || event.type === 'circuit-closed'))
    const sources = [...opened, ...rejected, ...closed]
    const interval = intervalOf(sources)
    const targetNodeId = rejected.find((event) => event.nodeId !== undefined)?.nodeId
    findings.push({
      id: findingId('open-circuit-rejections', edgeId, interval.startMs, interval.endMs),
      ruleId: 'open-circuit-rejections',
      title: `Open circuit rejected calls to ${nodeName(nodes, targetNodeId)}`,
      summary: `The circuit opened ${opened.length} time(s) and rejected ${rejected.length} dependency attempt(s) before they entered the downstream component.`,
      interval, target: { edgeId, ...(targetNodeId === undefined ? {} : { nodeId: targetNodeId }) }, traceIds: uniqueTraceIds(rejected),
      evidence: [
        { key: 'circuit-opened', label: 'Open transitions', value: opened.length, unit: 'count', threshold: 0, sourceEventSequences: sequences(opened) },
        { key: 'circuit-rejections', label: 'Rejected attempts', value: rejected.length, unit: 'count', threshold: 0, sourceEventSequences: sequences(rejected) },
        { key: 'recovery-transitions', label: 'Recovery transitions', value: closed.length, unit: 'count', sourceEventSequences: sequences(closed) },
      ],
    })
  }
  return findings
}

/** Derives deterministic, evidence-linked observations from the canonical event stream. */
export const explainBottlenecks = (
  events: readonly RuntimeEvent[],
  nodes: readonly Pick<NodeMetrics, 'nodeId' | 'nodeName'>[],
): BottleneckFinding[] => {
  const ordered = [...events].sort((left, right) => left.timestampMs - right.timestampMs || left.sequence - right.sequence)
  return [
    ...explainSaturation(ordered, nodes),
    ...explainRetryAmplification(ordered, nodes),
    ...explainHotShards(ordered, nodes),
    ...explainCacheMissLoad(ordered, nodes),
    ...explainOpenCircuits(ordered, nodes),
  ].sort((left, right) => left.interval.startMs - right.interval.startMs || left.ruleId.localeCompare(right.ruleId) || left.id.localeCompare(right.id))
}
