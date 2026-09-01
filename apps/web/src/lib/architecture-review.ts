import type { ProjectFile } from '@system-design/model'

export type ArchitectureFindingSeverity = 'error' | 'warning' | 'info'
export type ArchitectureFindingRule =
  | 'isolated-node'
  | 'unreachable-node'
  | 'broker-no-consumer'
  | 'cache-no-miss-path'
  | 'cdn-no-origin'
  | 'single-replica-service'
  | 'database-no-replica'
  | 'router-no-target'
  | 'router-single-target'
  | 'retry-without-timeout'
  | 'cross-region-edge'

export interface ArchitectureFinding {
  id: string
  rule: ArchitectureFindingRule
  severity: ArchitectureFindingSeverity
  target: { kind: 'node' | 'edge'; id: string }
  values: Record<string, string | number>
}

const severityOrder: Record<ArchitectureFindingSeverity, number> = { error: 0, warning: 1, info: 2 }

const enabledPolicy = (policy: ProjectFile['topology']['policies'][number]) => policy.enabled !== false

const businessCacheMissHandled = (project: ProjectFile, nodeId: string) => project.definitions.interactions.some((interaction) => interaction.actions.some((action) => {
  if (action.kind !== 'cache-access' || action.nodeId !== nodeId || action.operation !== 'get') return false
  return interaction.actions.some((candidate) => candidate.condition?.actionId === action.id && candidate.condition.outcome === 'cache-miss')
}))

export function reviewArchitecture(project: ProjectFile): ArchitectureFinding[] {
  const findings: ArchitectureFinding[] = []
  const enabledNodes = project.topology.nodes.filter((node) => !node.disabled)
  const enabledNodeIds = new Set(enabledNodes.map((node) => node.id))
  const enabledEdges = project.topology.edges.filter((edge) => enabledNodeIds.has(edge.source) && enabledNodeIds.has(edge.target))
  const outgoing = new Map<string, typeof enabledEdges>()
  const incidentCounts = new Map(enabledNodes.map((node) => [node.id, 0]))
  enabledEdges.forEach((edge) => {
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge])
    incidentCounts.set(edge.source, (incidentCounts.get(edge.source) ?? 0) + 1)
    incidentCounts.set(edge.target, (incidentCounts.get(edge.target) ?? 0) + 1)
  })
  const add = (rule: ArchitectureFindingRule, severity: ArchitectureFindingSeverity, target: ArchitectureFinding['target'], values: ArchitectureFinding['values']) => {
    findings.push({ id: `${rule}:${target.kind}:${target.id}`, rule, severity, target, values })
  }

  const isolated = new Set<string>()
  enabledNodes.forEach((node) => {
    if ((incidentCounts.get(node.id) ?? 0) === 0) {
      isolated.add(node.id)
      add('isolated-node', 'warning', { kind: 'node', id: node.id }, { name: node.name })
    }
  })

  const experiment = project.experiments.find((candidate) => candidate.id === project.activeExperimentId)
  const sourceIds = new Set([
    ...(experiment?.workloads.map((workload) => workload.sourceNodeId) ?? []),
    ...(experiment?.operationWorkloads.map((workload) => workload.sourceNodeId) ?? []),
    ...enabledNodes.filter((node) => node.type === 'scheduler').map((node) => node.id),
  ].filter((id) => enabledNodeIds.has(id)))
  if (sourceIds.size > 0) {
    const reachable = new Set<string>()
    const visit = (nodeId: string) => {
      if (reachable.has(nodeId)) return
      reachable.add(nodeId)
      ;(outgoing.get(nodeId) ?? []).forEach((edge) => visit(edge.target))
    }
    sourceIds.forEach(visit)
    enabledNodes.forEach((node) => {
      if (!reachable.has(node.id) && !isolated.has(node.id)) add('unreachable-node', 'warning', { kind: 'node', id: node.id }, { name: node.name })
    })
  }

  enabledNodes.forEach((node) => {
    const nodeOutgoing = outgoing.get(node.id) ?? []
    if (node.type === 'queue' || node.type === 'stream' || node.type === 'topic') {
      const consumers = nodeOutgoing.length
      if (consumers === 0) add('broker-no-consumer', 'warning', { kind: 'node', id: node.id }, { name: node.name, kind: node.type })
    }
    if (node.type === 'cache' && !nodeOutgoing.some((edge) => edge.sourcePort === 'miss') && !businessCacheMissHandled(project, node.id)) {
      add('cache-no-miss-path', 'warning', { kind: 'node', id: node.id }, { name: node.name })
    }
    if (node.type === 'cdn' && !nodeOutgoing.some((edge) => edge.sourcePort === 'miss')) {
      add('cdn-no-origin', 'error', { kind: 'node', id: node.id }, { name: node.name })
    }
    if (node.type === 'service' && Number(node.config.replicas) <= 1) {
      add('single-replica-service', 'warning', { kind: 'node', id: node.id }, { name: node.name })
    }
    if (node.type === 'database' && node.componentVersion >= 2 && Number(node.config.replicasPerShard) === 0) {
      add('database-no-replica', 'warning', { kind: 'node', id: node.id }, { name: node.name })
    }
    if (node.type === 'load-balancer' || node.type === 'global-router') {
      const targets = nodeOutgoing.filter((edge) => edge.routingMode !== 'async-publish').length
      if (targets === 0) add('router-no-target', 'error', { kind: 'node', id: node.id }, { name: node.name })
      else if (targets === 1) add('router-single-target', 'warning', { kind: 'node', id: node.id }, { name: node.name })
    }
  })

  enabledEdges.forEach((edge) => {
    const policies = project.topology.policies.filter((policy) => policy.target.kind === 'edge' && policy.target.id === edge.id && enabledPolicy(policy))
    if (policies.some((policy) => policy.type === 'retry') && !policies.some((policy) => policy.type === 'timeout')) {
      const source = enabledNodes.find((node) => node.id === edge.source)?.name ?? edge.source
      const target = enabledNodes.find((node) => node.id === edge.target)?.name ?? edge.target
      add('retry-without-timeout', 'warning', { kind: 'edge', id: edge.id }, { source, target })
    }
  })

  const regionMemberships = new Map<string, string[]>()
  project.topology.groups.filter((group) => group.kind === 'region').forEach((group) => group.nodeIds.forEach((nodeId) => {
    regionMemberships.set(nodeId, [...(regionMemberships.get(nodeId) ?? []), group.name])
  }))
  enabledEdges.forEach((edge) => {
    const sourceNode = enabledNodes.find((node) => node.id === edge.source)
    const targetNode = enabledNodes.find((node) => node.id === edge.target)
    if (sourceNode?.type === 'global-router') return
    const sourceRegions = regionMemberships.get(edge.source) ?? []
    const targetRegions = regionMemberships.get(edge.target) ?? []
    if (sourceRegions.length === 1 && targetRegions.length === 1 && sourceRegions[0] !== targetRegions[0]) {
      add('cross-region-edge', 'info', { kind: 'edge', id: edge.id }, { source: sourceNode?.name ?? edge.source, target: targetNode?.name ?? edge.target, sourceRegion: sourceRegions[0]!, targetRegion: targetRegions[0]! })
    }
  })

  return findings.sort((left, right) => severityOrder[left.severity] - severityOrder[right.severity] || left.rule.localeCompare(right.rule) || left.target.id.localeCompare(right.target.id))
}
