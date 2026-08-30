'use client'

import { addEdge, applyEdgeChanges, applyNodeChanges, type Connection as FlowConnection, type Edge, type EdgeChange, type Node, type NodeChange } from '@xyflow/react'
import { componentRegistry, createRegisteredNode } from '@system-design/components'
import { createEmptyProject, parseProjectFile, projectFileV2Schema, projectToScenario, type ComponentType, type Experiment, type ProjectFileV2, type SimulationResult } from '@system-design/model'
import { create } from 'zustand'

export type ProjectNode = ProjectFileV2['topology']['nodes'][number]
export type WorkbenchNode = Node<ProjectNode, 'component'>

interface WorkbenchState {
  project: ProjectFileV2
  selectedNodeId: string | null
  result: SimulationResult | null
  running: boolean
  error: string | null
  setProject: (project: ProjectFileV2 | unknown) => void
  addComponent: (type: ComponentType, position: { x: number; y: number }) => void
  onNodesChange: (changes: NodeChange<WorkbenchNode>[]) => void
  onEdgesChange: (changes: EdgeChange<Edge>[]) => void
  connect: (connection: FlowConnection) => void
  selectNode: (nodeId: string | null) => void
  updateSelectedNode: (updates: { name?: string; config?: Record<string, number | string> }) => void
  deleteSelectedNode: () => void
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
const projectToEdges = (project: ProjectFileV2): Edge[] => project.topology.edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, sourceHandle: edge.sourcePort, targetHandle: edge.targetPort, type: 'smoothstep', animated: true }))
const syncNodes = (project: ProjectFileV2, nodes: WorkbenchNode[]): ProjectFileV2 => ({ ...project, topology: { ...project.topology, nodes: nodes.map((flowNode) => ({ ...flowNode.data, position: flowNode.position })) } })
const syncEdges = (project: ProjectFileV2, edges: Edge[]): ProjectFileV2 => ({ ...project, topology: { ...project.topology, edges: edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, sourcePort: 'out' as const, targetPort: 'in' as const, weight: 1 })) } })
let nextNodeNumber = 1

export const useWorkbenchStore = create<WorkbenchState>((set, get) => ({
  project: createEmptyProject(), selectedNodeId: null, result: null, running: false, error: null,
  setProject: (input) => set({ project: parseProjectFile(input), selectedNodeId: null, result: null, error: null }),
  addComponent: (type, position) => set((state) => {
    const id = `${type}-${Date.now()}-${nextNodeNumber++}`
    const workloadId = `${id}-workload`
    const node = createRegisteredNode(type, id, position, workloadId)
    return {
      project: {
        ...state.project, topology: { ...state.project.topology, nodes: [...state.project.topology.nodes, node] },
        experiments: state.project.experiments.map((experiment) => type === 'traffic' ? { ...experiment, workloads: [...experiment.workloads, { id: workloadId, name: `${node.name} workload`, sourceNodeId: id, requestsPerSecond: 100, startAtSeconds: 0, durationSeconds: experiment.simulation.durationSeconds, pattern: 'poisson', requestBytes: 1_024 }] } : experiment),
      },
      selectedNodeId: id, result: null, error: null,
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
    return { project, selectedNodeId: state.selectedNodeId && removedIds.has(state.selectedNodeId) ? null : state.selectedNodeId, result: removedIds.size > 0 ? null : state.result }
  }),
  onEdgesChange: (changes) => set((state) => ({ project: syncEdges(state.project, applyEdgeChanges(changes, projectToEdges(state.project))), result: null })),
  connect: (connection) => set((state) => {
    const source = state.project.topology.nodes.find((node) => node.id === connection.source)
    const target = state.project.topology.nodes.find((node) => node.id === connection.target)
    const validation = componentRegistry.canConnect(source, target)
    if (!validation.valid || !connection.source || !connection.target) return { error: validation.reason ?? 'Invalid connection.' }
    if (state.project.topology.edges.some((edge) => edge.source === connection.source && edge.target === connection.target)) return { error: 'These components are already connected.' }
    const edges = addEdge({ ...connection, id: `edge-${crypto.randomUUID()}`, type: 'smoothstep', animated: true }, projectToEdges(state.project))
    return { project: syncEdges(state.project, edges), result: null, error: null }
  }),
  selectNode: (selectedNodeId) => set({ selectedNodeId }),
  updateSelectedNode: (updates) => set((state) => ({
    project: { ...state.project, topology: { ...state.project.topology, nodes: state.project.topology.nodes.map((node) => node.id === state.selectedNodeId ? { ...node, ...(updates.name === undefined ? {} : { name: updates.name }), config: { ...node.config, ...updates.config } } as ProjectNode : node) } },
    result: null, error: null,
  })),
  deleteSelectedNode: () => {
    const id = get().selectedNodeId
    if (!id) return
    set((state) => ({
      project: {
        ...state.project, topology: { ...state.project.topology, nodes: state.project.topology.nodes.filter((node) => node.id !== id), edges: state.project.topology.edges.filter((edge) => edge.source !== id && edge.target !== id) },
        experiments: state.project.experiments.map((experiment) => ({ ...experiment, workloads: experiment.workloads.filter((workload) => workload.sourceNodeId !== id), faults: experiment.faults.filter((fault) => fault.targetNodeId !== id) })),
      },
      selectedNodeId: null, result: null, error: null,
    }))
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
