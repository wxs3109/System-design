'use client'

import { addEdge, applyEdgeChanges, applyNodeChanges, type Connection as FlowConnection, type Edge, type EdgeChange, type Node, type NodeChange } from '@xyflow/react'
import { componentRegistry, createRegisteredNode } from '@system-design/components'
import { createEmptyProject, parseProjectFile, projectFileV2Schema, projectToScenario, type ComponentType, type Experiment, type ProjectConnection, type ProjectFileV2, type SimulationResult } from '@system-design/model'
import { create } from 'zustand'

export type ProjectNode = ProjectFileV2['topology']['nodes'][number]
export type WorkbenchNode = Node<ProjectNode, 'component'>

interface WorkbenchState {
  project: ProjectFileV2
  selectedNodeId: string | null
  selectedEdgeId: string | null
  result: SimulationResult | null
  running: boolean
  error: string | null
  setProject: (project: ProjectFileV2 | unknown) => void
  addComponent: (type: ComponentType, position: { x: number; y: number }) => void
  onNodesChange: (changes: NodeChange<WorkbenchNode>[]) => void
  onEdgesChange: (changes: EdgeChange<Edge>[]) => void
  connect: (connection: FlowConnection) => void
  selectNode: (nodeId: string | null) => void
  selectEdge: (edgeId: string | null) => void
  updateSelectedNode: (updates: { name?: string; config?: Record<string, number | string> }) => void
  updateSelectedEdge: (updates: Partial<Pick<ProjectConnection, 'routingMode' | 'weight'>>) => void
  deleteSelectedNode: () => void
  deleteSelectedEdge: () => void
  updateSimulation: (updates: Partial<Experiment['simulation']>) => void
  updateWorkload: (updates: { requestsPerSecond?: number; pattern?: 'constant' | 'poisson' }) => void
  updateMeta: (updates: Pick<Experiment, 'seed'>) => void
  setRunning: (running: boolean) => void
  setResult: (result: SimulationResult | null) => void
  setError: (error: string | null) => void
}

const updateActiveExperiment = (project: ProjectFileV2, update: (experiment: Experiment) => Experiment): ProjectFileV2 => ({
  ...project, experiments: project.experiments.map((experiment) => experiment.id === project.activeExperimentId ? update(experiment) : experiment),
})

const projectToNodes = (project: ProjectFileV2): WorkbenchNode[] => project.topology.nodes.map((node) => ({ id: node.id, type: 'component', position: node.position, data: node, selected: false }))
const projectToEdges = (project: ProjectFileV2): Edge[] => project.topology.edges.map((edge) => ({
  id: edge.id, source: edge.source, target: edge.target, sourceHandle: edge.sourcePort, targetHandle: edge.targetPort, type: 'smoothstep', animated: true,
  label: edge.routingMode === 'weighted-one' ? undefined : edge.routingMode === 'fan-out' ? 'fan-out' : 'async',
}))
const syncNodes = (project: ProjectFileV2, nodes: WorkbenchNode[]): ProjectFileV2 => ({ ...project, topology: { ...project.topology, nodes: nodes.map((flowNode) => ({ ...flowNode.data, position: flowNode.position })) } })
const syncEdges = (project: ProjectFileV2, edges: Edge[]): ProjectFileV2 => ({
  ...project,
  topology: {
    ...project.topology,
    edges: edges.map((edge) => {
      const existing = project.topology.edges.find((candidate) => candidate.id === edge.id)
      return {
        id: edge.id, source: edge.source, target: edge.target, sourcePort: edge.sourceHandle ?? 'out', targetPort: edge.targetHandle ?? 'in',
        weight: existing?.weight ?? 1, sourceSemantic: existing?.sourceSemantic ?? 'request', targetSemantic: existing?.targetSemantic ?? 'request', routingMode: existing?.routingMode ?? 'weighted-one',
      }
    }),
  },
})
let nextNodeNumber = 1

export const useWorkbenchStore = create<WorkbenchState>((set, get) => ({
  project: createEmptyProject(), selectedNodeId: null, selectedEdgeId: null, result: null, running: false, error: null,
  setProject: (input) => set({ project: parseProjectFile(input), selectedNodeId: null, selectedEdgeId: null, result: null, error: null }),
  addComponent: (type, position) => set((state) => {
    const id = `${type}-${Date.now()}-${nextNodeNumber++}`
    const workloadId = `${id}-workload`
    const node = createRegisteredNode(type, id, position, workloadId)
    return {
      project: {
        ...state.project, topology: { ...state.project.topology, nodes: [...state.project.topology.nodes, node] },
        experiments: state.project.experiments.map((experiment) => type === 'traffic' ? { ...experiment, workloads: [...experiment.workloads, { id: workloadId, name: `${node.name} workload`, sourceNodeId: id, requestsPerSecond: 100, startAtSeconds: 0, durationSeconds: experiment.simulation.durationSeconds, pattern: 'poisson', requestBytes: 1_024 }] } : experiment),
      },
      selectedNodeId: id, selectedEdgeId: null, result: null, error: null,
    }
  }),
  onNodesChange: (changes) => set((state) => {
    const nextNodes = applyNodeChanges(changes, projectToNodes(state.project))
    const removedIds = new Set(state.project.topology.nodes.filter((node) => !nextNodes.some((next) => next.id === node.id)).map((node) => node.id))
    let project = syncNodes(state.project, nextNodes)
    if (removedIds.size > 0) project = {
      ...project,
      topology: { ...project.topology, edges: project.topology.edges.filter((edge) => !removedIds.has(edge.source) && !removedIds.has(edge.target)) },
      experiments: project.experiments.map((experiment) => ({ ...experiment, workloads: experiment.workloads.filter((workload) => !removedIds.has(workload.sourceNodeId)), faults: experiment.faults.filter((fault) => !removedIds.has(fault.targetNodeId)) })),
    }
    const selectedEdgeExists = state.selectedEdgeId ? project.topology.edges.some((edge) => edge.id === state.selectedEdgeId) : false
    return { project, selectedNodeId: state.selectedNodeId && removedIds.has(state.selectedNodeId) ? null : state.selectedNodeId, selectedEdgeId: selectedEdgeExists ? state.selectedEdgeId : null, result: removedIds.size > 0 ? null : state.result }
  }),
  onEdgesChange: (changes) => set((state) => {
    const project = syncEdges(state.project, applyEdgeChanges(changes, projectToEdges(state.project)))
    return { project, selectedEdgeId: state.selectedEdgeId && project.topology.edges.some((edge) => edge.id === state.selectedEdgeId) ? state.selectedEdgeId : null, result: null }
  }),
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
  selectNode: (selectedNodeId) => set({ selectedNodeId, selectedEdgeId: null }),
  selectEdge: (selectedEdgeId) => set({ selectedEdgeId, selectedNodeId: null }),
  updateSelectedNode: (updates) => set((state) => ({
    project: { ...state.project, topology: { ...state.project.topology, nodes: state.project.topology.nodes.map((node) => node.id === state.selectedNodeId ? { ...node, ...(updates.name === undefined ? {} : { name: updates.name }), config: { ...node.config, ...updates.config } } as ProjectNode : node) } },
    result: null, error: null,
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
  deleteSelectedNode: () => {
    const id = get().selectedNodeId
    if (!id) return
    set((state) => ({
      project: {
        ...state.project, topology: { ...state.project.topology, nodes: state.project.topology.nodes.filter((node) => node.id !== id), edges: state.project.topology.edges.filter((edge) => edge.source !== id && edge.target !== id) },
        experiments: state.project.experiments.map((experiment) => ({ ...experiment, workloads: experiment.workloads.filter((workload) => workload.sourceNodeId !== id), faults: experiment.faults.filter((fault) => fault.targetNodeId !== id) })),
      },
      selectedNodeId: null, selectedEdgeId: null, result: null, error: null,
    }))
  },
  deleteSelectedEdge: () => {
    const id = get().selectedEdgeId
    if (!id) return
    set((state) => ({ project: { ...state.project, topology: { ...state.project.topology, edges: state.project.topology.edges.filter((edge) => edge.id !== id) } }, selectedEdgeId: null, result: null, error: null }))
  },
  updateSimulation: (updates) => set((state) => ({ project: updateActiveExperiment(state.project, (experiment) => ({ ...experiment, simulation: { ...experiment.simulation, ...updates }, workloads: experiment.workloads.map((workload) => ({ ...workload, durationSeconds: updates.durationSeconds ?? workload.durationSeconds })) })), result: null })),
  updateWorkload: (updates) => set((state) => {
    const selected = state.project.topology.nodes.find((node) => node.id === state.selectedNodeId)
    if (!selected || selected.type !== 'traffic') return {}
    return { project: updateActiveExperiment(state.project, (experiment) => ({ ...experiment, workloads: experiment.workloads.map((workload) => workload.id === selected.config.workloadId ? { ...workload, ...updates } : workload) })), result: null }
  }),
  updateMeta: (updates) => set((state) => ({ project: updateActiveExperiment(state.project, (experiment) => ({ ...experiment, ...updates })), result: null })),
  setRunning: (running) => set({ running }), setResult: (result) => set({ result }), setError: (error) => set({ error }),
}))

export const getScenario = (project: ProjectFileV2) => {
  return projectToScenario(project)
}

export { projectToEdges, projectToNodes, projectFileV2Schema }
