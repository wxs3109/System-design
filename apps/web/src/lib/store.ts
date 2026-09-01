'use client'

import { addEdge, applyEdgeChanges, applyNodeChanges, type Connection as FlowConnection, type Edge, type EdgeChange, type Node, type NodeChange } from '@xyflow/react'
import { componentCatalog, componentPresetRegistry, componentRegistry, policyRegistry } from '@system-design/components'
import { createEmptyProject, parseProjectFile, projectFileV3Schema, projectToScenario, type ComponentType, type Experiment, type Fault, type PolicyAttachment, type ProjectConnection, type ProjectFile, type SimulationResult, type TopologyGroup } from '@system-design/model'
import { create, useStore } from 'zustand'
import { temporal } from 'zundo'

export type ProjectNode = ProjectFile['topology']['nodes'][number]
export type WorkbenchNode = Node<ProjectNode, 'component'>
export interface ProjectEditIssue { path: Array<string | number>; message: string }
export type ProjectEditResult = { success: true } | { success: false; issues: ProjectEditIssue[] }

interface WorkbenchState {
  project: ProjectFile
  selectedNodeId: string | null
  selectedEdgeId: string | null
  selectedFaultId: string | null
  result: SimulationResult | null
  running: boolean
  error: string | null
  setProject: (project: ProjectFile | unknown) => void
  restoreProject: (project: ProjectFile | unknown) => void
  commitProjectEdit: (project: ProjectFile | unknown) => ProjectEditResult
  addComponent: (type: ComponentType, position: { x: number; y: number }) => void
  addCatalogComponent: (categoryId: string, type: ComponentType, position: { x: number; y: number }, preset?: { id: string; version: number }) => void
  /** Compatibility command for existing callers and ProjectFile v2 preset provenance. */
  addRolePreset: (presetId: string, version: number, position: { x: number; y: number }) => void
  pasteComponent: (source: ProjectNode, position: { x: number; y: number }, name?: string) => void
  onNodesChange: (changes: NodeChange<WorkbenchNode>[]) => void
  onEdgesChange: (changes: EdgeChange<Edge>[]) => void
  connect: (connection: FlowConnection) => void
  selectNode: (nodeId: string | null) => void
  selectEdge: (edgeId: string | null) => void
  selectFault: (faultId: string | null) => void
  addFault: () => void
  updateFault: (faultId: string, updates: Partial<Omit<Fault, 'id'>>) => void
  deleteFault: (faultId: string) => void
  addRegion: (kind?: 'region' | 'zone') => void
  updateRegion: (groupId: string, updates: Partial<Pick<TopologyGroup, 'name' | 'kind' | 'nodeIds'>>) => void
  deleteRegion: (groupId: string) => void
  updateSelectedNode: (updates: { name?: string; config?: Record<string, number | string> }) => void
  applyNodeLayout: (positions: Record<string, { x: number; y: number }>) => void
  updateSelectedEdge: (updates: Partial<Pick<ProjectConnection, 'name' | 'routingMode' | 'weight'>>) => void
  attachPolicy: (target: PolicyAttachment['target'], type: string, version: number) => void
  updatePolicy: (policyId: string, updates: { enabled?: boolean; config?: Record<string, number | string> }) => void
  movePolicy: (policyId: string, direction: -1 | 1) => void
  deletePolicy: (policyId: string) => void
  deleteSelectedNode: () => void
  deleteSelectedEdge: () => void
  updateSimulation: (updates: Partial<Experiment['simulation']>) => void
  updateWorkload: (updates: { requestsPerSecond?: number; pattern?: 'constant' | 'poisson' }) => void
  updateMeta: (updates: Pick<Experiment, 'seed'>) => void
  setRunning: (running: boolean) => void
  setResult: (result: SimulationResult | null) => void
  setError: (error: string | null) => void
}

const updateActiveExperiment = (project: ProjectFile, update: (experiment: Experiment) => Experiment): ProjectFile => ({
  ...project, experiments: project.experiments.map((experiment) => experiment.id === project.activeExperimentId ? update(experiment) : experiment),
})

const faultTargetsRemovedNode = (fault: Fault, removedIds: Set<string>) => {
  const target = fault.target ?? (fault.targetNodeId === undefined ? undefined : { kind: 'node' as const, id: fault.targetNodeId })
  return target?.kind === 'node' && removedIds.has(target.id)
}

const faultTargetsRemovedEdge = (fault: Fault, removedIds: Set<string>) => fault.target?.kind === 'edge' && removedIds.has(fault.target.id)
const faultTargetsRemovedGroup = (fault: Fault, removedIds: Set<string>) => fault.target?.kind === 'group' && removedIds.has(fault.target.id)

const projectToNodes = (nodes: ProjectFile['topology']['nodes']): WorkbenchNode[] => nodes.map((node) => ({
  id: node.id,
  type: 'component',
  position: node.position,
  data: node,
  selected: false,
  initialWidth: 198,
  initialHeight: 76,
}))
const projectToEdges = (project: ProjectFile, businessLabels: ReadonlyMap<string, string> = new Map()): Edge[] => project.topology.edges.map((edge) => {
  const routingLabel = edge.routingMode === 'fan-out' ? 'fan-out' : edge.routingMode === 'async-publish' ? 'async' : undefined
  const policyLabels = project.topology.policies
    .filter((policy) => policy.target.kind === 'edge' && policy.target.id === edge.id)
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
    .map((policy) => `${policyRegistry.get(policy.type, policy.version).label}${policy.enabled ? '' : ' (off)'}`)
  return {
    id: edge.id, source: edge.source, target: edge.target, sourceHandle: edge.sourcePort, targetHandle: edge.targetPort, type: 'smoothstep', animated: true,
    ...(edge.sourceSemantic === 'hit' ? { className: 'is-cache-hit' } : edge.sourceSemantic === 'miss' ? { className: 'is-cache-miss' } : {}),
    ...([businessLabels.get(edge.id), edge.name, routingLabel, ...policyLabels].filter(Boolean).join(' · ') ? { label: [businessLabels.get(edge.id), edge.name, routingLabel, ...policyLabels].filter(Boolean).join(' · ') } : {}),
  }
})
const syncNodes = (project: ProjectFile, nodes: WorkbenchNode[]): ProjectFile => ({ ...project, topology: { ...project.topology, nodes: nodes.map((flowNode) => ({ ...flowNode.data, position: flowNode.position })) } })
const syncEdges = (project: ProjectFile, edges: Edge[]): ProjectFile => ({
  ...project,
  topology: {
    ...project.topology,
    edges: edges.map((edge) => {
      const existing = project.topology.edges.find((candidate) => candidate.id === edge.id)
      return {
        id: edge.id, source: edge.source, target: edge.target, sourcePort: edge.sourceHandle ?? 'out', targetPort: edge.targetHandle ?? 'in',
        ...(existing?.name ? { name: existing.name } : {}), weight: existing?.weight ?? 1, sourceSemantic: existing?.sourceSemantic ?? 'request', targetSemantic: existing?.targetSemantic ?? 'request', routingMode: existing?.routingMode ?? 'weighted-one',
      }
    }),
  },
})
let nextNodeNumber = 1

export const useWorkbenchStore = create<WorkbenchState>()(temporal((set, get) => ({
  project: createEmptyProject(), selectedNodeId: null, selectedEdgeId: null, selectedFaultId: null, result: null, running: false, error: null,
  setProject: (input) => set({ project: componentRegistry.validateProject(parseProjectFile(input), componentPresetRegistry), selectedNodeId: null, selectedEdgeId: null, selectedFaultId: null, result: null, error: null }),
  restoreProject: (input) => {
    const project = componentRegistry.validateProject(parseProjectFile(input), componentPresetRegistry)
    const history = useWorkbenchStore.temporal.getState()
    history.pause()
    set({ project, selectedNodeId: null, selectedEdgeId: null, selectedFaultId: null, result: null, error: null })
    history.clear()
    history.resume()
  },
  commitProjectEdit: (input) => {
    const parsed = projectFileV3Schema.safeParse(input)
    if (!parsed.success) {
      return {
        success: false,
        issues: parsed.error.issues.map((issue) => ({ path: issue.path.filter((part): part is string | number => typeof part === 'string' || typeof part === 'number'), message: issue.message })),
      }
    }
    try {
      const project = componentRegistry.validateProject(parsed.data, componentPresetRegistry)
      set({ project, result: null, error: null })
      return { success: true }
    } catch (cause) {
      return {
        success: false,
        issues: [{ path: [], message: cause instanceof Error ? cause.message : 'The project edit is invalid.' }],
      }
    }
  },
  addComponent: (type, position) => set((state) => {
    const id = `${type}-${Date.now()}-${nextNodeNumber++}`
    const workloadId = `${id}-workload`
    const category = componentCatalog.getCategoryForVariant(type)
    const node = componentCatalog.createNode(category.id, type, id, position, { workloadId })
    return {
      project: {
        ...state.project, topology: { ...state.project.topology, nodes: [...state.project.topology.nodes, node] },
        experiments: state.project.experiments.map((experiment) => type === 'traffic' ? { ...experiment, workloads: [...experiment.workloads, { id: workloadId, name: `${node.name} workload`, sourceNodeId: id, requestsPerSecond: 100, startAtSeconds: 0, durationSeconds: experiment.simulation.durationSeconds, pattern: 'poisson', requestBytes: 1_024 }] } : experiment),
      },
      selectedNodeId: id, selectedEdgeId: null, selectedFaultId: null, result: null, error: null,
    }
  }),
  addCatalogComponent: (categoryId, type, position, preset) => set((state) => {
    const id = type + '-' + Date.now() + '-' + nextNodeNumber++
    const workloadId = id + '-workload'
    const node = componentCatalog.createNode(categoryId, type, id, position, { workloadId, ...(preset ? { preset } : {}) })
    return {
      project: {
        ...state.project, topology: { ...state.project.topology, nodes: [...state.project.topology.nodes, node] },
        experiments: state.project.experiments.map((experiment) => node.type === 'traffic' ? { ...experiment, workloads: [...experiment.workloads, { id: workloadId, name: node.name + ' workload', sourceNodeId: id, requestsPerSecond: 100, startAtSeconds: 0, durationSeconds: experiment.simulation.durationSeconds, pattern: 'poisson', requestBytes: 1_024 }] } : experiment),
      },
      selectedNodeId: id, selectedEdgeId: null, selectedFaultId: null, result: null, error: null,
    }
  }),
  addRolePreset: (presetId, version, position) => set((state) => {
    const preset = componentPresetRegistry.get(presetId, version)
    const id = `${presetId}-${Date.now()}-${nextNodeNumber++}`
    const workloadId = `${id}-workload`
    const node = componentPresetRegistry.createNode(presetId, version, id, position, workloadId)
    return {
      project: {
        ...state.project, topology: { ...state.project.topology, nodes: [...state.project.topology.nodes, node] },
        experiments: state.project.experiments.map((experiment) => node.type === 'traffic' ? { ...experiment, workloads: [...experiment.workloads, { id: workloadId, name: `${preset.label} workload`, sourceNodeId: id, requestsPerSecond: 100, startAtSeconds: 0, durationSeconds: experiment.simulation.durationSeconds, pattern: 'poisson', requestBytes: 1_024 }] } : experiment),
      },
      selectedNodeId: id, selectedEdgeId: null, selectedFaultId: null, result: null, error: null,
    }
  }),
  pasteComponent: (source, position, name) => set((state) => {
    const id = `${source.type}-${Date.now()}-${nextNodeNumber++}`
    const workloadId = `${id}-workload`
    const node = {
      ...structuredClone(source),
      id,
      name: name ?? `${source.name} copy`,
      position,
      config: source.type === 'traffic' ? { workloadId } : structuredClone(source.config),
    } as ProjectNode
    return {
      project: {
        ...state.project,
        topology: { ...state.project.topology, nodes: [...state.project.topology.nodes, node] },
        experiments: state.project.experiments.map((experiment) => source.type === 'traffic' ? {
          ...experiment,
          workloads: [...experiment.workloads, {
            id: workloadId,
            name: `${node.name} workload`,
            sourceNodeId: id,
            requestsPerSecond: 100,
            startAtSeconds: 0,
            durationSeconds: experiment.simulation.durationSeconds,
            pattern: 'poisson',
            requestBytes: 1_024,
          }],
        } : experiment),
      },
      selectedNodeId: id, selectedEdgeId: null, selectedFaultId: null, result: null, error: null,
    }
  }),
  onNodesChange: (changes) => {
    const persistentChanges = changes.filter((change) => change.type !== 'dimensions' && change.type !== 'select')
    if (persistentChanges.length === 0) return
    set((state) => {
    const nextNodes = applyNodeChanges(persistentChanges, projectToNodes(state.project.topology.nodes))
    const removedIds = new Set(state.project.topology.nodes.filter((node) => !nextNodes.some((next) => next.id === node.id)).map((node) => node.id))
    let project = syncNodes(state.project, nextNodes)
    if (removedIds.size > 0) {
      const retainedEdges = project.topology.edges.filter((edge) => !removedIds.has(edge.source) && !removedIds.has(edge.target))
      const retainedEdgeIds = new Set(retainedEdges.map((edge) => edge.id))
      project = {
        ...project,
        topology: {
          ...project.topology,
          edges: retainedEdges,
          groups: project.topology.groups.map((group) => ({ ...group, nodeIds: group.nodeIds.filter((nodeId) => !removedIds.has(nodeId)) })),
          policies: project.topology.policies.filter((policy) => policy.target.kind === 'node'
            ? !removedIds.has(policy.target.id)
            : policy.target.kind !== 'edge' || retainedEdgeIds.has(policy.target.id)),
        },
        experiments: project.experiments.map((experiment) => ({ ...experiment, workloads: experiment.workloads.filter((workload) => !removedIds.has(workload.sourceNodeId)), faults: experiment.faults.filter((fault) => !faultTargetsRemovedNode(fault, removedIds) && !faultTargetsRemovedEdge(fault, new Set(state.project.topology.edges.filter((edge) => removedIds.has(edge.source) || removedIds.has(edge.target)).map((edge) => edge.id)))) })),
      }
    }
    const selectedEdgeExists = state.selectedEdgeId ? project.topology.edges.some((edge) => edge.id === state.selectedEdgeId) : false
    return { project, selectedNodeId: state.selectedNodeId && removedIds.has(state.selectedNodeId) ? null : state.selectedNodeId, selectedEdgeId: selectedEdgeExists ? state.selectedEdgeId : null, result: removedIds.size > 0 ? null : state.result }
    })
  },
  onEdgesChange: (changes) => {
    const persistentChanges = changes.filter((change) => change.type !== 'select')
    if (persistentChanges.length === 0) return
    set((state) => {
    let project = syncEdges(state.project, applyEdgeChanges(persistentChanges, projectToEdges(state.project)))
    const edgeIds = new Set(project.topology.edges.map((edge) => edge.id))
    const removedEdgeIds = new Set(state.project.topology.edges.filter((edge) => !edgeIds.has(edge.id)).map((edge) => edge.id))
    project = { ...project, topology: { ...project.topology, policies: project.topology.policies.filter((policy) => policy.target.kind !== 'edge' || edgeIds.has(policy.target.id)) }, experiments: project.experiments.map((experiment) => ({ ...experiment, faults: experiment.faults.filter((fault) => !faultTargetsRemovedEdge(fault, removedEdgeIds)) })) }
    return { project, selectedEdgeId: state.selectedEdgeId && project.topology.edges.some((edge) => edge.id === state.selectedEdgeId) ? state.selectedEdgeId : null, result: null }
    })
  },
  connect: (connection) => set((state) => {
    const source = state.project.topology.nodes.find((node) => node.id === connection.source)
    const target = state.project.topology.nodes.find((node) => node.id === connection.target)
    const validation = componentRegistry.canConnect(source, target, connection.sourceHandle, connection.targetHandle)
    if (!connection.source || !connection.target) return { error: 'Invalid connection.' }
    if (!validation.valid) return { error: validation.reason }
    const sourceSemantic = validation.sourceSemantic
    const targetSemantic = validation.targetSemantic
    if (state.project.topology.edges.some((edge) => edge.source === connection.source && edge.target === connection.target && edge.sourcePort === connection.sourceHandle && edge.targetPort === connection.targetHandle)) return { error: 'These ports are already connected.' }
    const id = `edge-${crypto.randomUUID()}`
    const edges = addEdge({ ...connection, id, type: 'smoothstep', animated: true }, projectToEdges(state.project))
    const project = syncEdges(state.project, edges)
    const routingMode = sourceSemantic === 'publish' && targetSemantic === 'consume' ? 'async-publish' : 'weighted-one'
    return {
      project: { ...project, topology: { ...project.topology, edges: project.topology.edges.map((edge) => edge.id === id ? { ...edge, sourceSemantic, targetSemantic, routingMode } : edge) } },
      selectedNodeId: null, selectedEdgeId: id, result: null, error: null,
    }
  }),
  selectNode: (selectedNodeId) => set({ selectedNodeId, selectedEdgeId: null, selectedFaultId: null }),
  selectEdge: (selectedEdgeId) => set({ selectedEdgeId, selectedNodeId: null, selectedFaultId: null }),
  selectFault: (selectedFaultId) => set({ selectedFaultId, selectedNodeId: null, selectedEdgeId: null }),
  addFault: () => set((state) => {
    const experiment = state.project.experiments.find((candidate) => candidate.id === state.project.activeExperimentId)
    const node = state.project.topology.nodes.find((candidate) => componentRegistry.get(candidate.type, candidate.componentVersion).supportedFaults.includes('node-down'))
    if (!experiment || !node) return { error: 'Add a component with executable node-down behavior before scheduling a node fault.' }
    const id = `fault-${crypto.randomUUID()}`
    const startAtSeconds = Math.min(Math.max(0, Math.round(experiment.simulation.durationSeconds / 3)), Math.max(0, experiment.simulation.durationSeconds - 0.1))
    const fault: Fault = { id, name: 'Node outage', target: { kind: 'node', id: node.id }, type: 'node-down', startAtSeconds, durationSeconds: Math.max(0.1, Math.min(5, experiment.simulation.durationSeconds - startAtSeconds)), enabled: true }
    return { project: updateActiveExperiment(state.project, (current) => ({ ...current, faults: [...current.faults, fault] })), selectedFaultId: id, selectedNodeId: null, selectedEdgeId: null, result: null, error: null }
  }),
  updateFault: (faultId, updates) => set((state) => ({
    project: updateActiveExperiment(state.project, (experiment) => ({ ...experiment, faults: experiment.faults.map((fault) => fault.id === faultId ? { ...fault, ...updates, ...(updates.target === undefined ? {} : { targetNodeId: undefined }) } as Fault : fault) })),
    result: null, error: null,
  })),
  deleteFault: (faultId) => set((state) => ({
    project: updateActiveExperiment(state.project, (experiment) => ({ ...experiment, faults: experiment.faults.filter((fault) => fault.id !== faultId) })),
    selectedFaultId: state.selectedFaultId === faultId ? null : state.selectedFaultId, result: null, error: null,
  })),
  addRegion: (kind = 'region') => set((state) => {
    const sameKindCount = state.project.topology.groups.filter((group) => group.kind === kind).length
    const id = `${kind}-${crypto.randomUUID()}`
    const group: TopologyGroup = { id, name: `${kind === 'region' ? 'Region' : 'Zone'} ${sameKindCount + 1}`, kind, nodeIds: state.selectedNodeId ? [state.selectedNodeId] : [] }
    return { project: { ...state.project, topology: { ...state.project.topology, groups: [...state.project.topology.groups, group] } }, result: null, error: null }
  }),
  updateRegion: (groupId, updates) => set((state) => {
    const nodeIds = new Set(state.project.topology.nodes.map((node) => node.id))
    const groups = state.project.topology.groups.map((group) => group.id === groupId ? {
      ...group, ...updates, ...(updates.nodeIds === undefined ? {} : { nodeIds: [...new Set(updates.nodeIds.filter((nodeId) => nodeIds.has(nodeId)))] }),
    } : group)
    const parsed = projectFileV3Schema.safeParse({ ...state.project, topology: { ...state.project.topology, groups } })
    return parsed.success ? { project: parsed.data, result: null, error: null } : { error: parsed.error.issues[0]?.message ?? 'Invalid region update.' }
  }),
  deleteRegion: (groupId) => set((state) => ({
    project: {
      ...state.project,
      topology: {
        ...state.project.topology,
        groups: state.project.topology.groups.filter((group) => group.id !== groupId),
        policies: state.project.topology.policies.filter((policy) => policy.target.kind !== 'group' || policy.target.id !== groupId),
      },
      experiments: state.project.experiments.map((experiment) => ({ ...experiment, faults: experiment.faults.filter((fault) => !faultTargetsRemovedGroup(fault, new Set([groupId]))) })),
    },
    selectedFaultId: state.project.experiments.some((experiment) => experiment.faults.some((fault) => fault.id === state.selectedFaultId && faultTargetsRemovedGroup(fault, new Set([groupId])))) ? null : state.selectedFaultId,
    result: null, error: null,
  })),
  updateSelectedNode: (updates) => set((state) => ({
    project: { ...state.project, topology: { ...state.project.topology, nodes: state.project.topology.nodes.map((node) => node.id === state.selectedNodeId ? { ...node, ...(updates.name === undefined ? {} : { name: updates.name }), config: { ...node.config, ...updates.config } } as ProjectNode : node) } },
    result: null, error: null,
  })),
  applyNodeLayout: (positions) => set((state) => ({
    project: { ...state.project, topology: { ...state.project.topology, nodes: state.project.topology.nodes.map((node) => { const position = positions[node.id]; return position ? { ...node, position } : node }) } },
    error: null,
  })),
  updateSelectedEdge: (updates) => set((state) => {
    const selected = state.project.topology.edges.find((edge) => edge.id === state.selectedEdgeId)
    if (!selected) return {}
    const routingMode = selected.sourceSemantic === 'publish' ? 'async-publish' : updates.routingMode
    return {
      project: {
        ...state.project,
        topology: {
          ...state.project.topology,
          edges: state.project.topology.edges.map((edge) => {
            const sameSynchronousOutput = routingMode !== undefined && edge.source === selected.source && edge.sourcePort === selected.sourcePort && edge.routingMode !== 'async-publish'
            return edge.id === selected.id
              ? { ...edge, ...updates, ...(routingMode === undefined ? {} : { routingMode }) }
              : sameSynchronousOutput ? { ...edge, routingMode } : edge
          }),
        },
      },
      result: null, error: null,
    }
  }),
  attachPolicy: (target, type, version) => set((state) => {
    const manifest = policyRegistry.get(type, version)
    if (!manifest.targets.includes(target.kind)) return { error: `${manifest.label} cannot be attached to a ${target.kind}.` }
    if (target.kind === 'node') {
      const node = state.project.topology.nodes.find((candidate) => candidate.id === target.id)
      if (!node) return { error: `Cannot attach ${manifest.label} to a missing node.` }
      const variant = componentRegistry.get(node.type, node.componentVersion)
      if (!variant.supportedNodePolicies.includes(type)) return { error: `${variant.label} does not support ${manifest.label} as a node policy.` }
    }
    const targetPolicies = state.project.topology.policies.filter((policy) => policy.target.kind === target.kind && policy.target.id === target.id)
    if (manifest.singletonPerTarget && targetPolicies.some((policy) => policy.type === type && policy.version === version)) {
      return { error: `${manifest.label} is already attached to this ${target.kind}.` }
    }
    const order = targetPolicies.reduce((maximum, policy) => Math.max(maximum, policy.order), -1) + 1
    const attachment: PolicyAttachment = {
      id: `policy-${crypto.randomUUID()}`, type, version, target, order, enabled: true,
      config: manifest.configSchema.parse(manifest.defaultConfig),
    }
    return {
      project: { ...state.project, topology: { ...state.project.topology, policies: [...state.project.topology.policies, attachment] } },
      result: null, error: null,
    }
  }),
  updatePolicy: (policyId, updates) => set((state) => ({
    project: {
      ...state.project,
      topology: {
        ...state.project.topology,
        policies: state.project.topology.policies.map((policy) => policy.id === policyId ? {
          ...policy,
          ...(updates.enabled === undefined ? {} : { enabled: updates.enabled }),
          ...(updates.config === undefined ? {} : { config: { ...policy.config, ...updates.config } }),
        } : policy),
      },
    },
    result: null, error: null,
  })),
  movePolicy: (policyId, direction) => set((state) => {
    const selected = state.project.topology.policies.find((policy) => policy.id === policyId)
    if (!selected) return {}
    const ordered = state.project.topology.policies
      .filter((policy) => policy.target.kind === selected.target.kind && policy.target.id === selected.target.id)
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
    const currentIndex = ordered.findIndex((policy) => policy.id === policyId)
    const nextIndex = currentIndex + direction
    if (nextIndex < 0 || nextIndex >= ordered.length) return {}
    ;[ordered[currentIndex], ordered[nextIndex]] = [ordered[nextIndex]!, ordered[currentIndex]!]
    const orders = new Map(ordered.map((policy, index) => [policy.id, index]))
    return {
      project: { ...state.project, topology: { ...state.project.topology, policies: state.project.topology.policies.map((policy) => orders.has(policy.id) ? { ...policy, order: orders.get(policy.id)! } : policy) } },
      result: null, error: null,
    }
  }),
  deletePolicy: (policyId) => set((state) => ({
    project: { ...state.project, topology: { ...state.project.topology, policies: state.project.topology.policies.filter((policy) => policy.id !== policyId) } },
    result: null, error: null,
  })),
  deleteSelectedNode: () => {
    const id = get().selectedNodeId
    if (!id) return
    set((state) => {
      const retainedEdges = state.project.topology.edges.filter((edge) => edge.source !== id && edge.target !== id)
      const retainedEdgeIds = new Set(retainedEdges.map((edge) => edge.id))
      const candidate: ProjectFile = {
          ...state.project, topology: {
            ...state.project.topology,
            nodes: state.project.topology.nodes.filter((node) => node.id !== id),
            edges: retainedEdges,
            groups: state.project.topology.groups.map((group) => ({ ...group, nodeIds: group.nodeIds.filter((nodeId) => nodeId !== id) })),
            policies: state.project.topology.policies.filter((policy) => policy.target.kind === 'node'
              ? policy.target.id !== id
              : policy.target.kind !== 'edge' || retainedEdgeIds.has(policy.target.id)),
          },
          experiments: state.project.experiments.map((experiment) => ({ ...experiment, workloads: experiment.workloads.filter((workload) => workload.sourceNodeId !== id), faults: experiment.faults.filter((fault) => !faultTargetsRemovedNode(fault, new Set([id])) && !faultTargetsRemovedEdge(fault, new Set(state.project.topology.edges.filter((edge) => edge.source === id || edge.target === id).map((edge) => edge.id)))) })),
      }
      const parsed = projectFileV3Schema.safeParse(candidate)
      if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'This component is still referenced by a business definition.' }
      return {
        project: parsed.data,
        selectedNodeId: null, selectedEdgeId: null, result: null, error: null,
      }
    })
  },
  deleteSelectedEdge: () => {
    const id = get().selectedEdgeId
    if (!id) return
    set((state) => ({ project: { ...state.project, topology: { ...state.project.topology, edges: state.project.topology.edges.filter((edge) => edge.id !== id), policies: state.project.topology.policies.filter((policy) => policy.target.kind !== 'edge' || policy.target.id !== id) }, experiments: state.project.experiments.map((experiment) => ({ ...experiment, faults: experiment.faults.filter((fault) => !faultTargetsRemovedEdge(fault, new Set([id]))) })) }, selectedEdgeId: null, result: null, error: null }))
  },
  updateSimulation: (updates) => set((state) => ({ project: updateActiveExperiment(state.project, (experiment) => ({ ...experiment, simulation: { ...experiment.simulation, ...updates }, workloads: experiment.workloads.map((workload) => ({ ...workload, durationSeconds: updates.durationSeconds ?? workload.durationSeconds })) })), result: null })),
  updateWorkload: (updates) => set((state) => {
    const selected = state.project.topology.nodes.find((node) => node.id === state.selectedNodeId)
    if (!selected || selected.type !== 'traffic') return {}
    return { project: updateActiveExperiment(state.project, (experiment) => ({ ...experiment, workloads: experiment.workloads.map((workload) => workload.id === selected.config.workloadId ? { ...workload, ...updates } : workload) })), result: null }
  }),
  updateMeta: (updates) => set((state) => ({ project: updateActiveExperiment(state.project, (experiment) => ({ ...experiment, ...updates })), result: null })),
  setRunning: (running) => set({ running }), setResult: (result) => set({ result }), setError: (error) => set({ error }),
}), {
  limit: 100,
  partialize: (state) => ({ project: structuredClone(state.project) }),
  equality: (past, current) => JSON.stringify(past.project) === JSON.stringify(current.project),
}))

const applyTimeTravel = (direction: 'undo' | 'redo') => {
  const history = useWorkbenchStore.temporal.getState()
  if (direction === 'undo') history.undo()
  else history.redo()
  const state = useWorkbenchStore.getState()
  const parsed = projectFileV3Schema.safeParse(state.project)
  if (!parsed.success) {
    if (direction === 'undo') history.redo()
    else history.undo()
    useWorkbenchStore.setState({ error: `Cannot ${direction}: the resulting project is invalid.` })
    return
  }
  const project = parsed.data
  const nodeIds = new Set(project.topology.nodes.map((node) => node.id))
  const edgeIds = new Set(project.topology.edges.map((edge) => edge.id))
  history.pause()
  useWorkbenchStore.setState({
    project,
    selectedNodeId: state.selectedNodeId && nodeIds.has(state.selectedNodeId) ? state.selectedNodeId : null,
    selectedEdgeId: state.selectedEdgeId && edgeIds.has(state.selectedEdgeId) ? state.selectedEdgeId : null,
    selectedFaultId: null,
    result: null,
    error: null,
  })
  history.resume()
}

export const undoProject = () => {
  applyTimeTravel('undo')
}

export const redoProject = () => {
  applyTimeTravel('redo')
}

export const useCanUndo = () => useStore(useWorkbenchStore.temporal, (state) => state.pastStates.length > 0)
export const useCanRedo = () => useStore(useWorkbenchStore.temporal, (state) => state.futureStates.length > 0)

export const getScenario = (project: ProjectFile) => {
  return projectToScenario(project)
}

export { projectToEdges, projectToNodes, projectFileV3Schema }
