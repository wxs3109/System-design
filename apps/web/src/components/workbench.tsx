'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Background, BackgroundVariant, Controls, MiniMap, Panel, ReactFlow, ReactFlowProvider, useReactFlow, type OnConnect } from '@xyflow/react'
import { componentCatalog, createEmptyScenario, scenarioSchema, type ComponentNode as ComponentNodeModel, type ComponentType, type SimulationResult } from '@system-design/model'
import { SimulationWorkerClient } from '@system-design/simulation/client'
import { validateScenarioForSimulation } from '@system-design/simulation'
import { Activity, ChevronDown, CircleAlert, Database, Download, FlaskConical, Globe2, Layers3, MousePointer2, Play, Plus, RotateCcw, Save, Server, Trash2, Upload } from 'lucide-react'
import { ComponentNode } from './component-node'
import { MetricChart } from './metric-chart'
import { createAsyncExample, createDirectExample } from '@/lib/examples'
import { scenarioToEdges, scenarioToNodes, useWorkbenchStore } from '@/lib/store'

const nodeTypes = { component: ComponentNode }
const icons = { traffic: Globe2, network: Activity, service: Server, queue: Layers3, database: Database }
const orderedTypes: ComponentType[] = ['traffic', 'network', 'service', 'queue', 'database']

function Field({ label, value, min = 0, step = 1, onChange }: { label: string; value: number; min?: number; step?: number; onChange: (value: number) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="number" min={min} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  )
}

function PaletteItem({ type, onAdd }: { type: ComponentType; onAdd: () => void }) {
  const definition = componentCatalog[type]
  const Icon = icons[type]
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

function PropertiesPanel({ node }: { node: ComponentNodeModel | undefined }) {
  const updateNode = useWorkbenchStore((state) => state.updateSelectedNode)
  const deleteNode = useWorkbenchStore((state) => state.deleteSelectedNode)
  const workload = useWorkbenchStore((state) => node?.type === 'traffic' ? state.scenario.workloads.find((item) => item.id === node.config.workloadId) : undefined)
  const updateWorkload = useWorkbenchStore((state) => state.updateWorkload)
  if (!node) {
    return <div className="empty-properties"><MousePointer2 size={22} /><p>Select a component to configure its runtime behavior.</p></div>
  }
  const setConfig = (key: string, value: number) => updateNode({ config: { [key]: value } })
  return (
    <div className="properties-form">
      <div className="section-heading"><div><span>Selected component</span><strong>{componentCatalog[node.type].label}</strong></div><button className="icon-button danger" onClick={deleteNode} aria-label="Delete selected component"><Trash2 size={16} /></button></div>
      <label className="field"><span>Name</span><input value={node.name} onChange={(event) => updateNode({ name: event.target.value })} /></label>
      {node.type === 'traffic' && workload ? <>
        <Field label="Requests / second" value={workload.requestsPerSecond} min={0.1} step={10} onChange={(value) => updateWorkload({ requestsPerSecond: value })} />
        <label className="field"><span>Arrival pattern</span><select value={workload.pattern} onChange={(event) => updateWorkload({ pattern: event.target.value as 'constant' | 'poisson' })}><option value="poisson">Poisson</option><option value="constant">Constant</option></select></label>
      </> : null}
      {node.type === 'network' ? <>
        <Field label="Latency (ms)" value={node.config.latencyMs} step={1} onChange={(value) => setConfig('latencyMs', value)} />
        <Field label="Jitter (ms)" value={node.config.jitterMs} step={1} onChange={(value) => setConfig('jitterMs', value)} />
        <Field label="Bandwidth (Mbps)" value={node.config.bandwidthMbps} min={0.1} step={10} onChange={(value) => setConfig('bandwidthMbps', value)} />
        <Field label="Packet loss (0–1)" value={node.config.packetLossRate} step={0.001} onChange={(value) => setConfig('packetLossRate', value)} />
      </> : null}
      {node.type === 'service' ? <>
        <Field label="Replicas" value={node.config.replicas} min={1} onChange={(value) => setConfig('replicas', value)} />
        <Field label="Concurrency / replica" value={node.config.concurrencyPerReplica} min={1} onChange={(value) => setConfig('concurrencyPerReplica', value)} />
        <Field label="Service time (ms)" value={node.config.serviceTimeMs} min={0.1} step={1} onChange={(value) => setConfig('serviceTimeMs', value)} />
        <Field label="Max queue" value={node.config.maxQueueSize} onChange={(value) => setConfig('maxQueueSize', value)} />
        <Field label="Error rate (0–1)" value={node.config.errorRate} step={0.001} onChange={(value) => setConfig('errorRate', value)} />
      </> : null}
      {node.type === 'queue' ? <>
        <Field label="Consumers" value={node.config.consumers} min={1} onChange={(value) => setConfig('consumers', value)} />
        <Field label="Delivery time (ms)" value={node.config.deliveryTimeMs} min={0.1} onChange={(value) => setConfig('deliveryTimeMs', value)} />
        <Field label="Max depth" value={node.config.maxDepth} min={1} onChange={(value) => setConfig('maxDepth', value)} />
      </> : null}
      {node.type === 'database' ? <>
        <Field label="Max connections" value={node.config.maxConnections} min={1} onChange={(value) => setConfig('maxConnections', value)} />
        <Field label="Query time (ms)" value={node.config.queryTimeMs} min={0.1} onChange={(value) => setConfig('queryTimeMs', value)} />
        <Field label="Max queue" value={node.config.maxQueueSize} onChange={(value) => setConfig('maxQueueSize', value)} />
        <Field label="Error rate (0–1)" value={node.config.errorRate} step={0.001} onChange={(value) => setConfig('errorRate', value)} />
      </> : null}
    </div>
  )
}

function ResultsPanel({ result }: { result: SimulationResult | null }) {
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
  const scenario = useWorkbenchStore((state) => state.scenario)
  const selectedNodeId = useWorkbenchStore((state) => state.selectedNodeId)
  const result = useWorkbenchStore((state) => state.result)
  const running = useWorkbenchStore((state) => state.running)
  const error = useWorkbenchStore((state) => state.error)
  const { setScenario, addComponent, onNodesChange, onEdgesChange, connect, selectNode, updateSimulation, updateMeta, setRunning, setResult, setError } = useWorkbenchStore()
  const selectedNode = scenario.nodes.find((node) => node.id === selectedNodeId)
  const reactFlow = useReactFlow<ReturnType<typeof scenarioToNodes>[number]>()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const clientRef = useRef<SimulationWorkerClient | null>(null)
  const [exampleOpen, setExampleOpen] = useState(false)
  const nodes = useMemo(() => scenarioToNodes(scenario).map((node) => ({ ...node, selected: node.id === selectedNodeId })), [scenario, selectedNodeId])
  const edges = useMemo(() => scenarioToEdges(scenario), [scenario])

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
    setRunning(true); setError(null)
    try {
      const parsed = scenarioSchema.parse(scenario)
      const validation = validateScenarioForSimulation(parsed)
      if (validation.errors.length > 0) throw new Error(validation.errors.join(' '))
      clientRef.current ??= new SimulationWorkerClient()
      setResult(await clientRef.current.run(parsed))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Simulation failed.')
    } finally { setRunning(false) }
  }

  const exportScenario = () => {
    const blob = new Blob([JSON.stringify(scenario, null, 2)], { type: 'application/json' })
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `${scenario.id}.json`; link.click(); URL.revokeObjectURL(link.href)
  }

  const importScenario = async (file: File | undefined) => {
    if (!file) return
    try { setScenario(scenarioSchema.parse(JSON.parse(await file.text()))) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Invalid scenario file.') }
  }

  return (
    <main className="workbench">
      <header className="topbar">
        <div className="brand"><span className="brand-mark"><Layers3 size={19} /></span><div><strong>System Design Simulator</strong><span>Build · Run · Break · Measure</span></div></div>
        <div className="topbar-center"><span className="status-dot" /> Local simulation <span className="separator" /> <strong>{scenario.nodes.length}</strong> components <span className="separator" /> <strong>{scenario.edges.length}</strong> links</div>
        <div className="top-actions">
          <button className="button subtle" onClick={() => fileInputRef.current?.click()}><Upload size={15} /> Import</button>
          <input ref={fileInputRef} hidden type="file" accept="application/json" onChange={(event) => void importScenario(event.target.files?.[0])} />
          <button className="button subtle" onClick={exportScenario}><Download size={15} /> Export</button>
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
          onConnect={onConnect} onNodeClick={(_, node) => selectNode(node.id)} onPaneClick={() => selectNode(null)}
          deleteKeyCode={["Backspace", "Delete"]} fitView minZoom={0.2} maxZoom={2}
          defaultEdgeOptions={{ type: 'smoothstep', animated: true }} proOptions={{ hideAttribution: false }}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#334155" />
          <Controls position="bottom-left" showInteractive={false} />
          <MiniMap pannable zoomable position="bottom-right" nodeColor={(node) => componentCatalog[(node.data as ComponentNodeModel).type].color} />
          {scenario.nodes.length === 0 ? <Panel position="top-center"><div className="canvas-empty"><span><Plus size={20} /></span><strong>Start with an empty canvas</strong><p>Drag any component here, connect it, configure load, then run the model.</p></div></Panel> : null}
          <Panel position="top-left"><div className="canvas-toolbar"><button onClick={() => { setScenario(createEmptyScenario()); reactFlow.setCenter(0, 0, { zoom: 1 }) }}><RotateCcw size={14} /> Clear canvas</button><div className="example-picker"><button onClick={() => setExampleOpen((open) => !open)}><Save size={14} /> Load example <ChevronDown size={13} /></button>{exampleOpen ? <div className="example-menu"><button onClick={() => { setScenario(createDirectExample()); setExampleOpen(false); setTimeout(() => reactFlow.fitView(), 0) }}><strong>Direct service</strong><span>Traffic → Network → Service → DB</span></button><button onClick={() => { setScenario(createAsyncExample()); setExampleOpen(false); setTimeout(() => reactFlow.fitView(), 0) }}><strong>Async pipeline</strong><span>Traffic → API → Queue → Worker → DB</span></button></div> : null}</div></div></Panel>
        </ReactFlow>
        {error ? <div className="error-toast" role="alert"><CircleAlert size={16} /><span>{error}</span><button onClick={() => setError(null)} aria-label="Dismiss error">×</button></div> : null}
      </section>

      <aside className="inspector">
        <div className="inspector-tabs"><span className="active">Properties</span></div>
        <PropertiesPanel node={selectedNode} />
        <div className="run-settings"><div className="panel-header"><span>Run settings</span><small>Virtual time</small></div><Field label="Duration (seconds)" value={scenario.simulation.durationSeconds} min={1} onChange={(durationSeconds) => updateSimulation({ durationSeconds })} /><label className="field"><span>Random seed</span><input value={scenario.seed} onChange={(event) => updateMeta({ seed: event.target.value })} /></label></div>
      </aside>

      <section className="results"><div className="results-header"><div><span>Simulation output</span>{result ? <small>seed: {result.seed} · computed in {result.wallClockDurationMs} ms</small> : null}</div></div><ResultsPanel result={result} /></section>
    </main>
  )
}

export function Workbench() { return <ReactFlowProvider><WorkbenchInner /></ReactFlowProvider> }
