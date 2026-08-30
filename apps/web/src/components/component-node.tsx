'use client'

import { Handle, Position, type NodeProps } from '@xyflow/react'
import { componentRegistry } from '@system-design/components'
import { Activity, Database, Globe2, Layers3, Server, type LucideIcon } from 'lucide-react'
import type { WorkbenchNode } from '@/lib/store'

export const componentIcons: Record<string, LucideIcon> = { globe: Globe2, activity: Activity, server: Server, layers: Layers3, database: Database }

export function ComponentNode({ data, selected }: NodeProps<WorkbenchNode>) {
  const manifest = componentRegistry.get(data.type, data.componentVersion)
  const Icon = componentIcons[manifest.iconToken] ?? Server
  const inputs = manifest.ports.filter((port) => port.direction === 'input')
  const outputs = manifest.ports.filter((port) => port.direction === 'output')
  const portTitle = (port: (typeof manifest.ports)[number]) => `${port.label} · ${port.semantic}`
  return (
    <div className={`component-node${selected ? ' is-selected' : ''}`} style={{ '--node-color': manifest.color } as React.CSSProperties}>
      {inputs.map((port, index) => <Handle key={port.id} id={port.id} type="target" position={Position.Left} title={portTitle(port)} aria-label={`${port.label} input port`} style={{ top: `${((index + 1) / (inputs.length + 1)) * 100}%` }} />)}
      <div className="component-node__icon"><Icon size={18} aria-hidden="true" /></div>
      <div className="component-node__copy"><strong>{data.name}</strong><span>{manifest.label}</span><small>{componentRegistry.describeNode(data)}</small></div>
      {outputs.map((port, index) => <Handle key={port.id} id={port.id} type="source" position={Position.Right} title={portTitle(port)} aria-label={`${port.label} output port`} style={{ top: `${((index + 1) / (outputs.length + 1)) * 100}%` }} />)}
    </div>
  )
}
