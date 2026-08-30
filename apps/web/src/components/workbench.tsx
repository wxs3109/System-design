'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Background, BackgroundVariant, Controls, MiniMap, Panel, ReactFlow, ReactFlowProvider, useReactFlow, type OnConnect } from '@xyflow/react'
import { builtInComponentTypes, componentRegistry, type ConfigField } from '@system-design/components'
import { createEmptyProject, getActiveExperiment, parseProjectFile, type ComponentType, type ProjectConnection, type SimulationProgress, type SimulationResult } from '@system-design/model'
import { SimulationWorkerClient } from '@system-design/simulation/client'
import { validateScenarioForSimulation } from '@system-design/simulation'
import { ChevronDown, CircleAlert, Download, FlaskConical, Layers3, MousePointer2, Play, Plus, RotateCcw, Save, Square, Trash2, Upload } from 'lucide-react'
import { ComponentNode, componentIcons } from './component-node'
import { MetricChart } from './metric-chart'
import { createAsyncExample, createDirectExample } from '@/lib/examples'
import { projectToEdges, projectToNodes, useWorkbenchStore, type ProjectNode } from '@/lib/store'

const nodeTypes = { component: ComponentNode }
const orderedTypes = builtInComponentTypes

function Field({ label, value, min = 0, step = 1, onChange }: { label: string; value: number; min?: number; step?: number; onChange: (value: number) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="number" min={min} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  )
}

function PaletteItem({ type, onAdd }: { type: ComponentType; onAdd: () => void }) {
  const definition = componentRegistry.get(type)
  const Icon = componentIcons[definition.iconToken]!
  return (
    <button
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

function ConfigFieldControl({ field, value, onChange }: { field: ConfigField; value: unknown; onChange: (value: number | string) => void }) {
  if (field.kind === 'number') return <Field label={field.label} value={Number(value)} {...(field.min === undefined ? {} : { min: field.min })} {...(field.step === undefined ? {} : { step: field.step })} onChange={onChange} />
  if (field.kind === 'select') return <label className="field"><span>{field.label}</span><select value={String(value)} onChange={(event) => onChange(event.target.value)}>{field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
  return <label className="field"><span>{field.label}</span><input value={String(value)} onChange={(event) => onChange(event.target.value)} /></label>
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
        <div className="section-heading"><div><span>Selected connection</span><strong>{edge.sourceSemantic} → {edge.targetSemantic}</strong></div><button className="icon-button danger" onClick={deleteEdge} aria-label="Delete selected connection"><Trash2 size={16} /></button></div>
        <label className="field"><span>Routing mode</span><select value={edge.routingMode} disabled={asynchronous} onChange={(event) => updateEdge({ routingMode: event.target.value as 'weighted-one' | 'fan-out' })}>{asynchronous ? <option value="async-publish">Async publish</option> : <><option value="weighted-one">Weighted one-of</option><option value="fan-out">Fan-out</option></>}</select></label>
        {edge.routingMode === 'weighted-one' ? <Field label="Routing weight" value={edge.weight} min={0.001} step={0.1} onChange={(weight) => updateEdge({ weight })} /> : null}
        <p className="property-help">Routing is applied to every connection from the same output port.</p>
      </div>
    )
  }
  if (!node) {
    return <div className="empty-properties"><MousePointer2 size={22} /><p>Select a component to configure its runtime behavior.</p></div>
  }
  const manifest = componentRegistry.get(node.type, node.componentVersion)
  const setConfig = (key: string, value: number | string) => updateNode({ config: { [key]: value } })
  return (
    <div className="properties-form">
      <div className="section-heading"><div><span>Selected component</span><strong>{manifest.label}</strong></div><button className="icon-button danger" onClick={deleteNode} aria-label="Delete selected component"><Trash2 size={16} /></button></div>
      <label className="field"><span>Name</span><input value={node.name} onChange={(event) => updateNode({ name: event.target.value })} /></label>
      {node.type === 'traffic' && workload ? <>
        <Field label="Requests / second" value={workload.requestsPerSecond} min={0.1} step={10} onChange={(value) => updateWorkload({ requestsPerSecond: value })} />
        <label className="field"><span>Arrival pattern</span><select value={workload.pattern} onChange={(event) => updateWorkload({ pattern: event.target.value as 'constant' | 'poisson' })}><option value="poisson">Poisson</option><option value="constant">Constant</option></select></label>
      </> : null}
      {manifest.configFields.map((field) => <ConfigFieldControl key={field.key} field={field} value={(node.config as Record<string, unknown>)[field.key]} onChange={(value) => setConfig(field.key, value)} />)}
    </div>
  )
}

function ResultsPanel({ result, progress, running }: { result: SimulationResult | null; progress: SimulationProgress | null; running: boolean }) {
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
      <div className="chart-block"><div className="block-title"><strong>Throughput over virtual time</strong><span>{result.simulatedDurationMs / 1_000}s run</span></div><MetricChart points={result.timeSeries} /></div>
      <div className="node-table-wrap"><table className="node-table"><thead><tr><th>Component</th><th>Util.</th><th>Avg queue</th><th>Max queue</th></tr></thead><tbody>{result.nodes.map((node) => <tr key={node.nodeId}><td><strong>{node.nodeName}</strong><span>{node.nodeType}</span></td><td>{(node.utilization * 100).toFixed(1)}%</td><td>{node.averageQueueLength.toFixed(1)}</td><td>{node.maxQueueLength}</td></tr>)}</tbody></table></div>
      {result.warnings.length ? <div className="warnings"><CircleAlert size={15} /> {result.warnings.join(' ')}</div> : null}
    </>
  )
}

function WorkbenchInner() {
  const project = useWorkbenchStore((state) => state.project)
  const experiment = getActiveExperiment(project)
  const selectedNodeId = useWorkbenchStore((state) => state.selectedNodeId)
  const selectedEdgeId = useWorkbenchStore((state) => state.selectedEdgeId)
  const result = useWorkbenchStore((state) => state.result)
  const running = useWorkbenchStore((state) => state.running)
  const error = useWorkbenchStore((state) => state.error)
  const { setProject, addComponent, onNodesChange, onEdgesChange, connect, selectNode, selectEdge, updateSimulation, updateMeta, setRunning, setResult, setError } = useWorkbenchStore()
  const selectedNode = project.topology.nodes.find((node) => node.id === selectedNodeId)
  const selectedEdge = project.topology.edges.find((edge) => edge.id === selectedEdgeId)
  const reactFlow = useReactFlow<ReturnType<typeof projectToNodes>[number]>()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const clientRef = useRef<SimulationWorkerClient | null>(null)
  const [exampleOpen, setExampleOpen] = useState(false)
  const [progress, setProgress] = useState<SimulationProgress | null>(null)
  const nodes = useMemo(() => projectToNodes(project).map((node) => ({ ...node, selected: node.id === selectedNodeId })), [project, selectedNodeId])
  const edges = useMemo(() => projectToEdges(project).map((edge) => ({ ...edge, selected: edge.id === selectedEdgeId })), [project, selectedEdgeId])

  useEffect(() => () => clientRef.current?.dispose(), [])

  const addAtCenter = useCallback((type: ComponentType) => {
    const viewport = reactFlow.getViewport()
    const element = document.querySelector('.canvas-stage')
    const rect = element?.getBoundingClientRect()
    const position = rect ? reactFlow.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }) : { x: (400 - viewport.x) / viewport.zoom, y: (240 - viewport.y) / viewport.zoom }
    addComponent(type, position)
  }, [addComponent, reactFlow])

  const onConnect: OnConnect = useCallback((connection) => connect(connection), [connect])
  const onDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    const type = event.dataTransfer.getData('application/system-design-component') as ComponentType
    if (!orderedTypes.includes(type)) return
    addComponent(type, reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY }))
  }, [addComponent, reactFlow])

  const run = async () => {
    setRunning(true); setError(null); setResult(null); setProgress(null)
    try {
      const validation = validateScenarioForSimulation(project)
      if (validation.errors.length > 0) throw new Error(validation.errors.join(' '))
      clientRef.current ??= new SimulationWorkerClient()
      setResult(await clientRef.current.run(project, { onProgress: setProgress }))
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) setError(cause instanceof Error ? cause.message : 'Simulation failed.')
    } finally { setRunning(false) }
  }

  const cancelRun = () => clientRef.current?.cancelActive()

  const exportProject = () => {
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' })
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `${project.id}.json`; link.click(); URL.revokeObjectURL(link.href)
  }

  const importProject = async (file: File | undefined) => {
    if (!file) return
    try { setProject(parseProjectFile(JSON.parse(await file.text()))) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Invalid project file.') }
  }

  return (
    <main className="workbench">
      <header className="topbar">
        <div className="brand"><span className="brand-mark"><Layers3 size={19} /></span><div><strong>System Design Simulator</strong><span>Build · Run · Break · Measure</span></div></div>
        <div className="topbar-center"><span className="status-dot" /> Local simulation <span className="separator" /> <strong>{project.topology.nodes.length}</strong> components <span className="separator" /> <strong>{project.topology.edges.length}</strong> links</div>
        <div className="top-actions">
          <button className="button subtle" onClick={() => fileInputRef.current?.click()}><Upload size={15} /> Import</button>
          <input ref={fileInputRef} hidden type="file" accept="application/json" onChange={(event) => void importProject(event.target.files?.[0])} />
          <button className="button subtle" onClick={exportProject}><Download size={15} /> Export</button>
          {running ? <button className="button subtle" onClick={cancelRun}><Square size={14} fill="currentColor" /> Cancel</button> : null}
          <button className="button run" onClick={() => void run()} disabled={running}><Play size={15} fill="currentColor" /> {running ? 'Running…' : 'Run simulation'}</button>
        </div>
      </header>

      <aside className="palette">
        <div className="panel-header"><span>Components</span><small>Drag or click to add</small></div>
        <div className="palette-list">{orderedTypes.map((type) => <PaletteItem key={type} type={type} onAdd={() => addAtCenter(type)} />)}</div>
        <div className="palette-help"><strong>Build from scratch</strong><p>Components are executable behaviors, not decorative icons. Connect output ports to input ports.</p></div>
      </aside>

      <section className="canvas-stage" onDrop={onDrop} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move' }}>
        <ReactFlow
          nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
          onConnect={onConnect} onNodeClick={(_, node) => selectNode(node.id)} onEdgeClick={(_, edge) => selectEdge(edge.id)} onPaneClick={() => { selectNode(null); selectEdge(null) }}
          deleteKeyCode={["Backspace", "Delete"]} fitView minZoom={0.2} maxZoom={2}
          defaultEdgeOptions={{ type: 'smoothstep', animated: true }} proOptions={{ hideAttribution: false }}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#334155" />
          <Controls position="bottom-left" showInteractive={false} />
          <MiniMap pannable zoomable position="bottom-right" nodeColor={(node) => componentRegistry.get((node.data as ProjectNode).type, (node.data as ProjectNode).componentVersion).color} />
          {project.topology.nodes.length === 0 ? <Panel position="top-center"><div className="canvas-empty"><span><Plus size={20} /></span><strong>Start with an empty canvas</strong><p>Drag any component here, connect it, configure load, then run the model.</p></div></Panel> : null}
          <Panel position="top-left"><div className="canvas-toolbar"><button onClick={() => { setProject(createEmptyProject()); reactFlow.setCenter(0, 0, { zoom: 1 }) }}><RotateCcw size={14} /> Clear canvas</button><div className="example-picker"><button onClick={() => setExampleOpen((open) => !open)}><Save size={14} /> Load example <ChevronDown size={13} /></button>{exampleOpen ? <div className="example-menu"><button onClick={() => { setProject(createDirectExample()); setExampleOpen(false); setTimeout(() => reactFlow.fitView(), 0) }}><strong>Direct service</strong><span>Traffic → Network → Service → DB</span></button><button onClick={() => { setProject(createAsyncExample()); setExampleOpen(false); setTimeout(() => reactFlow.fitView(), 0) }}><strong>Async pipeline</strong><span>Traffic → API → Queue → Worker → DB</span></button></div> : null}</div></div></Panel>
        </ReactFlow>
        {error ? <div className="error-toast" role="alert"><CircleAlert size={16} /><span>{error}</span><button onClick={() => setError(null)} aria-label="Dismiss error">×</button></div> : null}
      </section>

      <aside className="inspector">
        <div className="inspector-tabs"><span className="active">Properties</span></div>
        <PropertiesPanel node={selectedNode} edge={selectedEdge} />
        <div className="run-settings"><div className="panel-header"><span>Run settings</span><small>Virtual time</small></div><Field label="Duration (seconds)" value={experiment.simulation.durationSeconds} min={1} onChange={(durationSeconds) => updateSimulation({ durationSeconds })} /><label className="field"><span>Random seed</span><input value={experiment.seed} onChange={(event) => updateMeta({ seed: event.target.value })} /></label></div>
      </aside>

      <section className="results"><div className="results-header"><div><span>Simulation output</span>{result ? <small>seed: {result.seed} · computed in {result.wallClockDurationMs} ms</small> : null}</div></div><ResultsPanel result={result} progress={progress} running={running} /></section>
    </main>
  )
}

export function Workbench() { return <ReactFlowProvider><WorkbenchInner /></ReactFlowProvider> }
