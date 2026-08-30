'use client'

import { useMemo, useState } from 'react'
import type { RuntimeEvent, SimulationResult } from '@system-design/model'
import { explainBottlenecks, type BottleneckEvidence, type BottleneckFinding } from '@system-design/simulation'
import { ArrowUpRight, Gauge, Link2, SearchCheck } from 'lucide-react'

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
  const findings = useMemo(() => explainBottlenecks(result.events, result.nodes), [result.events, result.nodes])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = findings.find((finding) => finding.id === selectedId) ?? findings[0]

  if (findings.length === 0) return (
    <section className="bottleneck-explanations bottleneck-explanations--empty" aria-label="Evidence-based explanations">
      <SearchCheck size={17} aria-hidden="true" />
      <span><strong>No evidence-backed bottleneck detected</strong><small>The rules emit claims only when measured events cross a documented threshold.</small></span>
    </section>
  )

  return (
    <section className="bottleneck-explanations" aria-label="Evidence-based explanations">
      <div className="bottleneck-explanations__heading"><span><Gauge size={15} aria-hidden="true" /><strong>Evidence-based explanations</strong></span><small>{findings.length} measured finding{findings.length === 1 ? '' : 's'} · no opaque score</small></div>
      <div className="bottleneck-explanations__body">
        <div className="bottleneck-finding-list" role="listbox" aria-label="Measured findings">
          {findings.map((finding) => <button type="button" role="option" aria-selected={finding.id === selected?.id} key={finding.id} onClick={() => setSelectedId(finding.id)}>
            <strong>{finding.title}</strong><small>{formatTime(finding.interval.startMs)}–{formatTime(finding.interval.endMs)} · {finding.traceIds.length} trace link{finding.traceIds.length === 1 ? '' : 's'}</small>
          </button>)}
        </div>
        {selected ? <article className="bottleneck-finding-detail" aria-live="polite">
          <div className="bottleneck-finding-detail__title"><span><strong>{selected.title}</strong><small>{selected.summary}</small></span>{selected.target.nodeId && onShowNode ? <button type="button" onClick={() => onShowNode(selected.target.nodeId!)}><ArrowUpRight size={12} /> Show on canvas</button> : null}</div>
          <div className="bottleneck-evidence-grid">{selected.evidence.map((evidence) => {
            const source = eventFor(result, selected, evidence)
            return <div key={evidence.key}><span>{evidence.label}</span><strong>{formatEvidence(evidence)}</strong><small>{evidence.threshold === undefined ? '' : `threshold ${formatEvidence({ ...evidence, value: evidence.threshold })} · `}{evidence.sourceEventSequences.length} source event{evidence.sourceEventSequences.length === 1 ? '' : 's'}{source ? ` · first at ${formatTime(source.timestampMs)}` : ''}</small></div>
          })}</div>
          {selected.traceIds.length > 0 ? <div className="bottleneck-trace-links"><span><Link2 size={12} /> Request evidence</span>{selected.traceIds.map((traceId) => <button type="button" key={traceId} disabled={!onShowTrace} onClick={() => onShowTrace?.(traceId)}>{traceId}</button>)}</div> : null}
        </article> : null}
      </div>
    </section>
  )
}
