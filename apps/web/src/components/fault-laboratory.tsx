'use client'

import { useMemo } from 'react'
import type { Experiment, Fault, ProjectFile } from '@system-design/model'
import { componentRegistry } from '@system-design/components'
import { AlertTriangle, Plus, Trash2 } from 'lucide-react'
import { FaultTimeline } from './fault-timeline'
import { faultTarget, faultTargetName, faultTypeLabels } from './fault-topology'
import { useI18n } from '@/lib/i18n'

type FaultTarget = NonNullable<Fault['target']>

interface FaultLaboratoryProps {
  experiment: Experiment
  project: ProjectFile
  selectedFaultId: string | null
  onSelectFault: (faultId: string | null) => void
  onAddFault: () => void
  onUpdateFault: (faultId: string, updates: Partial<Omit<Fault, 'id'>>) => void
  onDeleteFault: (faultId: string) => void
}

const faultTypes = Object.keys(faultTypeLabels) as Fault['type'][]

const requiredTargetKind: Partial<Record<Fault['type'], FaultTarget['kind']>> = {
  'bandwidth-drop': 'edge',
  'packet-loss': 'edge',
  'traffic-spike': 'workload',
  'hot-key': 'workload',
  'region-outage': 'group',
}

const allowedTargetKinds: Record<Fault['type'], FaultTarget['kind'][]> = {
  'node-down': ['node'],
  'latency-spike': ['node', 'edge'],
  'capacity-drop': ['node'],
  'bandwidth-drop': ['edge'],
  'packet-loss': ['edge'],
  'traffic-spike': ['workload'],
  'hot-key': ['workload'],
  'region-outage': ['group'],
}

const targetKindLabels: Record<FaultTarget['kind'], string> = { node: 'Node', edge: 'Link', workload: 'Workload', group: 'Region / zone' }

const defaultFactor: Partial<Record<Fault['type'], number>> = {
  'latency-spike': 3,
  'capacity-drop': 0.5,
  'bandwidth-drop': 0.5,
  'packet-loss': 0.1,
  'traffic-spike': 3,
  'hot-key': 0.8,
}

const supportsFactor = (type: Fault['type']) => type !== 'node-down' && type !== 'region-outage'
const factorLabel: Partial<Record<Fault['type'], string>> = {
  'latency-spike': 'Latency multiplier', 'capacity-drop': 'Capacity multiplier',
  'bandwidth-drop': 'Bandwidth multiplier', 'packet-loss': 'Loss probability',
  'traffic-spike': 'Traffic multiplier', 'hot-key': 'Hot-key probability',
}
const probabilityFactor = (type: Fault['type']) => ['capacity-drop', 'bandwidth-drop', 'packet-loss', 'hot-key'].includes(type)

function targetChoices(project: ProjectFile, experiment: Experiment, kind: FaultTarget['kind'], type: Fault['type']) {
  if (kind === 'node') return project.topology.nodes
    .filter((node) => componentRegistry.get(node.type, node.componentVersion).supportedFaults.includes(type))
    .map((node) => ({ id: node.id, label: node.name }))
  if (kind === 'edge') return project.topology.edges.map((edge) => {
    const source = project.topology.nodes.find((node) => node.id === edge.source)?.name ?? edge.source
    const target = project.topology.nodes.find((node) => node.id === edge.target)?.name ?? edge.target
    return { id: edge.id, label: `${source} → ${target}` }
  })
  if (kind === 'workload') return experiment.workloads.map((workload) => ({ id: workload.id, label: workload.name }))
  return project.topology.groups.filter((group) => group.kind === 'region' || group.kind === 'zone').map((group) => ({ id: group.id, label: group.name }))
}

const toNumber = (value: string, fallback: number) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function FaultLaboratory({ experiment, project, selectedFaultId, onSelectFault, onAddFault, onUpdateFault, onDeleteFault }: FaultLaboratoryProps) {
  const { t } = useI18n()
  const faultLabel = (type: Fault['type']) => t(`fault.${type}`, {}, faultTypeLabels[type])
  const selectedFault = experiment.faults.find((fault) => fault.id === selectedFaultId)
  const selectedTarget = selectedFault ? faultTarget(selectedFault) : undefined
  const choices = useMemo(() => selectedFault && selectedTarget ? targetChoices(project, experiment, selectedTarget.kind, selectedFault.type) : [], [experiment, project, selectedFault, selectedTarget])

  const updateType = (type: Fault['type']) => {
    if (!selectedFault) return
    const current = faultTarget(selectedFault)
    const kind = requiredTargetKind[type] ?? (allowedTargetKinds[type].includes(current.kind) ? current.kind : allowedTargetKinds[type][0]!)
    const choicesForKind = targetChoices(project, experiment, kind, type)
    if (choicesForKind.length === 0) return
    onUpdateFault(selectedFault.id, {
      type,
      target: { kind, id: choicesForKind[0]!.id },
      factor: supportsFactor(type) ? (selectedFault.factor ?? defaultFactor[type] ?? 1) : undefined,
    })
  }

  return (
    <section className="fault-laboratory" aria-label={t('Fault laboratory')}>
      <div className="fault-laboratory__header">
        <div><strong>{t('Fault timeline')}</strong><span>{t('Drag to move · pull either edge to resize · virtual seconds')}</span></div>
        <div className="fault-laboratory__actions">
          <select
            aria-label={t('Fault timeline entry')}
            value={selectedFaultId ?? ''}
            disabled={experiment.faults.length === 0}
            onChange={(event) => onSelectFault(event.target.value || null)}
          >
            <option value="">{t(experiment.faults.length === 0 ? 'No faults scheduled' : 'Select a fault…')}</option>
            {experiment.faults.map((fault) => <option key={fault.id} value={fault.id}>{fault.name ?? faultLabel(fault.type)} · {fault.startAtSeconds}s–{fault.startAtSeconds + fault.durationSeconds}s</option>)}
          </select>
          <button type="button" className="button" onClick={onAddFault} disabled={project.topology.nodes.length === 0}><Plus size={14} /> {t('Add fault')}</button>
        </div>
      </div>
      <FaultTimeline experiment={experiment} project={project} selectedFaultId={selectedFaultId} onSelect={onSelectFault} onMove={(id, startAtSeconds, durationSeconds) => onUpdateFault(id, { startAtSeconds, durationSeconds })} />
      {selectedFault && selectedTarget ? (
        <div className="fault-editor" aria-label={t('Selected fault editor')}>
          <label className="policy-toggle fault-editor__enabled"><input type="checkbox" checked={selectedFault.enabled} onChange={(event) => onUpdateFault(selectedFault.id, { enabled: event.target.checked })} /><span>{t('Enabled')}</span></label>
          <label className="field"><span>{t('Name')}</span><input value={selectedFault.name ?? ''} placeholder={faultLabel(selectedFault.type)} onChange={(event) => onUpdateFault(selectedFault.id, { name: event.target.value || undefined })} /></label>
          <label className="field"><span>{t('Fault type')}</span><select value={selectedFault.type} onChange={(event) => updateType(event.target.value as Fault['type'])}>{faultTypes.map((type) => { const available = allowedTargetKinds[type].some((kind) => targetChoices(project, experiment, kind, type).length > 0); return <option key={type} value={type} disabled={!available}>{faultLabel(type)}{available ? '' : t(' (no target)')}</option> })}</select></label>
          <label className="field"><span>{t('Target kind')}</span><select value={selectedTarget.kind} onChange={(event) => { const kind = event.target.value as FaultTarget['kind']; const next = targetChoices(project, experiment, kind, selectedFault.type)[0]; if (next) onUpdateFault(selectedFault.id, { target: { kind, id: next.id } }) }}>{allowedTargetKinds[selectedFault.type].map((kind) => <option key={kind} value={kind} disabled={targetChoices(project, experiment, kind, selectedFault.type).length === 0}>{t(`target.${kind}`, {}, targetKindLabels[kind])}</option>)}</select></label>
          <label className="field"><span>{t('Target')}</span><select value={selectedTarget.id} aria-label={t('Fault target')} onChange={(event) => onUpdateFault(selectedFault.id, { target: { kind: selectedTarget.kind, id: event.target.value } })}>{choices.map((choice) => <option key={choice.id} value={choice.id}>{choice.label}</option>)}</select></label>
          <label className="field"><span>{t('Start (seconds)')}</span><input type="number" min={0} max={experiment.simulation.durationSeconds} step={0.1} value={selectedFault.startAtSeconds} onChange={(event) => onUpdateFault(selectedFault.id, { startAtSeconds: Math.max(0, toNumber(event.target.value, selectedFault.startAtSeconds)) })} /></label>
          <label className="field"><span>{t('Duration (seconds)')}</span><input type="number" min={0.1} max={experiment.simulation.durationSeconds} step={0.1} value={selectedFault.durationSeconds} onChange={(event) => onUpdateFault(selectedFault.id, { durationSeconds: Math.max(0.1, toNumber(event.target.value, selectedFault.durationSeconds)) })} /></label>
          {supportsFactor(selectedFault.type) ? <label className="field"><span>{t(`factor.${selectedFault.type}`, {}, factorLabel[selectedFault.type] ?? 'Factor')}</span><input type="number" min={probabilityFactor(selectedFault.type) ? 0.01 : 1} max={probabilityFactor(selectedFault.type) ? 1 : undefined} step={0.1} value={selectedFault.factor ?? defaultFactor[selectedFault.type] ?? 1} onChange={(event) => onUpdateFault(selectedFault.id, { factor: toNumber(event.target.value, selectedFault.factor ?? 1) })} /></label> : null}
          <div className="fault-editor__summary"><AlertTriangle size={14} /><span>{t('Fault summary', { type: faultLabel(selectedFault.type), target: faultTargetName(selectedFault, project), start: selectedFault.startAtSeconds, end: selectedFault.startAtSeconds + selectedFault.durationSeconds })}</span></div>
          <button type="button" className="icon-button danger" onClick={() => onDeleteFault(selectedFault.id)} aria-label={t('Delete {name}', { name: selectedFault.name ?? t(`fault.${selectedFault.type}`, {}, faultLabel(selectedFault.type)) })}><Trash2 size={15} /></button>
        </div>
      ) : null}
    </section>
  )
}
