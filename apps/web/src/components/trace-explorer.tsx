'use client'

import { useMemo, useState } from 'react'
import type { ReasonCode, SimulationResult } from '@system-design/model'
import { ArrowUpRight, CheckCircle2, CircleX, Timer, Waypoints } from 'lucide-react'
import { buildTraceMarkers, buildTraceRecords, buildWaterfallLanes, filterTraceRecords, type TraceFilters } from './trace-explorer-model'
import { TraceWaterfallChart } from './trace-waterfall-chart'

interface TraceExplorerProps {
  result: SimulationResult
  nodes: Array<{ id: string; name: string }>
  onShowOnCanvas: (nodeId: string) => void
  requestedTraceId?: string | null
  theme?: string | undefined
}

const humanize = (value: string) => value.replaceAll('_', ' ')
const formatMs = (value: number) => value < 1 ? `${value.toFixed(2)} ms` : `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} ms`

export function TraceExplorer({ result, nodes, onShowOnCanvas, requestedTraceId, theme }: TraceExplorerProps) {
  const records = useMemo(() => buildTraceRecords(result), [result])
  const [filters, setFilters] = useState<TraceFilters>({ status: 'all', minimumLatencyMs: 0, componentId: '', reason: 'all' })
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(requestedTraceId ?? null)
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null)
  const filtered = useMemo(() => filterTraceRecords(records, filters), [filters, records])
  const selectedTrace = filtered.find((trace) => trace.traceId === selectedTraceId) ?? filtered[0]
  const nodeNames = useMemo(() => new Map(nodes.map((node) => [node.id, node.name])), [nodes])
  const lanes = useMemo(() => selectedTrace ? buildWaterfallLanes(selectedTrace, nodeNames) : [], [nodeNames, selectedTrace])
  const selectedLane = lanes.find((lane) => lane.span.spanId === selectedSpanId) ?? lanes[0]
  const markers = useMemo(() => selectedTrace ? buildTraceMarkers(selectedTrace, result.events, lanes) : [], [lanes, result.events, selectedTrace])
  const reasons = useMemo(() => [...new Set(records.flatMap((trace) => trace.reasonCodes))].sort(), [records])
  const traceDuration = Math.max(0.001, selectedTrace?.durationMs ?? 0.001)
  const selectSpan = (spanId: string) => setSelectedSpanId(spanId)

  if (records.length === 0) return (
    <section className="trace-explorer trace-explorer--empty" aria-label="Trace explorer">
      <Waypoints size={18} /><strong>No retained request traces</strong><span>Run an experiment that completes at least one request to inspect its dependency path.</span>
    </section>
  )

  return (
    <section className="trace-explorer" aria-label="Trace explorer">
      <div className="trace-explorer__heading">
        <div><Waypoints size={15} /><strong>Trace explorer</strong><span>{filtered.length.toLocaleString()} of {records.length.toLocaleString()} requests</span></div>
        {selectedTrace ? <span className={selectedTrace.status === 'error' ? 'trace-outcome is-error' : 'trace-outcome is-ok'}>{selectedTrace.status === 'error' ? <CircleX size={12} /> : <CheckCircle2 size={12} />}{selectedTrace.status} · {formatMs(selectedTrace.durationMs)}</span> : null}
      </div>

      <div className="trace-filters">
        <label><span>Status</span><select aria-label="Trace status" value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value as TraceFilters['status'] }))}><option value="all">All outcomes</option><option value="ok">Successful</option><option value="error">Failed</option></select></label>
        <label><span>Minimum latency</span><input aria-label="Minimum trace latency in milliseconds" type="number" min={0} step={1} value={filters.minimumLatencyMs} onChange={(event) => setFilters((current) => ({ ...current, minimumLatencyMs: Math.max(0, event.currentTarget.valueAsNumber || 0) }))} /></label>
        <label><span>Component</span><select aria-label="Trace component" value={filters.componentId} onChange={(event) => setFilters((current) => ({ ...current, componentId: event.target.value }))}><option value="">All components</option>{nodes.map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}</select></label>
        <label><span>Reason</span><select aria-label="Trace reason code" value={filters.reason} onChange={(event) => setFilters((current) => ({ ...current, reason: event.target.value as 'all' | ReasonCode }))}><option value="all">All reasons</option>{reasons.map((reason) => <option key={reason} value={reason}>{humanize(reason)}</option>)}</select></label>
      </div>

      <div className="trace-explorer__body">
        <div className="trace-list" role="listbox" aria-label="Requests">
          {filtered.slice(0, 100).map((trace) => <button key={trace.traceId} type="button" role="option" aria-selected={trace.traceId === selectedTrace?.traceId} onClick={() => { setSelectedTraceId(trace.traceId); setSelectedSpanId(null) }}>
            <span className={trace.status === 'error' ? 'is-error' : 'is-ok'}>{trace.status === 'error' ? <CircleX size={11} /> : <CheckCircle2 size={11} />}</span>
            <span><strong>Request {trace.requestId}</strong><small>{trace.reason === 'none' ? `${trace.spans.length} spans` : humanize(trace.reason)}</small></span>
            <b>{formatMs(trace.durationMs)}</b>
          </button>)}
          {filtered.length > 100 ? <p>Showing the first 100 matching requests.</p> : null}
          {filtered.length === 0 ? <p>No requests match all four filters.</p> : null}
        </div>

        {selectedTrace ? <div className="trace-waterfall">
          <div className="trace-waterfall__summary">
            <div><code>{selectedTrace.traceId}</code><span>request {selectedTrace.requestId} · {selectedTrace.spans.length} spans · terminal {humanize(selectedTrace.reason)}</span></div>
            {selectedLane ? <button type="button" onClick={() => onShowOnCanvas(selectedLane.span.nodeId)}><ArrowUpRight size={12} /> Show {nodeNames.get(selectedLane.span.nodeId) ?? selectedLane.span.nodeId} on canvas</button> : null}
          </div>
          <div className="trace-waterfall__legend" aria-label="Waterfall legend"><span><i className="is-queue" /> Queue wait</span><span><i className="is-service" /> Service / dependency</span><span><i className="is-error" /> Failed span</span><span><i className="is-marker" /> Policy / fault event</span></div>
          <TraceWaterfallChart lanes={lanes} markers={markers} durationMs={traceDuration} selectedSpanId={selectedLane?.span.spanId} onSelectSpan={selectSpan} theme={theme} />
          {selectedLane ? <div className="trace-span-detail" aria-live="polite"><Timer size={12} /><strong>{nodeNames.get(selectedLane.span.nodeId) ?? selectedLane.span.nodeId}</strong><span>{formatMs(selectedLane.queueDurationMs)} queue · {formatMs(selectedLane.serviceDurationMs)} service</span><span>{selectedLane.span.status}{selectedLane.span.reason === 'none' ? '' : ` · ${humanize(selectedLane.span.reason)}`}</span>{selectedLane.span.edgeId ? <code>{selectedLane.span.edgeId}</code> : null}</div> : null}
        </div> : <div className="trace-waterfall trace-waterfall--empty">No matching trace selected.</div>}
      </div>
    </section>
  )
}
