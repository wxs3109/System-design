'use client'

import { useMemo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { componentPresetRegistry, componentRegistry, policyRegistry } from '@system-design/components'
import { Activity, Archive, CalendarClock, Database, GitFork, Globe2, HardDrive, Layers3, RadioTower, Server, type LucideIcon } from 'lucide-react'
import { useWorkbenchStore, type WorkbenchNode } from '@/lib/store'

export const componentIcons: Record<string, LucideIcon> = { globe: Globe2, activity: Activity, 'calendar-clock': CalendarClock, 'git-fork': GitFork, server: Server, layers: Layers3, database: Database, 'hard-drive': HardDrive, 'radio-tower': RadioTower, archive: Archive }

export function ComponentNode({ data, selected }: NodeProps<WorkbenchNode>) {
  const manifest = componentRegistry.get(data.type, data.componentVersion)
  const preset = data.rolePreset ? componentPresetRegistry.find(data.rolePreset.id, data.rolePreset.version) : undefined
  const allPolicies = useWorkbenchStore((state) => state.project.topology.policies)
  const policies = useMemo(() => allPolicies
    .filter((policy) => policy.target.kind === 'node' && policy.target.id === data.id)
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id)), [allPolicies, data.id])
  const Icon = componentIcons[preset?.iconToken ?? manifest.iconToken] ?? Server
  const inputs = manifest.ports.filter((port) => port.direction === 'input')
  const outputs = manifest.ports.filter((port) => port.direction === 'output')
  const portTitle = (port: (typeof manifest.ports)[number]) => `${port.label} · ${port.semantic}`
  return (
    <div className={`component-node${selected ? ' is-selected' : ''}`} style={{ '--node-color': manifest.color } as React.CSSProperties}>
      {inputs.map((port, index) => <Handle key={port.id} id={port.id} type="target" position={Position.Left} title={portTitle(port)} aria-label={`${port.label} input port`} style={{ top: `${((index + 1) / (inputs.length + 1)) * 100}%` }} />)}
      <div className="component-node__icon"><Icon size={18} aria-hidden="true" /></div>
      <div className="component-node__copy"><strong>{data.name}</strong><span>{manifest.label}</span>{preset ? <em>Template: {preset.label}</em> : null}<small>{componentRegistry.describeNode(data)}</small>{policies.length ? <div className="component-node__policies" aria-label="Attached policies">{policies.map((policy) => <span key={policy.id} className={policy.enabled ? undefined : 'is-disabled'}>{policyRegistry.get(policy.type, policy.version).label}</span>)}</div> : null}</div>
      {outputs.map((port, index) => <Handle key={port.id} id={port.id} type="source" position={Position.Right} title={portTitle(port)} aria-label={`${port.label} output port`} style={{ top: `${((index + 1) / (outputs.length + 1)) * 100}%` }} />)}
    </div>
  )
}
