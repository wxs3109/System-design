'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Background, BackgroundVariant, ControlButton, Controls, MiniMap, Panel, ReactFlow, ReactFlowProvider, ViewportPortal, useReactFlow, type OnConnect } from '@xyflow/react'
import { builtInComponentTypes, componentCatalog, componentPresetRegistry, componentRegistry, policyRegistry, type BehaviorVariantManifest, type ComponentCategoryManifest, type ComponentPresetManifest, type ConfigField } from '@system-design/components'
import { createEmptyProject, getActiveExperiment, parseProjectFile, type ComponentType, type PolicyAttachment, type ProjectConnection, type SimulationProgress, type SimulationResult } from '@system-design/model'
import { SimulationWorkerClient } from '@system-design/simulation/client'
import { validateScenarioForSimulation } from '@system-design/simulation'
import { Activity, ArrowDown, ArrowUp, Blocks, Braces, ChevronDown, CircleAlert, ClipboardPaste, Copy, DatabaseZap, Download, FlaskConical, History, Languages, Layers3, LayoutDashboard, ListChecks, Maximize2, Minus, Moon, MousePointer2, PanelBottom, PanelRight, Play, Plus, Redo2, RotateCcw, Save, Settings2, Square, Sun, Trash2, Undo2, Upload, X } from 'lucide-react'
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
import { DefinitionEditor, DefinitionsExplorer, useSelectedDefinitionBindings } from './definition-editor'
import type { DefinitionSelection } from './definition-editor-model'
import { FormatDialog } from './format-dialog'
import { TopologyGroupOverlay } from './topology-group-overlay'
import { SimulationCanvasOverlay } from './simulation-canvas-overlay'
import { ArchitectureReviewPanel } from './architecture-review-panel'
import { createAsyncExample, createCollaborativeEditingExample, createDataPlatformExample, createDirectExample, createGlobalStorefrontExample, createIncidentFanOutExample, createJobSchedulerExample, createLogSearchExample, createMultiRegionFailoverExample, createOrderEventFanOutExample, createOrderFulfillmentWorkflowExample, createOrderSystemExample, createPaymentCheckoutWorkflowExample, createProductSearchExample, createRealtimeChatExample, createVideoDeliveryExample } from '@/lib/examples'
import { getLocalHistoryRepository, type ProjectRevisionRecord, type SimulationRunRecord } from '@/lib/local-history'
import { projectToEdges, projectToNodes, redoProject, undoProject, useCanRedo, useCanUndo, useWorkbenchStore, type ProjectNode } from '@/lib/store'
import { localizedValue, useI18n, type Translate } from '@/lib/i18n'
import { layoutTopology } from '@/lib/canvas-layout'
import { buildCanvasMetricProjection, formatCanvasBytes, formatCanvasCount } from '@/lib/canvas-metrics'
import { reviewArchitecture, type ArchitectureFinding } from '@/lib/architecture-review'

const nodeTypes = { component: ComponentNode }
const orderedTypes = builtInComponentTypes
type PanelName = 'faults' | 'inspector' | 'results'
type PanelVisibility = Record<PanelName, boolean>
const panelVisibilityStorageKey = 'system-design-panel-visibility'
const defaultPanelVisibility: PanelVisibility = { faults: true, inspector: true, results: true }
const examples = [
  ['Order system', 'APIs → Cache → Relational data → Events', createOrderSystemExample],
  ['Job scheduler', 'Schedule / recur / run now → due scan → Queue → Workers', createJobSchedulerExample],
  ['Video delivery', 'Upload → Transcode → Metadata · Playback → CDN streaming', createVideoDeliveryExample],
  ['Product search', 'Queries + catalog updates → sharded Search Index', createProductSearchExample],
  ['Log search', 'Streaming ingest + investigations → Search Index', createLogSearchExample],
  ['Order event fan-out', 'Orders → Topic → independent fulfillment / email subscriptions', createOrderEventFanOutExample],
  ['Incident fan-out', 'Alerts → Topic → independent subscribers + retention expiry', createIncidentFanOutExample],
  ['Realtime chat', 'Long-lived clients → rooms → broadcast + slow-client backpressure', createRealtimeChatExample],
  ['Collaborative editing', 'Editors → document channels → operation broadcast + disconnect', createCollaborativeEditingExample],
  ['Payment checkout', 'Checkout → durable steps → idempotent completion', createPaymentCheckoutWorkflowExample],
  ['Order fulfillment', 'Allocation → retry exhaustion → reverse compensation', createOrderFulfillmentWorkflowExample],
  ['Global storefront', 'Regional shoppers → geo routing → regional catalogs', createGlobalStorefrontExample],
  ['Multi-region failover', 'Cached primary route → outage → delayed standby failover', createMultiRegionFailoverExample],
  ['Direct service', 'Traffic → Network → Service → DB', createDirectExample],
  ['Async pipeline', 'Traffic → API → Queue → Worker → DB', createAsyncExample],
  ['Data platform', 'Cache → Shards → Stream → Objects', createDataPlatformExample],
] as const
interface CanvasContextMenu {
  kind: 'node' | 'pane'
  x: number
  y: number
  position: { x: number; y: number }
  nodeId?: string
}

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

interface CatalogSelection { categoryId: string; type: ComponentType; preset?: { id: string; version: number } }

function VariantChoice({ category, variant, onAdd }: { category: ComponentCategoryManifest; variant: BehaviorVariantManifest; onAdd: (selection: CatalogSelection) => void }) {
  const { t } = useI18n()
  const presets = componentCatalog.listPresets(variant.type, variant.version)
  const Icon = componentIcons[variant.iconToken] ?? componentIcons[category.iconToken]!
  const setDragData = (event: React.DragEvent, preset?: ComponentPresetManifest) => {
    event.dataTransfer.setData('application/system-design-catalog', JSON.stringify({ categoryId: category.id, type: variant.type, ...(preset ? { preset: { id: preset.id, version: preset.version } } : {}) }))
    event.dataTransfer.effectAllowed = 'move'
  }
  return (
    <div className="variant-choice">
      <button type="button" className="palette-item palette-item--variant" draggable onClick={() => onAdd({ categoryId: category.id, type: variant.type as ComponentType })} onDragStart={setDragData}
        style={{ '--node-color': variant.color } as React.CSSProperties} title={t(`description.${variant.type}`, {}, variant.description)}>
        <span><Icon size={17} aria-hidden="true" /></span>
        <span><strong>{t(`component.${variant.type}`, {}, variant.label)}</strong><small>{t(`description.${variant.type}`, {}, variant.description)}</small></span>
        <Plus size={15} aria-hidden="true" />
      </button>
      {presets.length > 0 ? <div className="variant-presets" aria-label={t('{name} presets', { name: t(`component.${variant.type}`, {}, variant.label) })}>
        <span>{t('Templates')}</span>
        {presets.map((preset) => <button key={preset.id + '@' + preset.version} type="button" draggable title={t(`preset-description.${preset.id}`, {}, preset.description)}
          onClick={() => onAdd({ categoryId: category.id, type: variant.type as ComponentType, preset: { id: preset.id, version: preset.version } })}
          onDragStart={(event) => setDragData(event, preset)}>{t(`preset.${preset.label}`, {}, preset.label)}</button>)}
      </div> : null}
    </div>
  )
}

function CategoryItem({ category, expanded, onToggle, onAdd }: { category: ComponentCategoryManifest; expanded: boolean; onToggle: () => void; onAdd: (selection: CatalogSelection) => void }) {
  const { t } = useI18n()
  const variants = componentCatalog.listVariants(category.id)
  const Icon = componentIcons[category.iconToken]!
  if (variants.length === 1) {
    const variant = variants[0]!
    const presets = componentCatalog.listPresets(variant.type, variant.version)
    const VariantIcon = componentIcons[variant.iconToken] ?? Icon
    const variantLabel = t(`component.${variant.type}`, {}, variant.label)
    const description = t(`description.${variant.type}`, {}, variant.description)
    const setDragData = (event: React.DragEvent, preset?: ComponentPresetManifest) => {
      event.dataTransfer.setData('application/system-design-catalog', JSON.stringify({ categoryId: category.id, type: variant.type, ...(preset ? { preset: { id: preset.id, version: preset.version } } : {}) }))
      event.dataTransfer.effectAllowed = 'move'
    }
    return (
      <section className="palette-category" style={{ '--node-color': category.color } as React.CSSProperties}>
        <button type="button" className="category-toggle category-toggle--single" draggable aria-label={`${variantLabel} ${description}`} title={description}
          onClick={() => onAdd({ categoryId: category.id, type: variant.type as ComponentType })} onDragStart={setDragData}>
          <span><VariantIcon size={17} aria-hidden="true" /></span><span><strong>{t(`category.${category.id}`, {}, category.label)}</strong><small>{t('{count} variant', { count: 1 })}</small></span><Plus size={15} aria-hidden="true" />
        </button>
        {presets.length > 0 ? <div className="variant-presets variant-presets--single" aria-label={t('{name} presets', { name: variantLabel })}>
          <span>{t('Templates')}</span>
          {presets.map((preset) => <button key={preset.id + '@' + preset.version} type="button" draggable title={t(`preset-description.${preset.id}`, {}, preset.description)}
            onClick={() => onAdd({ categoryId: category.id, type: variant.type as ComponentType, preset: { id: preset.id, version: preset.version } })}
            onDragStart={(event) => setDragData(event, preset)}>{t(`preset.${preset.label}`, {}, preset.label)}</button>)}
        </div> : null}
      </section>
    )
  }
  return (
    <section className="palette-category" style={{ '--node-color': category.color } as React.CSSProperties}>
      <button type="button" className="category-toggle" aria-expanded={expanded} aria-controls={'category-' + category.id} onClick={onToggle}>
        <span><Icon size={17} aria-hidden="true" /></span><span><strong>{t(`category.${category.id}`, {}, category.label)}</strong><small>{t(variants.length === 1 ? '{count} variant' : '{count} variants', { count: variants.length })}</small></span><ChevronDown size={15} />
      </button>
      {expanded ? <div id={'category-' + category.id} className="category-variants">{variants.map((variant) => <VariantChoice key={variant.type + '@' + variant.version} category={category} variant={variant} onAdd={onAdd} />)}</div> : null}
    </section>
  )
}

function ConfigFieldControl({ field, value, onChange }: { field: ConfigField; value: unknown; onChange: (value: number | string) => void }) {
  const { t } = useI18n()
  const label = t(field.label)
  if (field.kind === 'number') return <Field label={label} value={Number(value)} {...(field.min === undefined ? {} : { min: field.min })} {...(field.max === undefined ? {} : { max: field.max })} {...(field.step === undefined ? {} : { step: field.step })} onChange={onChange} />
  if (field.kind === 'select') return <label className="field"><span>{label}</span><select value={String(value)} onChange={(event) => onChange(event.target.value)}>{field.options.map((option) => <option key={option.value} value={option.value}>{localizedValue(t, option.value, option.label)}</option>)}</select></label>
  return <label className="field"><span>{label}</span><input value={String(value)} onChange={(event) => onChange(event.target.value)} /></label>
}

function PolicyEditor({ policy, index, count }: { policy: PolicyAttachment; index: number; count: number }) {
  const { t } = useI18n()
  const updatePolicy = useWorkbenchStore((state) => state.updatePolicy)
  const movePolicy = useWorkbenchStore((state) => state.movePolicy)
  const deletePolicy = useWorkbenchStore((state) => state.deletePolicy)
  const manifest = policyRegistry.get(policy.type, policy.version)
  const policyLabel = t(`policy.${manifest.type}`, {}, manifest.label)
  return (
    <section className="policy-editor" aria-label={`${policyLabel} ${t('policy')}`}>
      <div className="policy-editor__heading">
        <label className="policy-toggle"><input type="checkbox" checked={policy.enabled} onChange={(event) => updatePolicy(policy.id, { enabled: event.target.checked })} /><span>{policyLabel}</span></label>
        <div className="policy-actions">
          <button type="button" onClick={() => movePolicy(policy.id, -1)} disabled={index === 0} aria-label={t('Move {name} earlier', { name: policyLabel })}><ArrowUp size={13} /></button>
          <button type="button" onClick={() => movePolicy(policy.id, 1)} disabled={index === count - 1} aria-label={t('Move {name} later', { name: policyLabel })}><ArrowDown size={13} /></button>
          <button type="button" className="danger" onClick={() => deletePolicy(policy.id)} aria-label={t('Remove {name}', { name: policyLabel })}><Trash2 size={13} /></button>
        </div>
      </div>
      <p>{t(`policy-description.${manifest.type}`, {}, manifest.description)}</p>
      <div className={policy.enabled ? 'policy-fields' : 'policy-fields is-disabled'}>
        {manifest.configFields.map((field) => <ConfigFieldControl key={field.key} field={field} value={policy.config[field.key]} onChange={(value) => updatePolicy(policy.id, { config: { [field.key]: value } })} />)}
      </div>
    </section>
  )
}

function PolicySection({ target, supportedTypes }: { target: PolicyAttachment['target']; supportedTypes?: readonly string[] }) {
  const { t } = useI18n()
  const allPolicies = useWorkbenchStore((state) => state.project.topology.policies)
  const policies = useMemo(() => allPolicies
    .filter((policy) => policy.target.kind === target.kind && policy.target.id === target.id)
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id)), [allPolicies, target.id, target.kind])
  const attachPolicy = useWorkbenchStore((state) => state.attachPolicy)
  const manifests = policyRegistry.list().filter((manifest) => manifest.targets.includes(target.kind) && (supportedTypes === undefined || supportedTypes.includes(manifest.type)))
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
      <div className="policy-section__heading"><span>{t('Reliability policies')}</span><small>{policies.length ? t('{count} attached · evaluated top to bottom', { count: policies.length }) : t('No policies attached')}</small></div>
      {policies.map((policy, index) => <PolicyEditor key={policy.id} policy={policy} index={index} count={policies.length} />)}
      <div className="policy-add">
        <label className="field"><span>{t('Add policy')}</span><select aria-label={t('Policy for selected {kind}', { kind: t(`target.${target.kind}`, {}, target.kind) })} value={selection} disabled={available.length === 0} onChange={(event) => setSelection(event.target.value)}><option value="">{t(available.length ? 'Choose a policy…' : manifests.length ? 'All supported policies attached' : 'No supported policies')}</option>{available.map((manifest) => <option key={`${manifest.type}@${manifest.version}`} value={`${manifest.type}@${manifest.version}`}>{t(`policy.${manifest.type}`, {}, manifest.label)}</option>)}</select></label>
        <button type="button" className="button" disabled={!selection || available.length === 0} onClick={add}><Plus size={14} /> {t('Add')}</button>
      </div>
    </div>
  )
}

function RegionSection() {
  const { t } = useI18n()
  const project = useWorkbenchStore((state) => state.project)
  const addRegion = useWorkbenchStore((state) => state.addRegion)
  const updateRegion = useWorkbenchStore((state) => state.updateRegion)
  const deleteRegion = useWorkbenchStore((state) => state.deleteRegion)
  const regions = project.topology.groups.filter((group) => group.kind === 'region' || group.kind === 'zone')
  return (
    <section className="region-section" aria-label={t('Regions and zones')}>
      <div className="policy-section__heading"><span>{t('Regions / zones')}</span><small>{t('Define routing locality and outage boundaries')}</small></div>
      {regions.map((region) => <div className="region-editor" key={region.id}>
        <label className="field"><span>{t('Region / zone name')}</span><input value={region.name} onChange={(event) => updateRegion(region.id, { name: event.target.value })} /></label>
        <label className="field"><span>{t('Kind')}</span><select value={region.kind} onChange={(event) => updateRegion(region.id, { kind: event.target.value as 'region' | 'zone' })}><option value="region">{t('Region')}</option><option value="zone">{t('Availability zone')}</option></select></label>
        <div className="region-members">{project.topology.nodes.map((node) => <label key={node.id} className="policy-toggle"><input type="checkbox" checked={region.nodeIds.includes(node.id)} onChange={(event) => updateRegion(region.id, { nodeIds: event.target.checked ? [...region.nodeIds, node.id] : region.nodeIds.filter((id) => id !== node.id) })} /><span>{node.name}</span></label>)}</div>
        <button type="button" className="icon-button danger" aria-label={t('Delete {name}', { name: region.name })} onClick={() => deleteRegion(region.id)}><Trash2 size={14} /></button>
      </div>)}
      <div className="region-actions"><button type="button" className="button" onClick={() => addRegion('region')}><Plus size={14} /> {t('Add region')}</button><button type="button" className="button" onClick={() => addRegion('zone')}><Plus size={14} /> {t('Add zone')}</button></div>
    </section>
  )
}

function PropertiesPanel({ node, edge }: { node: ProjectNode | undefined; edge: ProjectConnection | undefined }) {
  const { t } = useI18n()
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
        <div className="section-heading"><div><span>{t('Selected connection')}</span><strong>{edge.sourceSemantic} → {edge.targetSemantic}</strong></div><button type="button" className="icon-button danger" onClick={deleteEdge} aria-label={t('Delete selected connection')}><Trash2 size={16} /></button></div>
        <label className="field"><span>{t('Connection name')}</span><input value={edge.name ?? ''} placeholder={t('Optional canvas label')} onChange={(event) => updateEdge({ name: event.target.value.trim() ? event.target.value : undefined })} /></label>
        <label className="field"><span>{t('Routing mode')}</span><select value={edge.routingMode} disabled={asynchronous} onChange={(event) => updateEdge({ routingMode: event.target.value as 'weighted-one' | 'fan-out' })}>{asynchronous ? <option value="async-publish">{t('Async publish')}</option> : <><option value="weighted-one">{t('Weighted one-of')}</option><option value="fan-out">{t('Fan-out')}</option></>}</select></label>
        {edge.routingMode === 'weighted-one' ? <Field label={t('Routing weight')} value={edge.weight} min={0.001} step={0.1} onChange={(weight) => updateEdge({ weight })} /> : null}
        <p className="property-help">{t('Routing is applied to every connection from the same output port.')}</p>
        <PolicySection key={`edge:${edge.id}`} target={{ kind: 'edge', id: edge.id }} />
      </div>
    )
  }
  if (!node) {
    return <div className="empty-properties"><MousePointer2 size={22} /><p>{t('Select a component to configure its runtime behavior.')}</p></div>
  }
  const manifest = componentRegistry.get(node.type, node.componentVersion)
  const preset = node.rolePreset ? componentPresetRegistry.find(node.rolePreset.id, node.rolePreset.version) : undefined
  const setConfig = (key: string, value: number | string) => updateNode({ config: { [key]: value } })
  return (
    <div className="properties-form">
      <div className="section-heading"><div><span>{t('Selected component')}</span><strong>{t(`component.${node.type}`, {}, manifest.label)}</strong></div><button type="button" className="icon-button danger" onClick={deleteNode} aria-label={t('Delete selected component')}><Trash2 size={16} /></button></div>
      {preset ? <p className="preset-disclosure">{t('{preset} is a configuration template for the {variant} variant. Execution uses the resolved variant and stored values.', { preset: t(`preset.${preset.label}`, {}, preset.label), variant: t(`component.${node.type}`, {}, manifest.label) })}</p> : null}
      <label className="field"><span>{t('Name')}</span><input value={node.name} onChange={(event) => updateNode({ name: event.target.value })} /></label>
      {node.type === 'traffic' && workload ? <>
        <Field label={t('Requests / second')} value={workload.requestsPerSecond} min={0.1} step={10} onChange={(value) => updateWorkload({ requestsPerSecond: value })} />
        <label className="field"><span>{t('Arrival pattern')}</span><select value={workload.pattern} onChange={(event) => updateWorkload({ pattern: event.target.value as 'constant' | 'poisson' })}><option value="poisson">{t('Poisson')}</option><option value="constant">{t('Constant')}</option></select></label>
      </> : null}
      {manifest.configFields.map((field) => <ConfigFieldControl key={field.key} field={field} value={(node.config as Record<string, unknown>)[field.key]} onChange={(value) => setConfig(field.key, value)} />)}
      <PolicySection key={`node:${node.id}`} target={{ kind: 'node', id: node.id }} supportedTypes={manifest.supportedNodePolicies} />
    </div>
  )
}

const runtimeFaultReasons = new Set(['node_down', 'packet_loss', 'latency_spike', 'region_outage', 'capacity_reduced', 'bandwidth_reduced', 'traffic_spike', 'hot_key'])
const humanizeReason = (reason: string) => reason.replaceAll('_', ' ')

function FaultTraceEvidence({ result }: { result: SimulationResult }) {
  const { t } = useI18n()
  const lifecycle = result.events.filter((event) => event.type === 'fault-activated' || event.type === 'fault-recovered')
  if (lifecycle.length === 0) return null
  const affectedTraces = result.events.filter((event) => event.type === 'request-failed' && event.traceId && runtimeFaultReasons.has(event.reason))
  return (
    <section className="fault-evidence" aria-label={t('Fault and trace evidence')}>
      <div className="fault-evidence__heading"><strong>{t('Fault & trace evidence')}</strong><span>{t('{activated} activated · {affected} affected request events', { activated: lifecycle.filter((event) => event.type === 'fault-activated').length, affected: affectedTraces.length })}</span></div>
      <div className="fault-evidence__events">{lifecycle.slice(0, 8).map((event) => <span key={event.sequence} className={event.type === 'fault-activated' ? 'is-active' : 'is-recovered'}><b>{event.timestampMs / 1_000}s</b> {t(event.type === 'fault-activated' ? 'started' : 'recovered')} {t(`reason.${event.reason}`, {}, humanizeReason(event.reason))}</span>)}</div>
      {affectedTraces.length > 0 ? <div className="fault-evidence__traces">{affectedTraces.slice(0, 6).map((event) => <span key={event.sequence}><code>{event.traceId}</code><b>{humanizeReason(event.reason)}</b><small>{event.timestampMs / 1_000}s · {event.nodeId ?? event.edgeId ?? 'workload'}</small></span>)}</div> : null}
    </section>
  )
}

function OperationExecutionMetrics({ result }: { result: SimulationResult }) {
  const { t } = useI18n()
  const operations = result.operations ?? []
  const actions = result.actions ?? []
  if (operations.length === 0 && actions.length === 0) return null
  return (
    <section className="operation-execution" aria-label={t('Operation execution metrics')}>
      <div className="operation-execution__heading"><strong>{t('Operation execution')}</strong><span>{t('{operations} operations · {actions} actions', { operations: operations.length, actions: actions.length })}</span></div>
      <div className="operation-execution__tables">
        <div className="operation-execution__table">
          <table><caption>{t('Operation metrics')}</caption><thead><tr><th>{t('Operation')}</th><th>{t('Completed')}</th><th>{t('Failed')}</th><th>P95</th></tr></thead><tbody>{operations.map((operation) => <tr key={operation.operationId}><td><code>{operation.operationId}</code></td><td>{operation.completedRequests.toLocaleString()} / {operation.generatedRequests.toLocaleString()}</td><td>{operation.failedRequests.toLocaleString()}</td><td>{operation.latencyP95Ms.toLocaleString()} ms</td></tr>)}</tbody></table>
        </div>
        <div className="operation-execution__table">
          <table><caption>{t('Action metrics')}</caption><thead><tr><th>{t('Action')}</th><th>{t('Kind')}</th><th>{t('Completed')}</th><th>{t('Failed')}</th><th>{t('Avg.')}</th><th>{t('Records')}</th><th>{t('Bytes')}</th><th>{t('Why')}</th></tr></thead><tbody>{actions.map((action) => { const searchDetails = action.details?.searchFanOut === undefined ? '' : ` · ${t('fan-out')} ${action.details.searchFanOut} · ${t('candidates')} ${action.details.searchCandidates ?? 0} · ${t('results')} ${action.details.searchResultCount ?? 0}${action.details.searchStale ? ` · ${t('stale')} ${action.details.searchVisibilityLagMs ?? 0} ms` : ''}`; const realtimeDetails = action.details?.realtimeFanOut === undefined ? '' : ` · ${action.details.realtimeFanOut} ${t('connection fan-out')}${action.details.realtimeChannelId ? ` · ${action.details.realtimeChannelId}` : ''}`; const workflowDetails = action.details?.workflowStatus === undefined ? '' : ` · ${t('workflow')} ${t(`value.${String(action.details.workflowStatus)}`, {}, String(action.details.workflowStatus))}${action.details.workflowIdempotencyReplay ? ` · ${t('idempotency replay')}` : ''}`; return <tr key={`${action.operationId}:${action.actionId}`}><td><code>{action.actionId}</code></td><td>{t(`value.${action.actionKind}`, {}, action.actionKind)}</td><td>{action.completed.toLocaleString()}</td><td>{action.failed.toLocaleString()}</td><td>{action.averageDurationMs.toLocaleString()} ms</td><td>{action.recordsExamined.toLocaleString()}</td><td>{action.bytesProcessed.toLocaleString()}</td><td>{action.explanation ? t(action.explanation) : '—'}{searchDetails}{realtimeDetails}{workflowDetails}</td></tr> })}</tbody></table>
        </div>
      </div>
    </section>
  )
}

function ResultsPanel({ result, progress, running, nodes, onShowTraceNode, theme }: { result: SimulationResult | null; progress: SimulationProgress | null; running: boolean; nodes: Array<{ id: string; name: string }>; onShowTraceNode: (nodeId: string) => void; theme?: string | undefined }) {
  const { t } = useI18n()
  const [traceRequest, setTraceRequest] = useState<{ traceId: string; sequence: number } | null>(null)
  if (!result && running) {
    const simulatedTimeMs = progress?.simulatedTimeMs ?? 0
    const simulatedDurationMs = progress?.simulatedDurationMs ?? 1
    const percentage = Math.min(100, Math.round((simulatedTimeMs / simulatedDurationMs) * 100))
    return <div className="results-empty simulation-progress" role="status" aria-live="polite"><FlaskConical size={24} /><strong>{progress ? t('Simulating virtual time · {percentage}%', { percentage }) : t('Starting simulation worker…')}</strong><progress aria-label={t('Simulation progress')} max={simulatedDurationMs} value={simulatedTimeMs} /><p>{progress ? t('{generated} generated · {completed} completed · {failed} failed', { generated: progress.generatedRequests.toLocaleString(), completed: progress.completedRequests.toLocaleString(), failed: progress.failedRequests.toLocaleString() }) : t('Compiling the project and initializing its runtime.')}</p></div>
  }
  if (!result) return <div className="results-empty"><FlaskConical size={24} /><strong>{t('No simulation yet')}</strong><p>{t('Build a connected topology, then run it. Metrics shown here are produced by the simulation worker.')}</p></div>
  return (
    <>
      <div className="metrics-grid">
        <div><span>{t('Throughput')}</span><strong>{result.summary.throughputPerSecond.toLocaleString()}<small> req/s</small></strong></div>
        <div><span>{t('P95 latency')}</span><strong>{result.summary.latencyP95Ms.toLocaleString()}<small> ms</small></strong></div>
        <div><span>{t('Error rate')}</span><strong>{(result.summary.errorRate * 100).toFixed(2)}<small>%</small></strong></div>
        <div><span>{t('Completed')}</span><strong>{result.summary.completedRequests.toLocaleString()}</strong></div>
      </div>
      <div className="chart-block"><div className="block-title"><strong>{t('Throughput over virtual time')}</strong><span>{t('{seconds}s run · shaded fault windows', { seconds: result.simulatedDurationMs / 1_000 })}</span></div><MetricChart points={result.timeSeries} events={result.events} simulatedDurationMs={result.simulatedDurationMs} theme={theme} /></div>
      <div className="node-table-wrap"><table className="node-table"><thead><tr><th>{t('Component')}</th><th>{t('Util.')}</th><th>{t('Avg queue')}</th><th>{t('Max queue')}</th><th>{t('Domain metrics')}</th></tr></thead><tbody>{result.nodes.map((node) => <tr key={node.nodeId}><td><strong>{node.nodeName}</strong><span>{t(`component.${node.nodeType}`, {}, node.nodeType)}</span></td><td>{(node.utilization * 100).toFixed(1)}%</td><td>{node.averageQueueLength.toFixed(1)}</td><td>{node.maxQueueLength}</td><td><span className="domain-metrics">{formatDomainMetrics(node.details, t)}</span></td></tr>)}</tbody></table></div>
      <OperationExecutionMetrics result={result} />
      <FaultTraceEvidence result={result} />
      <BottleneckExplanations result={result} onShowNode={onShowTraceNode} onShowTrace={(traceId) => setTraceRequest((current) => ({ traceId, sequence: (current?.sequence ?? 0) + 1 }))} />
      <TraceExplorer key={`${result.runId}:${traceRequest?.sequence ?? 0}`} result={result} nodes={nodes} onShowOnCanvas={onShowTraceNode} theme={theme} {...(traceRequest ? { requestedTraceId: traceRequest.traceId } : {})} />
      {result.warnings.length ? <div className="warnings"><CircleAlert size={15} /> {result.warnings.join(' ')}</div> : null}
    </>
  )
}

const domainMetricLabels: Record<string, string> = {
  cacheHitRate: 'hit', cdnHitRate: 'CDN hit', cacheOccupancy: 'occupancy', consumerLag: 'lag', partitionImbalance: 'partition skew',
  byteThroughputPerSecond: 'bytes/s', hottestShardShare: 'hot shard', maxReplicaLagMs: 'replica lag',
  cdnOriginFetches: 'origin fetches', popRequestImbalance: 'POP skew', releasedRuns: 'released', skippedRuns: 'skipped', pendingRuns: 'pending',
  searchStaleQueryRate: 'stale queries', searchPendingMutations: 'index backlog', searchReplicaRefreshBacklog: 'replica backlog',
  searchQueries: 'queries', searchShardSearches: 'shard searches', searchCandidatesMerged: 'candidates merged',
  topicFanOutCopies: 'fan-out copies', topicAcknowledged: 'acknowledged', topicExpiredDeliveries: 'expired',
  realtimeActiveConnections: 'active connections', realtimeFanOutCopies: 'broadcast copies', realtimeDroppedCopies: 'dropped copies',
  workflowCompletedInstances: 'completed workflows', workflowCompensatedInstances: 'compensated workflows', workflowStepCheckpoints: 'checkpoints', workflowRetries: 'retries',
  globalRouterCacheHitRate: 'route cache hit', globalRouterGeoMatches: 'geo matches', globalRouterFailovers: 'failovers', globalRouterMaxFailoverDelayMs: 'max failover delay (ms)',
}

function formatDomainMetrics(details: SimulationResult['nodes'][number]['details'], t: Translate) {
  const orderedKeys = Number(details.globalRouterFailovers ?? 0) > 0
    ? ['globalRouterCacheHitRate', 'globalRouterFailovers', 'globalRouterMaxFailoverDelayMs']
    : Object.keys(domainMetricLabels)
  const preferred = orderedKeys.flatMap((key) => key in details ? [[key, details[key]] as const] : []).slice(0, 3)
  if (preferred.length === 0) return '—'
  return preferred.map(([key, value]) => {
    const formatted = typeof value === 'number' && ['cacheHitRate', 'cdnHitRate', 'cacheOccupancy', 'partitionImbalance', 'popRequestImbalance', 'hottestShardShare', 'searchStaleQueryRate', 'globalRouterCacheHitRate'].includes(key)
      ? `${(value * 100).toFixed(1)}%` : typeof value === 'number' ? value.toLocaleString() : String(value)
    return `${t(`domain.${key}`, {}, domainMetricLabels[key])} ${formatted}`
  }).join(' · ')
}

function WorkbenchInner() {
  const { resolvedTheme, setTheme } = useTheme()
  const { locale, setLocale, t } = useI18n()
  const project = useWorkbenchStore((state) => state.project)
  const experiment = getActiveExperiment(project)
  const selectedNodeId = useWorkbenchStore((state) => state.selectedNodeId)
  const selectedEdgeId = useWorkbenchStore((state) => state.selectedEdgeId)
  const selectedFaultId = useWorkbenchStore((state) => state.selectedFaultId)
  const result = useWorkbenchStore((state) => state.result)
  const running = useWorkbenchStore((state) => state.running)
  const error = useWorkbenchStore((state) => state.error)
  const { setProject, restoreProject, addCatalogComponent, pasteComponent, applyNodeLayout, onNodesChange, onEdgesChange, connect, selectNode, selectEdge, selectFault, addFault, updateFault, deleteFault, deleteSelectedNode, updateSimulation, updateMeta, setRunning, setResult, setError } = useWorkbenchStore()
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
  const [contextMenu, setContextMenu] = useState<CanvasContextMenu | null>(null)
  const [clipboardNode, setClipboardNode] = useState<ProjectNode | null>(null)
  const [revisions, setRevisions] = useState<ProjectRevisionRecord[]>([])
  const [runs, setRuns] = useState<SimulationRunRecord[]>([])
  const [historyReady, setHistoryReady] = useState(false)
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null)
  const [progress, setProgress] = useState<SimulationProgress | null>(null)
  const [resultsView, setResultsView] = useState<'run' | 'compare'>('run')
  const [workspaceView, setWorkspaceView] = useState<'topology' | 'definitions'>('topology')
  const [selectedDefinition, setSelectedDefinition] = useState<DefinitionSelection | null>(null)
  const [formatDialog, setFormatDialog] = useState<'openapi' | 'dbml' | null>(null)
  const [themeReady, setThemeReady] = useState(false)
  const [layoutBusy, setLayoutBusy] = useState(false)
  const [canvasMetricsVisible, setCanvasMetricsVisible] = useState(true)
  const [architectureReviewOpen, setArchitectureReviewOpen] = useState(false)
  const runTabRef = useRef<HTMLButtonElement>(null)
  const compareTabRef = useRef<HTMLButtonElement>(null)
  const faultsPanelRef = useRef<ImperativePanelHandle>(null)
  const inspectorPanelRef = useRef<ImperativePanelHandle>(null)
  const resultsPanelRef = useRef<ImperativePanelHandle>(null)
  const [panelVisibility, setPanelVisibility] = useState(defaultPanelVisibility)
  const definitionBindings = useSelectedDefinitionBindings(workspaceView === 'definitions' ? selectedDefinition : null)
  const hasDefinitionPath = definitionBindings.edgeIds.size > 0
  const canvasMetrics = useMemo(() => result ? buildCanvasMetricProjection(result) : null, [result])
  const architectureFindings = useMemo(() => reviewArchitecture(project), [project])
  const showCanvasMetrics = workspaceView === 'topology' && canvasMetricsVisible && canvasMetrics !== null
  const topologyNodes = project.topology.nodes
  const nodes = useMemo(() => projectToNodes(topologyNodes).map((node) => {
    const metric = showCanvasMetrics ? canvasMetrics.nodes.get(node.id) : undefined
    const classes = [affected.nodes.has(node.id) ? 'is-fault-target' : '', definitionBindings.nodeIds.has(node.id) ? 'is-definition-binding' : '', hasDefinitionPath && !definitionBindings.nodeIds.has(node.id) ? 'is-definition-dimmed' : '', metric ? `is-simulation-${metric.severity}` : ''].filter(Boolean).join(' ')
    return { ...node, selected: node.id === selectedNodeId || affected.nodes.has(node.id), ...(classes ? { className: classes } : {}) }
  }), [affected.nodes, canvasMetrics, definitionBindings.nodeIds, hasDefinitionPath, showCanvasMetrics, topologyNodes, selectedNodeId])
  const edgeProjectionLabels = useMemo(() => {
    const labels = new Map(definitionBindings.edgeLabels)
    if (showCanvasMetrics) canvasMetrics.edges.forEach((metric, edgeId) => {
      const observed = `${t('observed')} ${formatCanvasCount(metric.observedCalls)}${metric.observedFailures > 0 ? ` · ${t('failed')} ${formatCanvasCount(metric.observedFailures)}` : ''}${metric.observedBytes > 0 ? ` · ${formatCanvasBytes(metric.observedBytes)}` : ''}`
      labels.set(edgeId, labels.has(edgeId) ? `${labels.get(edgeId)} / ${observed}` : observed)
    })
    return labels
  }, [canvasMetrics, definitionBindings.edgeLabels, showCanvasMetrics, t])
  const edges = useMemo(() => projectToEdges(project, edgeProjectionLabels).map((edge) => {
    const definitionEdge = definitionBindings.edgeIds.has(edge.id)
    const metric = showCanvasMetrics ? canvasMetrics.edges.get(edge.id) : undefined
    const classes = [affected.edges.has(edge.id) ? 'is-fault-target' : '', definitionEdge ? 'is-definition-binding' : '', hasDefinitionPath && !definitionEdge ? 'is-definition-dimmed' : '', metric ? `is-simulation-${metric.severity}` : ''].filter(Boolean).join(' ')
    return { ...edge, selected: edge.id === selectedEdgeId || affected.edges.has(edge.id), ...(classes ? { className: classes } : {}) }
  }), [affected.edges, canvasMetrics, definitionBindings.edgeIds, edgeProjectionLabels, hasDefinitionPath, project, selectedEdgeId, showCanvasMetrics])

  const refreshHistory = useCallback(async (projectId: string) => {
    const repository = getLocalHistoryRepository()
    const [savedRevisions, savedRuns] = await Promise.all([repository.listProjectRevisions(projectId), repository.listSimulationRuns(projectId)])
    setRevisions(savedRevisions)
    setRuns(savedRuns)
  }, [])

  useEffect(() => {
    // next-themes resolves the persisted/system theme only in the browser. Keep the hydration render identical to SSR.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setThemeReady(true)
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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setContextMenu(null)
      if (!(event.ctrlKey || event.metaKey) || event.altKey || running) return
      const key = event.key.toLowerCase()
      if (key === 'z' && event.shiftKey && canRedo) { event.preventDefault(); redoProject() }
      else if (key === 'z' && canUndo) { event.preventDefault(); undoProject() }
      else if (key === 'y' && canRedo) { event.preventDefault(); redoProject() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [canRedo, canUndo, running])

  const addCatalogAtCenter = useCallback((selection: CatalogSelection) => {
    const viewport = reactFlow.getViewport()
    const element = document.querySelector('.canvas-stage')
    const rect = element?.getBoundingClientRect()
    const position = rect ? reactFlow.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }) : { x: (400 - viewport.x) / viewport.zoom, y: (240 - viewport.y) / viewport.zoom }
    addCatalogComponent(selection.categoryId, selection.type, position, selection.preset)
  }, [addCatalogComponent, reactFlow])

  const autoLayout = useCallback(async () => {
    if (project.topology.nodes.length === 0 || layoutBusy) return
    setLayoutBusy(true)
    try {
      applyNodeLayout(await layoutTopology(project))
      window.requestAnimationFrame(() => void reactFlow.fitView({ duration: 350, padding: 0.15 }))
    } catch (cause) {
      setError(cause instanceof Error ? `Automatic layout failed: ${cause.message}` : 'Automatic layout failed.')
    } finally {
      setLayoutBusy(false)
    }
  }, [applyNodeLayout, layoutBusy, project, reactFlow, setError])

  const onConnect: OnConnect = useCallback((connection) => connect(connection), [connect])
  const onDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    const catalogReference = event.dataTransfer.getData('application/system-design-catalog')
    const position = reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY })
    if (!catalogReference) return
    try {
      const selection = JSON.parse(catalogReference) as CatalogSelection
      if (orderedTypes.includes(selection.type)) addCatalogComponent(selection.categoryId, selection.type, position, selection.preset)
    } catch { setError('Invalid component selection.') }
  }, [addCatalogComponent, reactFlow, setError])

  const showTraceNode = useCallback((nodeId: string) => {
    const node = project.topology.nodes.find((candidate) => candidate.id === nodeId)
    if (!node) return
    selectNode(nodeId)
    reactFlow.setCenter(node.position.x + 99, node.position.y + 38, { zoom: 1.25, duration: 350 })
  }, [project.topology.nodes, reactFlow, selectNode])

  const showArchitectureFinding = useCallback((finding: ArchitectureFinding) => {
    if (finding.target.kind === 'node') {
      const node = project.topology.nodes.find((candidate) => candidate.id === finding.target.id)
      if (!node) return
      selectNode(node.id)
      reactFlow.setCenter(node.position.x + 99, node.position.y + 38, { zoom: 1.25, duration: 350 })
      return
    }
    const edge = project.topology.edges.find((candidate) => candidate.id === finding.target.id)
    if (!edge) return
    const source = project.topology.nodes.find((node) => node.id === edge.source)
    const target = project.topology.nodes.find((node) => node.id === edge.target)
    selectEdge(edge.id)
    if (source && target) reactFlow.setCenter((source.position.x + target.position.x) / 2 + 99, (source.position.y + target.position.y) / 2 + 38, { zoom: 1.1, duration: 350 })
  }, [project.topology.edges, project.topology.nodes, reactFlow, selectEdge, selectNode])

  const run = async () => {
    setRunning(true); setError(null); setResult(null); setProgress(null)
    try {
      const projectSnapshot = componentRegistry.validateProject(structuredClone(project), componentPresetRegistry)
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
  const contextPosition = (event: React.MouseEvent) => ({
    x: Math.min(event.clientX, window.innerWidth - 210),
    y: Math.min(event.clientY, window.innerHeight - 230),
  })
  const openNodeContextMenu = (event: React.MouseEvent, node: ReturnType<typeof projectToNodes>[number]) => {
    event.preventDefault()
    selectNode(node.id)
    setContextMenu({ kind: 'node', nodeId: node.id, position: { x: node.position.x + 32, y: node.position.y + 32 }, ...contextPosition(event) })
  }
  const openPaneContextMenu = (event: React.MouseEvent | MouseEvent) => {
    event.preventDefault()
    setContextMenu({ kind: 'pane', position: reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY }), ...contextPosition(event as React.MouseEvent) })
  }
  const closeContextMenu = () => setContextMenu(null)
  const copyContextNode = () => {
    if (contextMenu?.nodeId) {
      const node = project.topology.nodes.find((candidate) => candidate.id === contextMenu.nodeId)
      if (node) setClipboardNode(structuredClone(node))
    }
    closeContextMenu()
  }
  const pasteClipboardNode = () => {
    if (!contextMenu || !clipboardNode) return
    pasteComponent(clipboardNode, contextMenu.position, locale === 'zh-CN' ? `${clipboardNode.name} 副本` : `${clipboardNode.name} copy`)
    closeContextMenu()
  }
  const duplicateContextNode = () => {
    if (!contextMenu?.nodeId) return
    const node = project.topology.nodes.find((candidate) => candidate.id === contextMenu.nodeId)
    if (node) pasteComponent(node, contextMenu.position, locale === 'zh-CN' ? `${node.name} 副本` : `${node.name} copy`)
    closeContextMenu()
  }
  const openContextProperties = () => {
    if (contextMenu?.nodeId) selectNode(contextMenu.nodeId)
    setWorkspaceView('topology')
    setPanelVisible('inspector', inspectorPanelRef, true)
    closeContextMenu()
  }
  const deleteContextNode = () => {
    if (contextMenu?.nodeId) {
      selectNode(contextMenu.nodeId)
      deleteSelectedNode()
    }
    closeContextMenu()
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
      const imported = componentRegistry.validateProject(parseProjectFile(JSON.parse(await file.text())), componentPresetRegistry)
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

  const componentPalette = (
      <aside className="palette">
        <div className="panel-header"><span>{t('Components')}</span><small>{t('Choose category → variant')}</small></div>
        <div className="palette-list">{componentCatalog.listCategories().map((category) => <CategoryItem key={category.id} category={category} expanded={expandedCategory === category.id}
          onToggle={() => setExpandedCategory((current) => current === category.id ? null : category.id)} onAdd={addCatalogAtCenter} />)}</div>
        <div className="palette-help"><strong>{t('Executable building blocks')}</strong><p>{t('Choose a category, then an implemented behavior variant. Templates only provide starting values.')}</p></div>
      </aside>
  )
  const palettePanel = workspaceView === 'definitions'
    ? <DefinitionsExplorer project={project} selection={selectedDefinition} onSelect={(selection) => { setSelectedDefinition(selection); if (!panelVisibility.inspector) setPanelVisible('inspector', inspectorPanelRef, true) }} onError={setError} />
    : componentPalette

  const canvasPanel = (
      <section className="canvas-stage" onDrop={onDrop} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move' }}>
        <ReactFlow className={workspaceView === 'definitions' ? 'is-definitions-mode' : ''}
          nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
          onConnect={onConnect} onNodeClick={(_, node) => { closeContextMenu(); selectNode(node.id) }} onNodeContextMenu={openNodeContextMenu} onEdgeClick={(_, edge) => { closeContextMenu(); selectEdge(edge.id) }} onPaneClick={() => { closeContextMenu(); selectNode(null); selectEdge(null); selectFault(null) }} onPaneContextMenu={openPaneContextMenu} onMoveStart={closeContextMenu}
          deleteKeyCode={["Backspace", "Delete"]} fitView minZoom={0.2} maxZoom={2}
          defaultEdgeOptions={{ type: 'smoothstep', animated: true }} proOptions={{ hideAttribution: false }}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="var(--canvas-dot)" />
          <ViewportPortal><TopologyGroupOverlay project={project} /></ViewportPortal>
          {showCanvasMetrics ? <ViewportPortal><SimulationCanvasOverlay project={project} metrics={canvasMetrics} t={t} /></ViewportPortal> : null}
          <Controls position="bottom-left" showZoom={false} showFitView={false} showInteractive={false} aria-label={t('Canvas controls')}>
            <ControlButton onClick={() => reactFlow.zoomIn()} aria-label={t('Zoom in')} title={t('Zoom in')}><Plus size={14} /></ControlButton>
            <ControlButton onClick={() => reactFlow.zoomOut()} aria-label={t('Zoom out')} title={t('Zoom out')}><Minus size={14} /></ControlButton>
            <ControlButton onClick={() => reactFlow.fitView()} aria-label={t('Fit view')} title={t('Fit view')}><Maximize2 size={14} /></ControlButton>
          </Controls>
          <MiniMap ariaLabel={t('Topology mini map')} pannable zoomable position="bottom-right" nodeColor={(node) => componentRegistry.get((node.data as ProjectNode).type, (node.data as ProjectNode).componentVersion).color} />
          {project.topology.nodes.length === 0 ? <Panel position="top-center"><div className="canvas-empty"><span><Plus size={20} /></span><strong>{t('Start with an empty canvas')}</strong><p>{t('Drag any component here, connect it, configure load, then run the model.')}</p></div></Panel> : null}
          {workspaceView === 'definitions' && !architectureReviewOpen ? <Panel position="top-right"><div className="definition-overlay-legend"><Blocks size={13} /><span>{definitionBindings.resource ? <>{t('Showing bindings for')} <strong>{definitionBindings.resource.name}</strong></> : t('Select a definition to show topology bindings')}</span></div></Panel> : null}
          <Panel position="top-left"><div className="canvas-toolbar">
            <button type="button" onClick={() => { setProject(createEmptyProject()); reactFlow.setCenter(0, 0, { zoom: 1 }) }}><RotateCcw size={14} /> {t('Clear canvas')}</button>
            <button type="button" disabled={project.topology.nodes.length === 0 || layoutBusy} aria-busy={layoutBusy} onClick={() => void autoLayout()}><LayoutDashboard size={14} /> {t(layoutBusy ? 'Laying out…' : 'Auto layout')}</button>
            {result ? <button type="button" aria-pressed={canvasMetricsVisible} onClick={() => setCanvasMetricsVisible((visible) => !visible)}><Activity size={14} /> {t('Canvas metrics')}</button> : null}
            <button type="button" aria-expanded={architectureReviewOpen} onClick={() => setArchitectureReviewOpen((open) => !open)}><ListChecks size={14} /> {t('Review')}<span className={architectureFindings.some((finding) => finding.severity === 'error') ? 'review-count is-error' : 'review-count'}>{architectureFindings.length}</span></button>
            <div className="example-picker">
              <button type="button" aria-expanded={exampleOpen} onClick={() => setExampleOpen((open) => !open)}><Save size={14} /> {t('Load example')} <ChevronDown size={13} /></button>
              {exampleOpen ? <div className="example-menu">{examples.map(([name, description, createProject]) => <button type="button" key={name} onClick={() => { setProject(createProject()); setExampleOpen(false); setTimeout(() => reactFlow.fitView(), 0) }}><strong>{t(`example.${name}`, {}, name)}</strong><span>{t(`example-description.${name}`, {}, description)}</span></button>)}</div> : null}
            </div>
          </div></Panel>
          {architectureReviewOpen ? <Panel position="top-right"><ArchitectureReviewPanel findings={architectureFindings} t={t} onSelect={showArchitectureFinding} onClose={() => setArchitectureReviewOpen(false)} /></Panel> : null}
        </ReactFlow>
        {contextMenu ? <div className="canvas-context-menu" role="menu" aria-label={t(contextMenu.kind === 'node' ? 'Component actions' : 'Canvas actions')} style={{ left: contextMenu.x, top: contextMenu.y }} onContextMenu={(event) => event.preventDefault()}>
          {contextMenu.kind === 'node' ? <>
            <button type="button" role="menuitem" onClick={openContextProperties}><Settings2 size={14} /><span>{t('Open properties')}</span></button>
            <button type="button" role="menuitem" onClick={copyContextNode}><Copy size={14} /><span>{t('Copy component')}</span></button>
            <button type="button" role="menuitem" disabled={!clipboardNode} title={clipboardNode ? undefined : t('Nothing copied yet')} onClick={pasteClipboardNode}><ClipboardPaste size={14} /><span>{t('Paste component')}</span></button>
            <button type="button" role="menuitem" onClick={duplicateContextNode}><ClipboardPaste size={14} /><span>{t('Duplicate component')}</span></button>
            <div className="canvas-context-menu__separator" />
            <button type="button" role="menuitem" className="danger" onClick={deleteContextNode}><Trash2 size={14} /><span>{t('Delete component')}</span></button>
          </> : <button type="button" role="menuitem" disabled={!clipboardNode} title={clipboardNode ? undefined : t('Nothing copied yet')} onClick={pasteClipboardNode}><ClipboardPaste size={14} /><span>{t('Paste component')}</span></button>}
        </div> : null}
        {error ? <div className="error-toast" role="alert"><CircleAlert size={16} /><span>{t(error)}</span><button type="button" onClick={() => setError(null)} aria-label={t('Dismiss error')}>×</button></div> : null}
      </section>
  )

  const inspectorPanel = (
      <aside className="inspector">
        <div className="inspector-tabs"><span className="active">{t(workspaceView === 'definitions' ? 'Definition editor' : 'Properties')}</span><button type="button" className="panel-close" aria-label={t(workspaceView === 'definitions' ? 'Hide definition editor' : 'Hide properties panel')} title={t(workspaceView === 'definitions' ? 'Hide definition editor' : 'Hide properties panel')} onClick={() => setPanelVisible('inspector', inspectorPanelRef, false)}><X size={13} /></button></div>
        {workspaceView === 'definitions' ? <DefinitionEditor selection={selectedDefinition} onSelectionChange={setSelectedDefinition} /> : <><PropertiesPanel node={selectedNode} edge={selectedEdge} /><RegionSection /><div className="run-settings"><div className="panel-header"><span>{t('Run settings')}</span><small>{t('Virtual time')}</small></div><Field label={t('Duration (seconds)')} value={experiment.simulation.durationSeconds} min={1} onChange={(durationSeconds) => updateSimulation({ durationSeconds })} /><label className="field"><span>{t('Random seed')}</span><input value={experiment.seed} onChange={(event) => updateMeta({ seed: event.target.value })} /></label></div></>}
      </aside>
  )

  const resultsPanel = (
      <section className="results"><div className="results-header"><div><span>{t('Simulation output')}</span>{result ? <small>{t('seed: {seed} · computed in {time} ms', { seed: result.seed, time: result.wallClockDurationMs })}</small> : null}</div><div className="panel-heading-actions"><div className="results-views" role="tablist" aria-label={t('Simulation result views')}><button ref={runTabRef} type="button" role="tab" aria-selected={resultsView === 'run'} tabIndex={resultsView === 'run' ? 0 : -1} onKeyDown={handleResultsTabKey} onClick={() => setResultsView('run')}>{t('Run details')}</button><button ref={compareTabRef} type="button" role="tab" aria-selected={resultsView === 'compare'} tabIndex={resultsView === 'compare' ? 0 : -1} onKeyDown={handleResultsTabKey} onClick={() => setResultsView('compare')}>{t('Compare runs')} <small>{runs.length}</small></button></div><button type="button" className="panel-close" aria-label={t('Hide simulation output')} title={t('Hide simulation output')} onClick={() => setPanelVisible('results', resultsPanelRef, false)}><X size={13} /></button></div></div><div role="tabpanel" aria-label={t(resultsView === 'run' ? 'Run details' : 'Compare runs')}>{resultsView === 'run' ? <ResultsPanel result={result} progress={progress} running={running} nodes={project.topology.nodes} onShowTraceNode={showTraceNode} theme={resolvedTheme} /> : <RunComparisonPanel key={`${project.id}:${result?.runId ?? ''}`} runs={runs} theme={resolvedTheme} {...(result ? { activeRunId: result.runId } : {})} />}</div></section>
  )

  return (
    <main className="workbench">
      <header className="topbar">
        <div className="brand"><span className="brand-mark"><Layers3 size={19} /></span><div><strong>{t('System Design Simulator')}</strong><span>{t('Build · Run · Break · Measure')}</span></div></div>
        <div className="topbar-center"><span className="status-dot" /> {t('Local simulation')} <span className="separator" /><span className={`modeling-mode modeling-mode--${project.modelingMode}`} aria-label={t('Project modeling mode: {mode}', { mode: t(project.modelingMode === 'business-aware' ? 'Business-aware' : 'Capacity-only') })}>{t(project.modelingMode === 'business-aware' ? 'Business-aware' : 'Capacity-only')}</span><span className="separator" /> {t('{count} components', { count: project.topology.nodes.length })} <span className="separator" /> {t('{count} links', { count: project.topology.edges.length })}</div>
        <div className="top-actions">
          <div className="workspace-switch" role="group" aria-label={t('Workbench view')}><button type="button" aria-pressed={workspaceView === 'topology'} onClick={() => setWorkspaceView('topology')}><Layers3 size={14} /> {t('Topology')}</button><button type="button" aria-pressed={workspaceView === 'definitions'} onClick={() => { setWorkspaceView('definitions'); if (!panelVisibility.inspector) setPanelVisible('inspector', inspectorPanelRef, true) }}><Blocks size={14} /> {t('Definitions')}</button></div>
          {workspaceView === 'definitions' ? <><button type="button" className="button subtle" onClick={() => setFormatDialog('openapi')}><Braces size={14} /> OpenAPI</button><button type="button" className="button subtle" onClick={() => setFormatDialog('dbml')}><DatabaseZap size={14} /> DBML</button></> : null}
          <button type="button" className="button subtle icon-only theme-toggle" aria-label={t(themeReady && resolvedTheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme')} title={t(themeReady && resolvedTheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme')} onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}><span className="theme-icon theme-icon--light"><Moon size={15} /></span><span className="theme-icon theme-icon--dark"><Sun size={15} /></span></button>
          <button type="button" className="button subtle layout-toggle" aria-label={t(panelVisibility.faults ? 'Hide fault laboratory' : 'Show fault laboratory')} title={t(panelVisibility.faults ? 'Hide fault laboratory' : 'Show fault laboratory')} aria-pressed={panelVisibility.faults} onClick={() => setPanelVisible('faults', faultsPanelRef, !panelVisibility.faults)}><FlaskConical size={15} /><span>{t('Fault lab')}</span></button>
          <button type="button" className="button subtle layout-toggle" aria-label={t(panelVisibility.results ? 'Hide simulation output' : 'Show simulation output')} title={t(panelVisibility.results ? 'Hide simulation output' : 'Show simulation output')} aria-pressed={panelVisibility.results} onClick={() => setPanelVisible('results', resultsPanelRef, !panelVisibility.results)}><PanelBottom size={15} /><span>{t('Output')}</span></button>
          <button type="button" className="button subtle layout-toggle" aria-label={t(panelVisibility.inspector ? 'Hide properties panel' : 'Show properties panel')} title={t(panelVisibility.inspector ? 'Hide properties panel' : 'Show properties panel')} aria-pressed={panelVisibility.inspector} onClick={() => setPanelVisible('inspector', inspectorPanelRef, !panelVisibility.inspector)}><PanelRight size={15} /><span>{t('Properties')}</span></button>
          <button type="button" className="button subtle icon-only" aria-label={t('Undo project change')} title={t('Undo project change')} disabled={!canUndo || running} onClick={undoProject}><Undo2 size={15} /></button>
          <button type="button" className="button subtle icon-only" aria-label={t('Redo project change')} title={t('Redo project change')} disabled={!canRedo || running} onClick={redoProject}><Redo2 size={15} /></button>
          <div className="history-picker">
            <button type="button" className="button subtle" aria-expanded={historyOpen} onClick={() => { const next = !historyOpen; setHistoryOpen(next); if (next) void refreshHistory(project.id) }}><History size={15} /> {t('History')}</button>
            {historyOpen ? <div className="history-menu" role="dialog" aria-label={t('Local project history')}>
              <div className="history-section"><strong>{t('Project revisions')}</strong>{revisions.length ? revisions.slice(0, 8).map((revision) => <button type="button" key={revision.revisionId} onClick={() => void restoreRevision(revision.revisionId)}><span>{revision.projectName}</span><small>{t(`history-source.${revision.source}`, {}, revision.source)} · {new Date(revision.createdAt).toLocaleString(locale)}</small></button>) : <p>{t('No saved revisions yet.')}</p>}</div>
              <div className="history-section"><strong>{t('Simulation runs')}</strong>{runs.length ? runs.slice(0, 8).map((savedRun) => <button type="button" key={savedRun.runId} onClick={() => void restoreRun(savedRun)}><span>{t('{completed} completed · {errors}% errors', { completed: savedRun.result.summary.completedRequests.toLocaleString(locale), errors: (savedRun.result.summary.errorRate * 100).toFixed(1) })}</span><small>{t('{time} · seed {seed}', { time: new Date(savedRun.createdAt).toLocaleString(locale), seed: savedRun.result.seed })}</small></button>) : <p>{t('No saved runs yet.')}</p>}</div>
            </div> : null}
          </div>
          <button type="button" className="button subtle" onClick={() => fileInputRef.current?.click()}><Upload size={15} /> {t('Import')}</button>
          <input ref={fileInputRef} hidden type="file" accept="application/json" onChange={(event) => void importProject(event.target.files?.[0])} />
          <button type="button" className="button subtle" onClick={exportProject}><Download size={15} /> {t('Export')}</button>
          {running ? <button type="button" className="button subtle" onClick={cancelRun}><Square size={14} fill="currentColor" /> {t('Cancel')}</button> : null}
          <button type="button" className="button run" onClick={() => void run()} disabled={running}><Play size={15} fill="currentColor" /> {t(running ? 'Running…' : 'Run simulation')}</button>
          <button type="button" className="button subtle language-toggle" aria-label={t(locale === 'en' ? 'Switch to Chinese' : 'Switch to English')} title={t(locale === 'en' ? 'Switch to Chinese' : 'Switch to English')} onClick={() => setLocale(locale === 'en' ? 'zh-CN' : 'en')}><Languages size={15} /><span>{locale === 'en' ? '中文' : 'EN'}</span></button>
        </div>
      </header>
      <WorkbenchShell
        palette={palettePanel} canvas={canvasPanel}
        faults={<div className="panel-container"><button type="button" className="panel-close panel-close--overlay" aria-label={t('Hide fault laboratory')} title={t('Hide fault laboratory')} onClick={() => setPanelVisible('faults', faultsPanelRef, false)}><X size={13} /></button><FaultLaboratory experiment={experiment} project={project} selectedFaultId={selectedFaultId} onSelectFault={selectFault} onAddFault={addFault} onUpdateFault={updateFault} onDeleteFault={deleteFault} /></div>}
        inspector={inspectorPanel} results={resultsPanel}
        faultsRef={faultsPanelRef} inspectorRef={inspectorPanelRef} resultsRef={resultsPanelRef}
      />
      {formatDialog ? <FormatDialog kind={formatDialog} selection={selectedDefinition} onClose={() => setFormatDialog(null)} onSelectionChange={setSelectedDefinition} /> : null}
    </main>
  )
}

export function Workbench() { return <ReactFlowProvider><WorkbenchInner /></ReactFlowProvider> }
