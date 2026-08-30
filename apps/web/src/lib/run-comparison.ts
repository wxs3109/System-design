import { getActiveExperiment, type Experiment, type SimulationResult, type TimeSeriesPoint } from '@system-design/model'
import type { SimulationRunRecord } from './local-history'

export type ComparabilityIssueCode =
  | 'same-run'
  | 'missing-snapshot'
  | 'seed-mismatch'
  | 'workload-mismatch'
  | 'fault-mismatch'
  | 'simulation-mismatch'
  | 'result-seed-mismatch'

export interface ComparabilityIssue {
  code: ComparabilityIssueCode
  message: string
}

export interface RunComparability {
  comparable: boolean
  issues: ComparabilityIssue[]
}

export type ComparisonMetricKey =
  | 'throughputPerSecond'
  | 'latencyP50Ms'
  | 'latencyP95Ms'
  | 'latencyP99Ms'
  | 'errorRate'
  | 'averageQueueLength'
  | 'peakUtilization'
  | 'cacheHitRate'
  | 'consumerLag'

export interface ComparedMetric {
  key: ComparisonMetricKey
  label: string
  unit: 'req/s' | 'ms' | 'ratio' | 'requests' | 'messages'
  baseline: number | null
  candidate: number | null
  delta: number | null
  deltaPercent: number | null
}

export type ComparisonSeriesMetric = 'throughputPerSecond' | 'latencyP95Ms' | 'queuedRequests' | 'failedRequests'

export interface AlignedComparisonPoint {
  timeSeconds: number
  baseline: number
  candidate: number
  delta: number
}

export interface RunComparison {
  baseline: SimulationRunRecord
  candidate: SimulationRunRecord
  comparability: RunComparability
  metrics: ComparedMetric[]
  series: Record<ComparisonSeriesMetric, AlignedComparisonPoint[]>
}

const emptySeries = (): Record<ComparisonSeriesMetric, AlignedComparisonPoint[]> => ({
  throughputPerSecond: [],
  latencyP95Ms: [],
  queuedRequests: [],
  failedRequests: [],
})

const normalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(normalize)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => [key, normalize(nested)]))
}

const sameValue = (left: unknown, right: unknown) => JSON.stringify(normalize(left)) === JSON.stringify(normalize(right))

const activeExperiment = (run: SimulationRunRecord): Experiment | undefined => run.projectSnapshot
  ? getActiveExperiment(run.projectSnapshot)
  : undefined

export function assessRunComparability(baseline: SimulationRunRecord, candidate: SimulationRunRecord): RunComparability {
  const issues: ComparabilityIssue[] = []
  if (baseline.runId === candidate.runId) issues.push({ code: 'same-run', message: 'Choose two different runs.' })
  const baselineExperiment = activeExperiment(baseline)
  const candidateExperiment = activeExperiment(candidate)
  if (!baselineExperiment || !candidateExperiment) {
    issues.push({ code: 'missing-snapshot', message: 'Both runs need immutable project snapshots; rerun legacy history entries before comparing.' })
    return { comparable: false, issues }
  }

  if (baselineExperiment.seed !== candidateExperiment.seed) issues.push({ code: 'seed-mismatch', message: 'Random seeds differ.' })
  if (!sameValue(baselineExperiment.workloads, candidateExperiment.workloads)) issues.push({ code: 'workload-mismatch', message: 'Workload definitions differ.' })
  if (!sameValue(baselineExperiment.faults, candidateExperiment.faults)) issues.push({ code: 'fault-mismatch', message: 'Fault schedules differ.' })
  if (!sameValue(baselineExperiment.simulation, candidateExperiment.simulation)) issues.push({ code: 'simulation-mismatch', message: 'Simulation duration, sampling, limits or trace settings differ.' })
  if (baseline.result.seed !== baselineExperiment.seed || candidate.result.seed !== candidateExperiment.seed) {
    issues.push({ code: 'result-seed-mismatch', message: 'A stored result does not match its experiment seed.' })
  }
  return { comparable: issues.length === 0, issues }
}

const finiteNumbers = (values: Array<number | undefined>) => values.filter((value): value is number => Number.isFinite(value))
const average = (values: number[]) => values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length
const maximum = (values: number[]) => values.length === 0 ? null : Math.max(...values)
const sum = (values: number[]) => values.length === 0 ? null : values.reduce((total, value) => total + value, 0)

const aggregateMetrics = (result: SimulationResult): Record<ComparisonMetricKey, number | null> => ({
  throughputPerSecond: result.summary.throughputPerSecond,
  latencyP50Ms: result.summary.latencyP50Ms,
  latencyP95Ms: result.summary.latencyP95Ms,
  latencyP99Ms: result.summary.latencyP99Ms,
  errorRate: result.summary.errorRate,
  averageQueueLength: sum(result.nodes.map((node) => node.averageQueueLength)),
  peakUtilization: maximum(result.nodes.map((node) => node.utilization)),
  cacheHitRate: average(finiteNumbers(result.nodes.map((node) => typeof node.details.cacheHitRate === 'number' ? node.details.cacheHitRate : undefined))),
  consumerLag: sum(finiteNumbers(result.nodes.map((node) => typeof node.details.consumerLag === 'number' ? node.details.consumerLag : undefined))),
})

const metricDefinitions: Array<Pick<ComparedMetric, 'key' | 'label' | 'unit'>> = [
  { key: 'throughputPerSecond', label: 'Throughput', unit: 'req/s' },
  { key: 'latencyP50Ms', label: 'P50 latency', unit: 'ms' },
  { key: 'latencyP95Ms', label: 'P95 latency', unit: 'ms' },
  { key: 'latencyP99Ms', label: 'P99 latency', unit: 'ms' },
  { key: 'errorRate', label: 'Error rate', unit: 'ratio' },
  { key: 'averageQueueLength', label: 'Average queue', unit: 'requests' },
  { key: 'peakUtilization', label: 'Peak utilization', unit: 'ratio' },
  { key: 'cacheHitRate', label: 'Cache hit rate', unit: 'ratio' },
  { key: 'consumerLag', label: 'Consumer lag', unit: 'messages' },
]

const compareMetric = (definition: Pick<ComparedMetric, 'key' | 'label' | 'unit'>, baseline: number | null, candidate: number | null): ComparedMetric => {
  if (baseline === null || candidate === null) return { ...definition, baseline, candidate, delta: null, deltaPercent: null }
  const delta = candidate - baseline
  return { ...definition, baseline, candidate, delta, deltaPercent: baseline === 0 ? null : delta / Math.abs(baseline) }
}

export function alignComparisonSeries(
  baseline: readonly TimeSeriesPoint[],
  candidate: readonly TimeSeriesPoint[],
  metric: ComparisonSeriesMetric,
): AlignedComparisonPoint[] {
  const candidateByTime = new Map(candidate.map((point) => [point.timeSeconds, point]))
  return baseline.flatMap((baselinePoint) => {
    const candidatePoint = candidateByTime.get(baselinePoint.timeSeconds)
    if (!candidatePoint) return []
    const baselineValue = baselinePoint[metric]
    const candidateValue = candidatePoint[metric]
    return [{ timeSeconds: baselinePoint.timeSeconds, baseline: baselineValue, candidate: candidateValue, delta: candidateValue - baselineValue }]
  })
}

export function compareSimulationRuns(baseline: SimulationRunRecord, candidate: SimulationRunRecord): RunComparison {
  const comparability = assessRunComparability(baseline, candidate)
  if (!comparability.comparable) return { baseline, candidate, comparability, metrics: [], series: emptySeries() }

  const baselineMetrics = aggregateMetrics(baseline.result)
  const candidateMetrics = aggregateMetrics(candidate.result)
  return {
    baseline,
    candidate,
    comparability,
    metrics: metricDefinitions.map((definition) => compareMetric(definition, baselineMetrics[definition.key], candidateMetrics[definition.key])),
    series: {
      throughputPerSecond: alignComparisonSeries(baseline.result.timeSeries, candidate.result.timeSeries, 'throughputPerSecond'),
      latencyP95Ms: alignComparisonSeries(baseline.result.timeSeries, candidate.result.timeSeries, 'latencyP95Ms'),
      queuedRequests: alignComparisonSeries(baseline.result.timeSeries, candidate.result.timeSeries, 'queuedRequests'),
      failedRequests: alignComparisonSeries(baseline.result.timeSeries, candidate.result.timeSeries, 'failedRequests'),
    },
  }
}
