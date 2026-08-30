'use client'

import { useMemo, useState } from 'react'
import { CircleAlert, GitCompareArrows } from 'lucide-react'
import type { SimulationRunRecord } from '@/lib/local-history'
import { compareSimulationRuns, type ComparedMetric, type ComparisonSeriesMetric } from '@/lib/run-comparison'
import { ComparisonChart } from './comparison-chart'
import { selectInitialComparisonRuns } from './run-comparison-selection'

interface RunComparisonPanelProps {
  runs: SimulationRunRecord[]
  activeRunId?: string
}

const seriesOptions: Array<{ key: ComparisonSeriesMetric; label: string; unit: string }> = [
  { key: 'throughputPerSecond', label: 'Throughput', unit: 'req/s' },
  { key: 'latencyP95Ms', label: 'P95 latency', unit: 'ms' },
  { key: 'queuedRequests', label: 'Queued requests', unit: 'requests' },
  { key: 'failedRequests', label: 'Cumulative failures', unit: 'requests' },
]

const runLabel = (run: SimulationRunRecord) => {
  const name = run.projectSnapshot?.name ?? run.projectId
  const completed = run.result.summary.completedRequests.toLocaleString()
  return `${name} · ${completed} completed · ${new Date(run.createdAt).toLocaleString()}`
}

const formatMetric = (value: number | null, metric: ComparedMetric) => {
  if (value === null) return 'n/a'
  if (metric.unit === 'ratio') return `${(value * 100).toFixed(2)}%`
  const decimals = metric.unit === 'ms' ? 2 : 1
  return `${value.toLocaleString(undefined, { maximumFractionDigits: decimals })} ${metric.unit}`
}

const formatDelta = (metric: ComparedMetric) => {
  if (metric.delta === null) return 'n/a'
  const sign = metric.delta > 0 ? '+' : ''
  const absolute = metric.unit === 'ratio'
    ? `${sign}${(metric.delta * 100).toFixed(2)} pp`
    : `${sign}${metric.delta.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${metric.unit}`
  const percent = metric.deltaPercent === null ? '' : ` (${metric.deltaPercent > 0 ? '+' : ''}${(metric.deltaPercent * 100).toFixed(1)}%)`
  return `${absolute}${percent}`
}

export function RunComparisonPanel({ runs, activeRunId }: RunComparisonPanelProps) {
  const initialSelection = selectInitialComparisonRuns(runs, activeRunId)
  const [baselineId, setBaselineId] = useState(initialSelection.baselineId)
  const [candidateId, setCandidateId] = useState(initialSelection.candidateId)
  const [seriesMetric, setSeriesMetric] = useState<ComparisonSeriesMetric>('throughputPerSecond')
  const candidate = runs.find((run) => run.runId === candidateId) ?? runs[0]
  const baseline = runs.find((run) => run.runId === baselineId) ?? runs.find((run) => run.runId !== candidate?.runId)
  const comparison = useMemo(() => baseline && candidate ? compareSimulationRuns(baseline, candidate) : undefined, [baseline, candidate])
  const selectedSeries = seriesOptions.find((option) => option.key === seriesMetric)!

  if (runs.length < 2) return <div className="comparison-empty"><GitCompareArrows size={18} /><strong>Run two design revisions to compare them.</strong><span>Keep the experiment and seed unchanged; edit only the topology between runs.</span></div>
  return (
    <section className="run-comparison" aria-label="Baseline and candidate run comparison">
      <div className="comparison-controls">
        <label><span>Baseline</span><select aria-label="Baseline run" value={baseline?.runId ?? ''} onChange={(event) => setBaselineId(event.target.value)}>{runs.map((run) => <option key={run.runId} value={run.runId}>{runLabel(run)}</option>)}</select></label>
        <GitCompareArrows size={16} />
        <label><span>Candidate</span><select aria-label="Candidate run" value={candidate?.runId ?? ''} onChange={(event) => setCandidateId(event.target.value)}>{runs.map((run) => <option key={run.runId} value={run.runId}>{runLabel(run)}</option>)}</select></label>
      </div>
      {!comparison ? null : !comparison.comparability.comparable ? (
        <div className="comparison-warning" role="alert"><CircleAlert size={17} /><div><strong>These runs cannot be compared fairly.</strong><ul>{comparison.comparability.issues.map((issue) => <li key={issue.code}>{issue.message}</li>)}</ul></div></div>
      ) : (
        <>
          <div className="comparison-lock">Same experiment verified · seed <code>{baseline?.result.seed}</code> · only measured differences are shown</div>
          <div className="comparison-metrics">
            <table><thead><tr><th>Metric</th><th>Baseline</th><th>Candidate</th><th>Candidate − baseline</th></tr></thead><tbody>{comparison.metrics.map((metric) => <tr key={metric.key}><td>{metric.label}</td><td>{formatMetric(metric.baseline, metric)}</td><td>{formatMetric(metric.candidate, metric)}</td><td className={metric.delta === null || metric.delta === 0 ? '' : metric.delta > 0 ? 'is-positive' : 'is-negative'}>{formatDelta(metric)}</td></tr>)}</tbody></table>
          </div>
          <div className="comparison-plot"><div className="comparison-plot__heading"><strong>Aligned virtual-time series</strong><label><span>Metric</span><select aria-label="Comparison chart metric" value={seriesMetric} onChange={(event) => setSeriesMetric(event.target.value as ComparisonSeriesMetric)}>{seriesOptions.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label></div><ComparisonChart points={comparison.series[seriesMetric]} metricLabel={selectedSeries.label} unit={selectedSeries.unit} events={comparison.baseline.result.events} simulatedDurationMs={comparison.baseline.result.simulatedDurationMs} /></div>
        </>
      )}
    </section>
  )
}
