import type { Fault, ProjectFileV2 } from '@system-design/model'

export const faultTypeLabels: Record<Fault['type'], string> = {
  'node-down': 'Node down',
  'latency-spike': 'Latency spike',
  'capacity-drop': 'Capacity drop',
  'bandwidth-drop': 'Bandwidth drop',
  'packet-loss': 'Packet loss',
  'traffic-spike': 'Traffic spike',
  'hot-key': 'Hot key',
  'region-outage': 'Region outage',
}

export const faultTarget = (fault: Fault): NonNullable<Fault['target']> => fault.target ?? { kind: 'node', id: fault.targetNodeId! }

const getActiveWorkloads = (project: ProjectFileV2) => project.experiments.find((experiment) => experiment.id === project.activeExperimentId)?.workloads ?? []

export const faultTargetName = (fault: Fault, project: ProjectFileV2) => {
  const target = faultTarget(fault)
  if (target.kind === 'node') return project.topology.nodes.find((node) => node.id === target.id)?.name ?? target.id
  if (target.kind === 'edge') {
    const edge = project.topology.edges.find((candidate) => candidate.id === target.id)
    if (!edge) return target.id
    const source = project.topology.nodes.find((node) => node.id === edge.source)?.name ?? edge.source
    const destination = project.topology.nodes.find((node) => node.id === edge.target)?.name ?? edge.target
    return `${source} → ${destination}`
  }
  if (target.kind === 'workload') return getActiveWorkloads(project).find((workload) => workload.id === target.id)?.name ?? target.id
  return project.topology.groups.find((group) => group.id === target.id)?.name ?? target.id
}

export function affectedTopology(fault: Fault | undefined, project: ProjectFileV2) {
  const nodes = new Set<string>()
  const edges = new Set<string>()
  if (!fault) return { nodes, edges }
  const target = faultTarget(fault)
  if (target.kind === 'node') nodes.add(target.id)
  if (target.kind === 'edge') {
    edges.add(target.id)
    const edge = project.topology.edges.find((candidate) => candidate.id === target.id)
    if (edge) { nodes.add(edge.source); nodes.add(edge.target) }
  }
  if (target.kind === 'workload') {
    const workload = getActiveWorkloads(project).find((candidate) => candidate.id === target.id)
    if (workload) nodes.add(workload.sourceNodeId)
  }
  if (target.kind === 'group') {
    const group = project.topology.groups.find((candidate) => candidate.id === target.id)
    group?.nodeIds.forEach((nodeId) => nodes.add(nodeId))
    project.topology.edges.forEach((edge) => {
      if (nodes.has(edge.source) || nodes.has(edge.target)) edges.add(edge.id)
    })
  }
  return { nodes, edges }
}
