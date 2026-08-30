'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Background, BackgroundVariant, Controls, MiniMap, Panel, ReactFlow, ReactFlowProvider, useReactFlow, type OnConnect } from '@xyflow/react'
import { builtInComponentTypes, componentRegistry, policyRegistry, rolePresetRegistry, type ConfigField, type RolePresetManifest } from '@system-design/components'
import { createEmptyProject, getActiveExperiment, parseProjectFile, type ComponentType, type PolicyAttachment, type ProjectConnection, type SimulationProgress, type SimulationResult } from '@system-design/model'
import { SimulationWorkerClient } from '@system-design/simulation/client'
import { validateScenarioForSimulation } from '@system-design/simulation'
import { ArrowDown, ArrowUp, ChevronDown, CircleAlert, Download, FlaskConical, History, Layers3, Moon, MousePointer2, PanelBottom, PanelRight, Play, Plus, Redo2, RotateCcw, Save, Square, Sun, Trash2, Undo2, Upload, X } from 'lucide-react'
import { useTheme } from 'next-themes'
import type { ImperativePanelHandle } from 'react-resizable-panels'
import { ComponentNode, componentIcons } from './component-node'
import { BottleneckExplanations } from './bottleneck-explanations'
import { FaultLaboratory } from './fault-laboratory'
import { affectedTopology } from './fault-topology'
import { MetricChart } from './metric-chart'
import { RunComparisonPanel } from './run-comparison-panel'
import { TraceExplorer } from './trace-explorer'
import { WorkbenchShell } from './workbench-shell'
import { createAsyncExample, createDataPlatformExample, createDirectExample } from '@/lib/examples'
import { getLocalHistoryRepository, type ProjectRevisionRecord, type SimulationRunRecord } from '@/lib/local-history'
import { projectToEdges, projectToNodes, redoProject, undoProject, useCanRedo, useCanUndo, useWorkbenchStore, type ProjectNode } from '@/lib/store'

const nodeTypes = { component: ComponentNode }
const orderedTypes = builtInComponentTypes
type PanelName = 'faults' | 'inspector' | 'results'
type PanelVisibility = Record<PanelName, boolean>
const panelVisibilityStorageKey = 'system-design-panel-visibility'
const defaultPanelVisibility: PanelVisibility = { faults: true, inspector: true, results: true }

function loadPanelVisibility(): PanelVisibility {
  try {
    const saved = JSON.parse(window.localStorage.getItem(panelVisibilityStorageKey) ?? '{}') as Partial<PanelVisibility>
    return { faults: saved.faults !== false, inspector: saved.inspector !== false, results: saved.results !== false }
  } catch {
    return defaultPanelVisibility
  }
}

function Field({ label, value, min = 0, max, step = 1, onChange }: { label: string; value: number; min?: number; max?: number; step?: number; onChange: (value: number) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="number" min={min} {...(max === undefined ? {} : { max })} step={step} value={value} onChange={(event) => { const next = event.currentTarget.valueAsNumber; if (Number.isFinite(next)) onChange(next) }} />
    </label>
  )
}

function PaletteItem({ type, onAdd }: { type: ComponentType; onAdd: () => void }) {
  const definition = componentRegistry.get(type)
  const Icon = componentIcons[definition.iconToken]!
  return (
    <button
      type="button"
      className="palette-item"
      draggable
      onClick={onAdd}
      onDragStart={(event) => { event.dataTransfer.setData('application/system-design-component', type); event.dataTransfer.effectAllowed = 'move' }}
      style={{ '--node-color': definition.color } as React.CSSProperties}
      title={definition.description}
    >
      <span><Icon size={17} aria-hidden="true" /></span>
      <span><strong>{definition.label}</strong><small>{definition.description}</small></span>
      <Plus size={15} aria-hidden="true" />
    </button>
  )
}

function RolePresetItem({ preset, onAdd }: { preset: RolePresetManifest; onAdd: () => void }) {
  const behavior = componentRegistry.get(preset.behavior.type, preset.behavior.version)
  const Icon = componentIcons[preset.iconToken] ?? componentIcons[behavior.iconToken]!
  return (
    <button type="button" className="palette-item palette-item--preset" draggable onClick={onAdd}
      onDragStart={(event) => { event.dataTransfer.setData('application/system-design-role-preset', `${preset.id}@${preset.version}`); event.dataTransfer.effectAllowed = 'move' }}
      style={{ '--node-color': behavior.color } as React.CSSProperties} title={`${preset.description} Uses ${behavior.label} behavior.`}>
      <span><Icon size={17} aria-hidden="true" /></span>
      <span><strong>{preset.label}</strong><small>Uses {behavior.label} behavior</small></span>
      <Plus size={15} aria-hidden="true" />
    </button>
  )
}

function ConfigFieldControl({ field, value, onChange }: { field: ConfigField; value: unknown; onChange: (value: number | string) => void }) {
  if (field.kind === 'number') return <Field label={field.label} value={Number(value)} {...(field.min === undefined ? {} : { min: field.min })} {...(field.max === undefined ? {} : { max: field.max })} {...(field.step === undefined ? {} : { step: field.step })} onChange={onChange} />
  if (field.kind === 'select') return <label className="field"><span>{field.label}</span><select value={String(value)} onChange={(event) => onChange(event.target.value)}>{field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
  return <label className="field"><span>{field.label}</span><input value={String(value)} onChange={(event) => onChange(event.target.value)} /></label>
}

function PolicyEditor({ policy, index, count }: { policy: PolicyAttachment; index: number; count: number }) {
  const updatePolicy = useWorkbenchStore((state) => state.updatePolicy)
  const movePolicy = useWorkbenchStore((state) => state.movePolicy)
  const deletePolicy = useWorkbenchStore((state) => state.deletePolicy)
  const manifest = policyRegistry.get(policy.type, policy.version)
  return (
    <section className="policy-editor" aria-label={`${manifest.label} policy`}>
      <div className="policy-editor__heading">
        <label className="policy-toggle"><input type="checkbox" checked={policy.enabled} onChange={(event) => updatePolicy(policy.id, { enabled: event.target.checked })} /><span>{manifest.label}</span></label>
        <div className="policy-actions">
          <button type="button" onClick={() => movePolicy(policy.id, -1)} disabled={index === 0} aria-label={`Move ${manifest.label} earlier`}><ArrowUp size={13} /></button>
          <button type="button" onClick={() => movePolicy(policy.id, 1)} disabled={index === count - 1} aria-label={`Move ${manifest.label} later`}><ArrowDown size={13} /></button>
          <button type="button" className="danger" onClick={() => deletePolicy(policy.id)} aria-label={`Remove ${manifest.label}`}><Trash2 size={13} /></button>
        </div>
      </div>
      <p>{manifest.description}</p>
      <div className={policy.enabled ? 'policy-fields' : 'policy-fields is-disabled'}>
        {manifest.configFields.map((field) => <ConfigFieldControl key={field.key} field={field} value={policy.config[field.key]} onChange={(value) => updatePolicy(policy.id, { config: { [field.key]: value } })} />)}
      </div>
    </section>
  )
}

function PolicySection({ target }: { target: PolicyAttachment['target'] }) {
  const allPolicies = useWorkbenchStore((state) => state.project.topology.policies)
  const policies = useMemo(() => allPolicies
    .filter((policy) => policy.target.kind === target.kind && policy.target.id === target.id)
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id)), [allPolicies, target.id, target.kind])
  const attachPolicy = useWorkbenchStore((state) => state.attachPolicy)
  const manifests = policyRegistry.list().filter((manifest) => manifest.targets.includes(target.kind))
  const available = manifests.filter((manifest) => !manifest.singletonPerTarget || !policies.some((policy) => policy.type === manifest.type && policy.version === manifest.version))
  const [selection, setSelection] = useState('')
  const add = () => {
    const manifest = available.find((candidate) => `${candidate.type}@${candidate.version}` === selection)
    if (!manifest) return
    attachPolicy(target, manifest.type, manifest.version)
    setSelection('')
  }
  return (
    <div className="policy-section">
      <div className="policy-section__heading"><span>Reliability policies</span><small>{policies.length ? `${policies.length} attached · evaluated top to bottom` : 'No policies attached'}</small></div>
      {policies.map((policy, index) => <PolicyEditor key={policy.id} policy={policy} index={index} count={policies.length} />)}
      <div className="policy-add">
        <label className="field"><span>Add policy</span><select aria-label={`Policy for selected ${target.kind}`} value={selection} disabled={available.length === 0} onChange={(event) => setSelection(event.target.value)}><option value="">{available.length ? 'Choose a policy…' : 'All available policies attached'}</option>{available.map((manifest) => <option key={`${manifest.type}@${manifest.version}`} value={`${manifest.type}@${manifest.version}`}>{manifest.label}</option>)}</select></label>
        <button type="button" className="button" disabled={!selection || available.length === 0} onClick={add}><Plus size={14} /> Add</button>
      </div>
    </div>
  )
}

function RegionSection() {
  const project = useWorkbenchStore((state) => state.project)
  const addRegion = useWorkbenchStore((state) => state.addRegion)
  const updateRegion = useWorkbenchStore((state) => state.updateRegion)
  const deleteRegion = useWorkbenchStore((state) => state.deleteRegion)
  const regions = project.topology.groups.filter((group) => group.kind === 'region' || group.kind === 'zone')
  return (
    <section className="region-section" aria-label="Regions and zones">
      <div className="policy-section__heading"><span>Regions / zones</span><small>Group nodes for outage experiments</small></div>
      {regions.map((region) => <div className="region-editor" key={region.id}>
        <label className="field"><span>Region / zone name</span><input value={region.name} onChange={(event) => updateRegion(region.id, { name: event.target.value })} /></label>
        <label className="field"><span>Kind</span><select value={region.kind} onChange={(event) => updateRegion(region.id, { kind: event.target.value as 'region' | 'zone' })}><option value="region">Region</option><option value="zone">Availability zone</option></select></label>
        <div className="region-members">{project.topology.nodes.map((node) => <label key={node.id} className="policy-toggle"><input type="checkbox" checked={region.nodeIds.includes(node.id)} onChange={(event) => updateRegion(region.id, { nodeIds: event.target.checked ? [...region.nodeIds, node.id] : region.nodeIds.filter((id) => id !== node.id) })} /><span>{node.name}</span></label>)}</div>
        <button type="button" className="icon-button danger" aria-label={`Delete ${region.name}`} onClick={() => deleteRegion(region.id)}><Trash2 size={14} /></button>
      </div>)}
      <div className="region-actions"><button type="button" className="button" onClick={() => addRegion('region')}><Plus size={14} /> Add region</button><button type="button" className="button" onClick={() => addRegion('zone')}><Plus size={14} /> Add zone</button></div>
    </section>
  )
}

function PropertiesPanel({ node, edge }: { node: ProjectNode | undefined; edge: ProjectConnection | undefined }) {
  const updateNode = useWorkbenchStore((state) => state.updateSelectedNode)
  const deleteNode = useWorkbenchStore((state) => state.deleteSelectedNode)
  const updateEdge = useWorkbenchStore((state) => state.updateSelectedEdge)
  const deleteEdge = useWorkbenchStore((state) => state.deleteSelectedEdge)
  const workload = useWorkbenchStore((state) => node?.type === 'traffic' ? getActiveExperiment(state.project).workloads.find((item) => item.id === node.config.workloadId) : undefined)
  const updateWorkload = useWorkbenchStore((state) => state.updateWorkload)
  if (edge) {
    const asynchronous = edge.sourceSemantic === 'publish'
    return (
      <div className="properties-form">
        <div className="section-heading"><div><span>Selected connection</span><strong>{edge.sourceSemantic} → {edge.targetSemantic}</strong></div><button type="button" className="icon-button danger" onClick={deleteEdge} aria-label="Delete selected connection"><Trash2 size={16} /></button></div>
        <label className="field"><span>Routing mode</span><select value={edge.routingMode} disabled={asynchronous} onChange={(event) => updateEdge({ routingMode: event.target.value as 'weighted-one' | 'fan-out' })}>{asynchronous ? <option value="async-publish">Async publish</option> : <><option value="weighted-one">Weighted one-of</option><option value="fan-out">Fan-out</option></>}</select></label>
        {edge.routingMode === 'weighted-one' ? <Field label="Routing weight" value={edge.weight} min={0.001} step={0.1} onChange={(weight) => updateEdge({ weight })} /> : null}
        <p className="property-help">Routing is applied to every connection from the same output port.</p>
        <PolicySection key={`edge:${edge.id}`} target={{ kind: 'edge', id: edge.id }} />
      </div>
    )
  }
  if (!node) {
    return <div className="empty-properties"><MousePointer2 size={22} /><p>Select a component to configure its runtime behavior.</p></div>
  }
  const manifest = componentRegistry.get(node.type, node.componentVersion)
  const preset = node.rolePreset ? rolePresetRegistry.find(node.rolePreset.id, node.rolePreset.version) : undefined
  const setConfig = (key: string, value: number | string) => updateNode({ config: { [key]: value } })
  return (
    <div className="properties-form">
      <div className="section-heading"><div><span>Selected component</span><strong>{manifest.label}</strong></div><button type="button" className="icon-button danger" onClick={deleteNode} aria-label="Delete selected component"><Trash2 size={16} /></button></div>
      {preset ? <p className="preset-disclosure"><strong>{preset.label}</strong> is a role preset using <strong>{manifest.label}</strong> behavior. Editing these fields changes the resolved behavior directly.</p> : null}
      <label className="field"><span>Name</span><input value={node.name} onChange={(event) => updateNode({ name: event.target.value })} /></label>
      {node.type === 'traffic' && workload ? <>
        <Field label="Requests / second" value={workload.requestsPerSecond} min={0.1} step={10} onChange={(value) => updateWorkload({ requestsPerSecond: value })} />
        <label className="field"><span>Arrival pattern</span><select value={workload.pattern} onChange={(event) => updateWorkload({ pattern: event.target.value as 'constant' | 'poisson' })}><option value="poisson">Poisson</option><option value="constant">Constant</option></select></label>
      </> : null}
      {manifest.configFields.map((field) => <ConfigFieldControl key={field.key} field={field} value={(node.config as Record<string, unknown>)[field.key]} onChange={(value) => setConfig(field.key, value)} />)}
      <PolicySection key={`node:${node.id}`} target={{ kind: 'node', id: node.id }} />
    </div>
  )
}

const runtimeFaultReasons = new Set(['node_down', 'packet_loss', 'latency_spike', 'region_outage', 'capacity_reduced', 'bandwidth_reduced', 'traffic_spike', 'hot_key'])
const humanizeReason = (reason: string) => reason.replaceAll('_', ' ')

function FaultTraceEvidence({ result }: { result: SimulationResult }) {
  const lifecycle = result.events.filter((event) => event.type === 'fault-activated' || event.type === 'fault-recovered')
  if (lifecycle.length === 0) return null
  const affectedTraces = result.events.filter((event) => event.type === 'request-failed' && event.traceId && runtimeFaultReasons.has(event.reason))
  return (
    <section className="fault-evidence" aria-label="Fault and trace evidence">
      <div className="fault-evidence__heading"><strong>Fault &amp; trace evidence</strong><span>{lifecycle.filter((event) => event.type === 'fault-activated').length} activated · {affectedTraces.length} affected request events</span></div>
      <div className="fault-evidence__events">{lifecycle.slice(0, 8).map((event) => <span key={event.sequence} className={event.type === 'fault-activated' ? 'is-active' : 'is-recovered'}><b>{event.timestampMs / 1_000}s</b> {event.type === 'fault-activated' ? 'started' : 'recovered'} {humanizeReason(event.reason)}</span>)}</div>
      {affectedTraces.length > 0 ? <div className="fault-evidence__traces">{affectedTraces.slice(0, 6).map((event) => <span key={event.sequence}><code>{event.traceId}</code><b>{humanizeReason(event.reason)}</b><small>{event.timestampMs / 1_000}s · {event.nodeId ?? event.edgeId ?? 'workload'}</small></span>)}</div> : null}
    </section>
  )
}

function ResultsPanel({ result, progress, running, nodes, onShowTraceNode, theme }: { result: SimulationResult | null; progress: SimulationProgress | null; running: boolean; nodes: Array<{ id: string; name: string }>; onShowTraceNode: (nodeId: string) => void; theme?: string | undefined }) {
  const [traceRequest, setTraceRequest] = useState<{ traceId: string; sequence: number } | null>(null)
  if (!result && running) {
    const simulatedTimeMs = progress?.simulatedTimeMs ?? 0
    const simulatedDurationMs = progress?.simulatedDurationMs ?? 1
    const percentage = Math.min(100, Math.round((simulatedTimeMs / simulatedDurationMs) * 100))
    return <div className="results-empty simulation-progress" role="status" aria-live="polite"><FlaskConical size={24} /><strong>{progress ? `Simulating virtual time · ${percentage}%` : 'Starting simulation worker…'}</strong><progress aria-label="Simulation progress" max={simulatedDurationMs} value={simulatedTimeMs} /><p>{progress ? `${progress.generatedRequests.toLocaleString()} generated · ${progress.completedRequests.toLocaleString()} completed · ${progress.failedRequests.toLocaleString()} failed` : 'Compiling the project and initializing its runtime.'}</p></div>
  }
  if (!result) return <div className="results-empty"><FlaskConical size={24} /><strong>No simulation yet</strong><p>Build a connected topology, then run it. Metrics shown here are produced by the simulation worker.</p></div>
  return (
    <>
      <div className="metrics-grid">
        <div><span>Throughput</span><strong>{result.summary.throughputPerSecond.toLocaleString()}<small> req/s</small></strong></div>
        <div><span>P95 latency</span><strong>{result.summary.latencyP95Ms.toLocaleString()}<small> ms</small></strong></div>
        <div><span>Error rate</span><strong>{(result.summary.errorRate * 100).toFixed(2)}<small>%</small></strong></div>
        <div><span>Completed</span><strong>{result.summary.completedRequests.toLocaleString()}</strong></div>
      </div>
      <div className="chart-block"><div className="block-title"><strong>Throughput over virtual time</strong><span>{result.simulatedDurationMs / 1_000}s run · shaded fault windows</span></div><MetricChart points={result.timeSeries} events={result.events} simulatedDurationMs={result.simulatedDurationMs} theme={theme} /></div>
      <div className="node-table-wrap"><table className="node-table"><thead><tr><th>Component</th><th>Util.</th><th>Avg queue</th><th>Max queue</th><th>Domain metrics</th></tr></thead><tbody>{result.nodes.map((node) => <tr key={node.nodeId}><td><strong>{node.nodeName}</strong><span>{node.nodeType}</span></td><td>{(node.utilization * 100).toFixed(1)}%</td><td>{node.averageQueueLength.toFixed(1)}</td><td>{node.maxQueueLength}</td><td><span className="domain-metrics">{formatDomainMetrics(node.details)}</span></td></tr>)}</tbody></table></div>
      <FaultTraceEvidence result={result} />
      <BottleneckExplanations result={result} onShowNode={onShowTraceNode} onShowTrace={(traceId) => setTraceRequest((current) => ({ traceId, sequence: (current?.sequence ?? 0) + 1 }))} />
      <TraceExplorer key={`${result.runId}:${traceRequest?.sequence ?? 0}`} result={result} nodes={nodes} onShowOnCanvas={onShowTraceNode} theme={theme} {...(traceRequest ? { requestedTraceId: traceRequest.traceId } : {})} />
      {result.warnings.length ? <div className="warnings"><CircleAlert size={15} /> {result.warnings.join(' ')}</div> : null}
    </>
  )
}

const domainMetricLabels: Record<string, string> = {
  cacheHitRate: 'hit', cacheOccupancy: 'occupancy', consumerLag: 'lag', partitionImbalance: 'partition skew',
  byteThroughputPerSecond: 'bytes/s', hottestShardShare: 'hot shard', maxReplicaLagMs: 'replica lag',
}

function formatDomainMetrics(details: SimulationResult['nodes'][number]['details']) {
  const preferred = Object.entries(details).filter(([key]) => key in domainMetricLabels).slice(0, 3)
  if (preferred.length === 0) return '—'
  return preferred.map(([key, value]) => {
    const formatted = typeof value === 'number' && ['cacheHitRate', 'cacheOccupancy', 'partitionImbalance', 'hottestShardShare'].includes(key)
      ? `${(value * 100).toFixed(1)}%` : typeof value === 'number' ? value.toLocaleString() : String(value)
    return `${domainMetricLabels[key]} ${formatted}`
  }).join(' · ')
}

function WorkbenchInner() {
  const { resolvedTheme, setTheme } = useTheme()
  const project = useWorkbenchStore((state) => state.project)
  const experiment = getActiveExperiment(project)
  const selectedNodeId = useWorkbenchStore((state) => state.selectedNodeId)
  const selectedEdgeId = useWorkbenchStore((state) => state.selectedEdgeId)
  const selectedFaultId = useWorkbenchStore((state) => state.selectedFaultId)
  const result = useWorkbenchStore((state) => state.result)
  const running = useWorkbenchStore((state) => state.running)
  const error = useWorkbenchStore((state) => state.error)
  const { setProject, restoreProject, addComponent, addRolePreset, onNodesChange, onEdgesChange, connect, selectNode, selectEdge, selectFault, addFault, updateFault, deleteFault, updateSimulation, updateMeta, setRunning, setResult, setError } = useWorkbenchStore()
  const canUndo = useCanUndo()
  const canRedo = useCanRedo()
  const selectedNode = project.topology.nodes.find((node) => node.id === selectedNodeId)
  const selectedEdge = project.topology.edges.find((edge) => edge.id === selectedEdgeId)
  const selectedFault = experiment.faults.find((fault) => fault.id === selectedFaultId)
  const affected = useMemo(() => affectedTopology(selectedFault, project), [project, selectedFault])
  const reactFlow = useReactFlow<ReturnType<typeof projectToNodes>[number]>()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const clientRef = useRef<SimulationWorkerClient | null>(null)
  const [exampleOpen, setExampleOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [revisions, setRevisions] = useState<ProjectRevisionRecord[]>([])
  const [runs, setRuns] = useState<SimulationRunRecord[]>([])
  const [historyReady, setHistoryReady] = useState(false)
  const [progress, setProgress] = useState<SimulationProgress | null>(null)
  const [resultsView, setResultsView] = useState<'run' | 'compare'>('run')
  const runTabRef = useRef<HTMLButtonElement>(null)
  const compareTabRef = useRef<HTMLButtonElement>(null)
  const faultsPanelRef = useRef<ImperativePanelHandle>(null)
  const inspectorPanelRef = useRef<ImperativePanelHandle>(null)
  const resultsPanelRef = useRef<ImperativePanelHandle>(null)
  const [panelVisibility, setPanelVisibility] = useState(defaultPanelVisibility)
  const topologyNodes = project.topology.nodes
  const nodes = useMemo(() => projectToNodes(topologyNodes).map((node) => ({ ...node, selected: node.id === selectedNodeId || affected.nodes.has(node.id), ...(affected.nodes.has(node.id) ? { className: 'is-fault-target' } : {}) })), [affected.nodes, topologyNodes, selectedNodeId])
  const edges = useMemo(() => projectToEdges(project).map((edge) => ({ ...edge, selected: edge.id === selectedEdgeId || affected.edges.has(edge.id), ...(affected.edges.has(edge.id) ? { className: 'is-fault-target' } : {}) })), [affected.edges, project, selectedEdgeId])

  const refreshHistory = useCallback(async (projectId: string) => {
    const repository = getLocalHistoryRepository()
    const [savedRevisions, savedRuns] = await Promise.all([repository.listProjectRevisions(projectId), repository.listSimulationRuns(projectId)])
    setRevisions(savedRevisions)
    setRuns(savedRuns)
  }, [])

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const saved = await getLocalHistoryRepository().loadActiveProject()
        if (active && saved) restoreProject(saved.project)
      } catch (cause) {
        if (active) setError(cause instanceof Error ? `Could not restore local project: ${cause.message}` : 'Could not restore local project.')
      } finally {
        if (active) setHistoryReady(true)
      }
    })()
    return () => { active = false; clientRef.current?.dispose() }
  }, [restoreProject, setError])

  useEffect(() => {
    if (!historyReady) return
    const timer = window.setTimeout(() => {
      void getLocalHistoryRepository().saveProjectRevision(project).then(() => refreshHistory(project.id)).catch((cause) => setError(cause instanceof Error ? `Could not save local revision: ${cause.message}` : 'Could not save local revision.'))
    }, 350)
    return () => window.clearTimeout(timer)
  }, [historyReady, project, refreshHistory, setError])

  // Layout preferences are local UI state, independent from the exported project file.
  useEffect(() => {
    const visibility = loadPanelVisibility()
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPanelVisibility(visibility)
    if (!visibility.faults) faultsPanelRef.current?.collapse()
    if (!visibility.inspector) inspectorPanelRef.current?.collapse()
    if (!visibility.results) resultsPanelRef.current?.collapse()
  }, [])

  const addAtCenter = useCallback((type: ComponentType) => {
    const viewport = reactFlow.getViewport()
    const element = document.querySelector('.canvas-stage')
    const rect = element?.getBoundingClientRect()
    const position = rect ? reactFlow.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }) : { x: (400 - viewport.x) / viewport.zoom, y: (240 - viewport.y) / viewport.zoom }
    addComponent(type, position)
  }, [addComponent, reactFlow])
  const addPresetAtCenter = useCallback((presetId: string, version: number) => {
    const viewport = reactFlow.getViewport()
    const element = document.querySelector('.canvas-stage')
    const rect = element?.getBoundingClientRect()
    const position = rect ? reactFlow.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }) : { x: (400 - viewport.x) / viewport.zoom, y: (240 - viewport.y) / viewport.zoom }
    addRolePreset(presetId, version, position)
  }, [addRolePreset, reactFlow])

  const onConnect: OnConnect = useCallback((connection) => connect(connection), [connect])
  const onDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    const type = event.dataTransfer.getData('application/system-design-component') as ComponentType
    const presetReference = event.dataTransfer.getData('application/system-design-role-preset')
    const position = reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY })
    if (orderedTypes.includes(type)) addComponent(type, position)
    else if (presetReference) {
      const [presetId, version] = presetReference.split('@')
      if (presetId && Number.isInteger(Number(version))) addRolePreset(presetId, Number(version), position)
    }
  }, [addComponent, addRolePreset, reactFlow])

  const showTraceNode = useCallback((nodeId: string) => {
    const node = project.topology.nodes.find((candidate) => candidate.id === nodeId)
    if (!node) return
    selectNode(nodeId)
    reactFlow.setCenter(node.position.x + 99, node.position.y + 38, { zoom: 1.25, duration: 350 })
  }, [project.topology.nodes, reactFlow, selectNode])

  const run = async () => {
    setRunning(true); setError(null); setResult(null); setProgress(null)
    try {
      const projectSnapshot = componentRegistry.validateProject(structuredClone(project), rolePresetRegistry)
      const validation = validateScenarioForSimulation(projectSnapshot)
      if (validation.errors.length > 0) throw new Error(validation.errors.join(' '))
      clientRef.current ??= new SimulationWorkerClient()
      const completed = await clientRef.current.run(projectSnapshot, { onProgress: setProgress })
      setResultsView('run')
      setResult(completed)
      const repository = getLocalHistoryRepository()
      const revision = await repository.saveProjectRevision(projectSnapshot)
      await repository.saveSimulationRun(projectSnapshot, completed, revision.revisionId)
      await refreshHistory(projectSnapshot.id)
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) setError(cause instanceof Error ? cause.message : 'Simulation failed.')
    } finally { setRunning(false) }
  }

  const cancelRun = () => clientRef.current?.cancelActive()
  const setPanelVisible = (panel: PanelName, ref: React.RefObject<ImperativePanelHandle | null>, visible: boolean) => {
    if (visible) ref.current?.expand()
    else ref.current?.collapse()
    setPanelVisibility((current) => {
      const next = { ...current, [panel]: visible }
      window.localStorage.setItem(panelVisibilityStorageKey, JSON.stringify(next))
      return next
    })
  }
  const selectResultsView = (view: 'run' | 'compare') => {
    setResultsView(view)
    ;(view === 'run' ? runTabRef : compareTabRef).current?.focus()
  }
  const handleResultsTabKey = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    selectResultsView(event.key === 'ArrowRight' || event.key === 'End' ? 'compare' : 'run')
  }

  const exportProject = () => {
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' })
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `${project.id}.json`; link.click(); URL.revokeObjectURL(link.href)
  }

  const importProject = async (file: File | undefined) => {
    if (!file) return
    try {
      const imported = componentRegistry.validateProject(parseProjectFile(JSON.parse(await file.text())), rolePresetRegistry)
      setProject(imported)
      await getLocalHistoryRepository().saveProjectRevision(imported, 'import')
      await refreshHistory(imported.id)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Invalid project file.') }
  }

  const restoreRevision = async (revisionId: string) => {
    try {
      const saved = await getLocalHistoryRepository().loadProjectRevision(revisionId)
      if (!saved) throw new Error('The selected revision no longer exists.')
      restoreProject(saved.project)
      await getLocalHistoryRepository().saveProjectRevision(saved.project, 'restore')
      await refreshHistory(saved.projectId)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not restore project revision.') }
  }

  const restoreRun = async (savedRun: SimulationRunRecord) => {
    try {
      const snapshot = savedRun.projectSnapshot ?? (await getLocalHistoryRepository().loadProjectRevision(savedRun.projectRevisionId))?.project
      if (!snapshot) throw new Error('The project snapshot for this run no longer exists.')
      restoreProject(snapshot)
      setResult(structuredClone(savedRun.result))
      setHistoryOpen(false)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not restore simulation run.') }
  }

  const palettePanel = (
      <aside className="palette">
        <div className="panel-header"><span>Behaviors</span><small>New runtime semantics</small></div>
        <div className="palette-list">{orderedTypes.map((type) => <PaletteItem key={type} type={type} onAdd={() => addAtCenter(type)} />)}</div>
        <div className="panel-header palette-section-heading"><span>Role presets</span><small>Reuse behaviors</small></div>
        <div className="palette-list">{rolePresetRegistry.list().map((preset) => <RolePresetItem key={`${preset.id}@${preset.version}`} preset={preset} onAdd={() => addPresetAtCenter(preset.id, preset.version)} />)}</div>
        <div className="palette-help"><strong>Build from scratch</strong><p>Components are executable behaviors, not decorative icons. Connect output ports to input ports.</p></div>
      </aside>
  )

  const canvasPanel = (
      <section className="canvas-stage" onDrop={onDrop} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move' }}>
        <ReactFlow
          nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
          onConnect={onConnect} onNodeClick={(_, node) => selectNode(node.id)} onEdgeClick={(_, edge) => selectEdge(edge.id)} onPaneClick={() => { selectNode(null); selectEdge(null); selectFault(null) }}
          deleteKeyCode={["Backspace", "Delete"]} fitView minZoom={0.2} maxZoom={2}
          defaultEdgeOptions={{ type: 'smoothstep', animated: true }} proOptions={{ hideAttribution: false }}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="var(--canvas-dot)" />
          <Controls position="bottom-left" showInteractive={false} />
          <MiniMap pannable zoomable position="bottom-right" nodeColor={(node) => componentRegistry.get((node.data as ProjectNode).type, (node.data as ProjectNode).componentVersion).color} />
          {project.topology.nodes.length === 0 ? <Panel position="top-center"><div className="canvas-empty"><span><Plus size={20} /></span><strong>Start with an empty canvas</strong><p>Drag any component here, connect it, configure load, then run the model.</p></div></Panel> : null}
          <Panel position="top-left"><div className="canvas-toolbar"><button type="button" onClick={() => { setProject(createEmptyProject()); reactFlow.setCenter(0, 0, { zoom: 1 }) }}><RotateCcw size={14} /> Clear canvas</button><div className="example-picker"><button type="button" aria-expanded={exampleOpen} onClick={() => setExampleOpen((open) => !open)}><Save size={14} /> Load example <ChevronDown size={13} /></button>{exampleOpen ? <div className="example-menu"><button type="button" onClick={() => { setProject(createDirectExample()); setExampleOpen(false); setTimeout(() => reactFlow.fitView(), 0) }}><strong>Direct service</strong><span>Traffic → Network → Service → DB</span></button><button type="button" onClick={() => { setProject(createAsyncExample()); setExampleOpen(false); setTimeout(() => reactFlow.fitView(), 0) }}><strong>Async pipeline</strong><span>Traffic → API → Queue → Worker → DB</span></button><button type="button" onClick={() => { setProject(createDataPlatformExample()); setExampleOpen(false); setTimeout(() => reactFlow.fitView(), 0) }}><strong>Data platform</strong><span>Cache → Shards → Stream → Objects</span></button></div> : null}</div></div></Panel>
        </ReactFlow>
        {error ? <div className="error-toast" role="alert"><CircleAlert size={16} /><span>{error}</span><button type="button" onClick={() => setError(null)} aria-label="Dismiss error">×</button></div> : null}
      </section>
  )

  const inspectorPanel = (
      <aside className="inspector">
        <div className="inspector-tabs"><span className="active">Properties</span><button type="button" className="panel-close" aria-label="Hide properties panel" title="Hide properties panel" onClick={() => setPanelVisible('inspector', inspectorPanelRef, false)}><X size={13} /></button></div>
        <PropertiesPanel node={selectedNode} edge={selectedEdge} />
        <RegionSection />
        <div className="run-settings"><div className="panel-header"><span>Run settings</span><small>Virtual time</small></div><Field label="Duration (seconds)" value={experiment.simulation.durationSeconds} min={1} onChange={(durationSeconds) => updateSimulation({ durationSeconds })} /><label className="field"><span>Random seed</span><input value={experiment.seed} onChange={(event) => updateMeta({ seed: event.target.value })} /></label></div>
      </aside>
  )

  const resultsPanel = (
      <section className="results"><div className="results-header"><div><span>Simulation output</span>{result ? <small>seed: {result.seed} · computed in {result.wallClockDurationMs} ms</small> : null}</div><div className="panel-heading-actions"><div className="results-views" role="tablist" aria-label="Simulation result views"><button ref={runTabRef} type="button" role="tab" aria-selected={resultsView === 'run'} tabIndex={resultsView === 'run' ? 0 : -1} onKeyDown={handleResultsTabKey} onClick={() => setResultsView('run')}>Run details</button><button ref={compareTabRef} type="button" role="tab" aria-selected={resultsView === 'compare'} tabIndex={resultsView === 'compare' ? 0 : -1} onKeyDown={handleResultsTabKey} onClick={() => setResultsView('compare')}>Compare runs <small>{runs.length}</small></button></div><button type="button" className="panel-close" aria-label="Hide simulation output" title="Hide simulation output" onClick={() => setPanelVisible('results', resultsPanelRef, false)}><X size={13} /></button></div></div><div role="tabpanel" aria-label={resultsView === 'run' ? 'Run details' : 'Compare runs'}>{resultsView === 'run' ? <ResultsPanel result={result} progress={progress} running={running} nodes={project.topology.nodes} onShowTraceNode={showTraceNode} theme={resolvedTheme} /> : <RunComparisonPanel key={`${project.id}:${result?.runId ?? ''}`} runs={runs} theme={resolvedTheme} {...(result ? { activeRunId: result.runId } : {})} />}</div></section>
  )

  return (
    <main className="workbench">
      <header className="topbar">
        <div className="brand"><span className="brand-mark"><Layers3 size={19} /></span><div><strong>System Design Simulator</strong><span>Build · Run · Break · Measure</span></div></div>
        <div className="topbar-center"><span className="status-dot" /> Local simulation <span className="separator" /> <strong>{project.topology.nodes.length}</strong> components <span className="separator" /> <strong>{project.topology.edges.length}</strong> links</div>
        <div className="top-actions">
          <button type="button" className="button subtle icon-only theme-toggle" aria-label={`Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} theme`} title={`Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} theme`} onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}><span className="theme-icon theme-icon--light"><Moon size={15} /></span><span className="theme-icon theme-icon--dark"><Sun size={15} /></span></button>
          <button type="button" className="button subtle layout-toggle" aria-label={`${panelVisibility.faults ? 'Hide' : 'Show'} fault laboratory`} title={`${panelVisibility.faults ? 'Hide' : 'Show'} fault laboratory`} aria-pressed={panelVisibility.faults} onClick={() => setPanelVisible('faults', faultsPanelRef, !panelVisibility.faults)}><FlaskConical size={15} /><span>Fault lab</span></button>
          <button type="button" className="button subtle layout-toggle" aria-label={`${panelVisibility.results ? 'Hide' : 'Show'} simulation output`} title={`${panelVisibility.results ? 'Hide' : 'Show'} simulation output`} aria-pressed={panelVisibility.results} onClick={() => setPanelVisible('results', resultsPanelRef, !panelVisibility.results)}><PanelBottom size={15} /><span>Output</span></button>
          <button type="button" className="button subtle layout-toggle" aria-label={`${panelVisibility.inspector ? 'Hide' : 'Show'} properties panel`} title={`${panelVisibility.inspector ? 'Hide' : 'Show'} properties panel`} aria-pressed={panelVisibility.inspector} onClick={() => setPanelVisible('inspector', inspectorPanelRef, !panelVisibility.inspector)}><PanelRight size={15} /><span>Properties</span></button>
          <button type="button" className="button subtle icon-only" aria-label="Undo project change" title="Undo project change" disabled={!canUndo || running} onClick={undoProject}><Undo2 size={15} /></button>
          <button type="button" className="button subtle icon-only" aria-label="Redo project change" title="Redo project change" disabled={!canRedo || running} onClick={redoProject}><Redo2 size={15} /></button>
          <div className="history-picker">
            <button type="button" className="button subtle" aria-expanded={historyOpen} onClick={() => { const next = !historyOpen; setHistoryOpen(next); if (next) void refreshHistory(project.id) }}><History size={15} /> History</button>
            {historyOpen ? <div className="history-menu" role="dialog" aria-label="Local project history">
              <div className="history-section"><strong>Project revisions</strong>{revisions.length ? revisions.slice(0, 8).map((revision) => <button type="button" key={revision.revisionId} onClick={() => void restoreRevision(revision.revisionId)}><span>{revision.projectName}</span><small>{revision.source} · {new Date(revision.createdAt).toLocaleString()}</small></button>) : <p>No saved revisions yet.</p>}</div>
              <div className="history-section"><strong>Simulation runs</strong>{runs.length ? runs.slice(0, 8).map((savedRun) => <button type="button" key={savedRun.runId} onClick={() => void restoreRun(savedRun)}><span>{savedRun.result.summary.completedRequests.toLocaleString()} completed · {(savedRun.result.summary.errorRate * 100).toFixed(1)}% errors</span><small>{new Date(savedRun.createdAt).toLocaleString()} · seed {savedRun.result.seed}</small></button>) : <p>No saved runs yet.</p>}</div>
            </div> : null}
          </div>
          <button type="button" className="button subtle" onClick={() => fileInputRef.current?.click()}><Upload size={15} /> Import</button>
          <input ref={fileInputRef} hidden type="file" accept="application/json" onChange={(event) => void importProject(event.target.files?.[0])} />
          <button type="button" className="button subtle" onClick={exportProject}><Download size={15} /> Export</button>
          {running ? <button type="button" className="button subtle" onClick={cancelRun}><Square size={14} fill="currentColor" /> Cancel</button> : null}
          <button type="button" className="button run" onClick={() => void run()} disabled={running}><Play size={15} fill="currentColor" /> {running ? 'Running…' : 'Run simulation'}</button>
        </div>
      </header>
      <WorkbenchShell
        palette={palettePanel} canvas={canvasPanel}
        faults={<div className="panel-container"><button type="button" className="panel-close panel-close--overlay" aria-label="Hide fault laboratory" title="Hide fault laboratory" onClick={() => setPanelVisible('faults', faultsPanelRef, false)}><X size={13} /></button><FaultLaboratory experiment={experiment} project={project} selectedFaultId={selectedFaultId} onSelectFault={selectFault} onAddFault={addFault} onUpdateFault={updateFault} onDeleteFault={deleteFault} /></div>}
        inspector={inspectorPanel} results={resultsPanel}
        faultsRef={faultsPanelRef} inspectorRef={inspectorPanelRef} resultsRef={resultsPanelRef}
      />
    </main>
  )
}

export function Workbench() { return <ReactFlowProvider><WorkbenchInner /></ReactFlowProvider> }
