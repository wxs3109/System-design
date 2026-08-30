'use client'

import { Handle, Position, type NodeProps } from '@xyflow/react'
import { componentCatalog, type ComponentNode as ComponentNodeModel } from '@system-design/model'
import { Activity, Database, Globe2, Layers3, Server } from 'lucide-react'
import type { WorkbenchNode } from '@/lib/store'

const icons = {
  traffic: Globe2,
  network: Activity,
  service: Server,
  queue: Layers3,
  database: Database,
}

const describeConfig = (node: ComponentNodeModel) => {
  switch (node.type) {
    case 'traffic': return 'workload source'
    case 'network': return `${node.config.latencyMs} ms · ${node.config.bandwidthMbps} Mbps`
    case 'service': return `${node.config.replicas} × ${node.config.concurrencyPerReplica} concurrent`
    case 'queue': return `${node.config.consumers} consumers · ${node.config.maxDepth} max`
    case 'database': return `${node.config.maxConnections} connections · ${node.config.queryTimeMs} ms`
  }
}

export function ComponentNode({ data, selected }: NodeProps<WorkbenchNode>) {
  const definition = componentCatalog[data.type]
  const Icon = icons[data.type]
  return (
    <div className={`component-node${selected ? ' is-selected' : ''}`} style={{ '--node-color': definition.color } as React.CSSProperties}>
      {definition.acceptsInput ? <Handle id="in" type="target" position={Position.Left} /> : null}
      <div className="component-node__icon"><Icon size={18} aria-hidden="true" /></div>
      <div className="component-node__copy">
        <strong>{data.name}</strong>
        <span>{definition.label}</span>
        <small>{describeConfig(data)}</small>
      </div>
      {definition.emitsOutput ? <Handle id="out" type="source" position={Position.Right} /> : null}
    </div>
  )
}
