'use client'

import { Handle, Position, type NodeProps } from '@xyflow/react'
import { componentRegistry } from '@system-design/components'
import { Activity, Database, Globe2, Layers3, Server, type LucideIcon } from 'lucide-react'
import type { WorkbenchNode } from '@/lib/store'

export const componentIcons: Record<string, LucideIcon> = { globe: Globe2, activity: Activity, server: Server, layers: Layers3, database: Database }

export function ComponentNode({ data, selected }: NodeProps<WorkbenchNode>) {
  const manifest = componentRegistry.get(data.type, data.componentVersion)
  const Icon = componentIcons[manifest.iconToken] ?? Server
  const acceptsInput = manifest.ports.some((port) => port.direction === 'input')
  const emitsOutput = manifest.ports.some((port) => port.direction === 'output')
  return (
    <div className={`component-node${selected ? ' is-selected' : ''}`} style={{ '--node-color': manifest.color } as React.CSSProperties}>
      {acceptsInput ? <Handle id="in" type="target" position={Position.Left} /> : null}
      <div className="component-node__icon"><Icon size={18} aria-hidden="true" /></div>
      <div className="component-node__copy"><strong>{data.name}</strong><span>{manifest.label}</span><small>{componentRegistry.describeNode(data)}</small></div>
      {emitsOutput ? <Handle id="out" type="source" position={Position.Right} /> : null}
    </div>
  )
}
