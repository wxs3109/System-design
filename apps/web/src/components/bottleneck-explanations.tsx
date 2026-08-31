'use client'

import { useMemo, useState } from 'react'
import type { RuntimeEvent, SimulationResult } from '@system-design/model'
import { explainBottlenecks, type BottleneckEvidence, type BottleneckFinding } from '@system-design/simulation'
import { ArrowUpRight, Gauge, Link2, SearchCheck } from 'lucide-react'
import { useI18n } from '@/lib/i18n'

interface BottleneckExplanationsProps {
  result: SimulationResult
  onShowNode?: (nodeId: string) => void
  onShowTrace?: (traceId: string) => void
}

const formatTime = (value: number) => `${(value / 1_000).toLocaleString(undefined, { maximumFractionDigits: 3 })}s`
const formatEvidence = (evidence: BottleneckEvidence) => {
  if (evidence.unit === 'ratio') return `${(evidence.value * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`
  if (evidence.unit === 'multiplier') return `${evidence.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}x`
  return evidence.value.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

const eventFor = (result: SimulationResult, finding: BottleneckFinding, evidence: BottleneckEvidence): RuntimeEvent | undefined => {
  const sourceSequences = new Set(evidence.sourceEventSequences)
  return result.events.find((event) => sourceSequences.has(event.sequence))
    ?? result.events.find((event) => event.timestampMs >= finding.interval.startMs && event.timestampMs <= finding.interval.endMs && (event.nodeId === finding.target.nodeId || event.edgeId === finding.target.edgeId))
}

export function BottleneckExplanations({ result, onShowNode, onShowTrace }: BottleneckExplanationsProps) {
  const { t } = useI18n()
  const findings = useMemo(() => explainBottlenecks(result.events, result.nodes), [result.events, result.nodes])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = findings.find((finding) => finding.id === selectedId) ?? findings[0]
  const nodeName = (nodeId: string | undefined) => result.nodes.find((node) => node.nodeId === nodeId)?.nodeName ?? nodeId ?? t('Unknown component')
  const evidenceValue = (finding: BottleneckFinding, key: string) => finding.evidence.find((evidence) => evidence.key === key)?.value ?? 0
  const titleFor = (finding: BottleneckFinding) => {
    if (finding.ruleId === 'sustained-saturation') return t('{name} stayed saturated while its queue grew', { name: nodeName(finding.target.nodeId) })
    if (finding.ruleId === 'retry-amplification') return t('Retries amplified traffic to {name}', { name: nodeName(finding.target.nodeId) })
    if (finding.ruleId === 'hot-shard') return t('{name} routed disproportionate traffic to shard {shard}', { name: nodeName(finding.target.nodeId), shard: finding.title.match(/shard (\d+)$/)?.[1] ?? '' })
    if (finding.ruleId === 'cache-miss-database-load') return t('{cache} misses drove load to {database}', { cache: nodeName(finding.target.nodeId), database: nodeName(finding.target.relatedNodeId) })
    return t('Open circuit rejected calls to {name}', { name: nodeName(finding.target.nodeId) })
  }
  const summaryFor = (finding: BottleneckFinding) => {
    if (finding.ruleId === 'sustained-saturation') return t('Measured utilization stayed at or above 80% as the queue grew by {count} request(s).', { count: evidenceValue(finding, 'queue-growth') })
    if (finding.ruleId === 'retry-amplification') return t('{timeouts} timeout(s) caused {retries} scheduled retry attempt(s) on this dependency.', { timeouts: evidenceValue(finding, 'timeouts'), retries: evidenceValue(finding, 'scheduled-retries') })
    if (finding.ruleId === 'hot-shard') return t('One shard handled {share}% of measured database operations.', { share: Math.round(evidenceValue(finding, 'hottest-shard-share') * 100) })
    if (finding.ruleId === 'cache-miss-database-load') return t('{correlated}% of cache misses reached a later database operation.', { correlated: Math.round(evidenceValue(finding, 'correlated-miss-share') * 100) })
    return t('The circuit opened {opened} time(s) and rejected {rejected} dependency attempt(s).', { opened: evidenceValue(finding, 'circuit-opened'), rejected: evidenceValue(finding, 'circuit-rejections') })
  }

  if (findings.length === 0) return (
    <section className="bottleneck-explanations bottleneck-explanations--empty" aria-label={t('Evidence-based explanations')}>
      <SearchCheck size={17} aria-hidden="true" />
      <span><strong>{t('No evidence-backed bottleneck detected')}</strong><small>{t('The rules emit claims only when measured events cross a documented threshold.')}</small></span>
    </section>
  )

  return (
    <section className="bottleneck-explanations" aria-label={t('Evidence-based explanations')}>
      <div className="bottleneck-explanations__heading"><span><Gauge size={15} aria-hidden="true" /><strong>{t('Evidence-based explanations')}</strong></span><small>{t('{count} measured findings · no opaque score', { count: findings.length })}</small></div>
      <div className="bottleneck-explanations__body">
        <div className="bottleneck-finding-list" role="listbox" aria-label={t('Measured findings')}>
          {findings.map((finding) => <button type="button" role="option" aria-selected={finding.id === selected?.id} key={finding.id} onClick={() => setSelectedId(finding.id)}>
            <strong>{titleFor(finding)}</strong><small>{formatTime(finding.interval.startMs)}–{formatTime(finding.interval.endMs)} · {t('{count} trace links', { count: finding.traceIds.length })}</small>
          </button>)}
        </div>
        {selected ? <article className="bottleneck-finding-detail" aria-live="polite">
          <div className="bottleneck-finding-detail__title"><span><strong>{titleFor(selected)}</strong><small>{summaryFor(selected)}</small></span>{selected.target.nodeId && onShowNode ? <button type="button" onClick={() => onShowNode(selected.target.nodeId!)}><ArrowUpRight size={12} /> {t('Show on canvas')}</button> : null}</div>
          <div className="bottleneck-evidence-grid">{selected.evidence.map((evidence) => {
            const source = eventFor(result, selected, evidence)
            return <div key={evidence.key}><span>{t(`evidence.${evidence.key}`, {}, evidence.label)}</span><strong>{formatEvidence(evidence)}</strong><small>{evidence.threshold === undefined ? '' : `${t('threshold')} ${formatEvidence({ ...evidence, value: evidence.threshold })} · `}{t('{count} source events', { count: evidence.sourceEventSequences.length })}{source ? ` · ${t('first at')} ${formatTime(source.timestampMs)}` : ''}</small></div>
          })}</div>
          {selected.traceIds.length > 0 ? <div className="bottleneck-trace-links"><span><Link2 size={12} /> {t('Request evidence')}</span>{selected.traceIds.map((traceId) => <button type="button" key={traceId} disabled={!onShowTrace} onClick={() => onShowTrace?.(traceId)}>{traceId}</button>)}</div> : null}
        </article> : null}
      </div>
    </section>
  )
}
