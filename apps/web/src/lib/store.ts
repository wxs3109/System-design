'use client'

import { addEdge, applyEdgeChanges, applyNodeChanges, type Connection as FlowConnection, type Edge, type EdgeChange, type Node, type NodeChange } from '@xyflow/react'
import { canConnect, createEmptyScenario, createNode, scenarioSchema, type ComponentNode, type ComponentType, type Scenario, type SimulationResult } from '@system-design/model'
import { create } from 'zustand'

export type WorkbenchNode = Node<ComponentNode, 'component'>

interface WorkbenchState {
  scenario: Scenario
  selectedNodeId: string | null
  result: SimulationResult | null
  running: boolean
  error: string | null
  setScenario: (scenario: Scenario) => void
  addComponent: (type: ComponentType, position: { x: number; y: number }) => void
  onNodesChange: (changes: NodeChange<WorkbenchNode>[]) => void
  onEdgesChange: (changes: EdgeChange<Edge>[]) => void
  connect: (connection: FlowConnection) => void
  selectNode: (nodeId: string | null) => void
  updateSelectedNode: (updates: { name?: string; config?: Record<string, number | string> }) => void
  deleteSelectedNode: () => void
  updateSimulation: (updates: Partial<Scenario['simulation']>) => void
  updateWorkload: (updates: { requestsPerSecond?: number; pattern?: 'constant' | 'poisson' }) => void
  updateMeta: (updates: Pick<Scenario, 'seed'>) => void
  setRunning: (running: boolean) => void
  setResult: (result: SimulationResult | null) => void
  setError: (error: string | null) => void
}

const scenarioToNodes = (scenario: Scenario): WorkbenchNode[] => scenario.nodes.map((node) => ({
  id: node.id, type: 'component', position: node.position, data: node, selected: false,
}))

const scenarioToEdges = (scenario: Scenario): Edge[] => scenario.edges.map((edge) => ({
  id: edge.id, source: edge.source, target: edge.target, sourceHandle: edge.sourcePort, targetHandle: edge.targetPort,
  type: 'smoothstep', animated: true,
}))

const syncNodes = (scenario: Scenario, nodes: WorkbenchNode[]) => ({
  ...scenario,
  nodes: nodes.map((flowNode) => ({ ...flowNode.data, position: flowNode.position })),
})

const syncEdges = (scenario: Scenario, edges: Edge[]) => ({
  ...scenario,
  edges: edges.map((edge) => ({
    id: edge.id, source: edge.source, target: edge.target, sourcePort: 'out' as const, targetPort: 'in' as const, weight: 1,
  })),
})

let nextNodeNumber = 1

export const useWorkbenchStore = create<WorkbenchState>((set, get) => ({
  scenario: createEmptyScenario(),
  selectedNodeId: null,
  result: null,
  running: false,
  error: null,
  setScenario: (scenario) => set({ scenario: scenarioSchema.parse(scenario), selectedNodeId: null, result: null, error: null }),
  addComponent: (type, position) => set((state) => {
    const id = `${type}-${Date.now()}-${nextNodeNumber++}`
    const workloadId = `${id}-workload`
    const node = createNode(type, id, position, workloadId)
    return {
      scenario: {
        ...state.scenario,
        nodes: [...state.scenario.nodes, node],
        workloads: type === 'traffic' ? [...state.scenario.workloads, {
          id: workloadId, name: `${node.name} workload`, sourceNodeId: id, requestsPerSecond: 100,
          startAtSeconds: 0, durationSeconds: state.scenario.simulation.durationSeconds, pattern: 'poisson', requestBytes: 1_024,
        }] : state.scenario.workloads,
      },
      selectedNodeId: id, result: null, error: null,
    }
  }),
  onNodesChange: (changes) => set((state) => {
    const nextNodes = applyNodeChanges(changes, scenarioToNodes(state.scenario))
    const removedIds = new Set(state.scenario.nodes.filter((node) => !nextNodes.some((next) => next.id === node.id)).map((node) => node.id))
    let scenario = syncNodes(state.scenario, nextNodes)
    if (removedIds.size > 0) {
      scenario = {
        ...scenario,
        edges: scenario.edges.filter((edge) => !removedIds.has(edge.source) && !removedIds.has(edge.target)),
        workloads: scenario.workloads.filter((workload) => !removedIds.has(workload.sourceNodeId)),
        faults: scenario.faults.filter((fault) => !removedIds.has(fault.targetNodeId)),
      }
    }
    return {
      scenario,
      selectedNodeId: state.selectedNodeId && removedIds.has(state.selectedNodeId) ? null : state.selectedNodeId,
      result: removedIds.size > 0 ? null : state.result,
    }
  }),
  onEdgesChange: (changes) => set((state) => ({
    scenario: syncEdges(state.scenario, applyEdgeChanges(changes, scenarioToEdges(state.scenario))), result: null,
  })),
  connect: (connection) => set((state) => {
    const source = state.scenario.nodes.find((node) => node.id === connection.source)
    const target = state.scenario.nodes.find((node) => node.id === connection.target)
    const validation = canConnect(source, target)
    if (!validation.valid || !connection.source || !connection.target) return { error: validation.reason ?? 'Invalid connection.' }
    if (state.scenario.edges.some((edge) => edge.source === connection.source && edge.target === connection.target)) return { error: 'These components are already connected.' }
    const edges = addEdge({ ...connection, id: `edge-${crypto.randomUUID()}`, type: 'smoothstep', animated: true }, scenarioToEdges(state.scenario))
    return { scenario: syncEdges(state.scenario, edges), result: null, error: null }
  }),
  selectNode: (selectedNodeId) => set({ selectedNodeId }),
  updateSelectedNode: (updates) => set((state) => ({
    scenario: {
      ...state.scenario,
      nodes: state.scenario.nodes.map((node) => node.id === state.selectedNodeId
        ? { ...node, ...(updates.name === undefined ? {} : { name: updates.name }), config: { ...node.config, ...updates.config } } as ComponentNode
        : node),
    },
    result: null, error: null,
  })),
  deleteSelectedNode: () => {
    const id = get().selectedNodeId
    if (!id) return
    set((state) => ({
      scenario: {
        ...state.scenario,
        nodes: state.scenario.nodes.filter((node) => node.id !== id),
        edges: state.scenario.edges.filter((edge) => edge.source !== id && edge.target !== id),
        workloads: state.scenario.workloads.filter((workload) => workload.sourceNodeId !== id),
        faults: state.scenario.faults.filter((fault) => fault.targetNodeId !== id),
      },
      selectedNodeId: null, result: null, error: null,
    }))
  },
  updateSimulation: (updates) => set((state) => ({
    scenario: {
      ...state.scenario,
      simulation: { ...state.scenario.simulation, ...updates },
      workloads: state.scenario.workloads.map((workload) => ({ ...workload, durationSeconds: updates.durationSeconds ?? workload.durationSeconds })),
    },
    result: null,
  })),
  updateWorkload: (updates) => set((state) => {
    const selected = state.scenario.nodes.find((node) => node.id === state.selectedNodeId)
    if (!selected || selected.type !== 'traffic') return {}
    return {
      scenario: {
        ...state.scenario,
        workloads: state.scenario.workloads.map((workload) => workload.id === selected.config.workloadId ? { ...workload, ...updates } : workload),
      },
      result: null,
    }
  }),
  updateMeta: (updates) => set((state) => ({ scenario: { ...state.scenario, ...updates }, result: null })),
  setRunning: (running) => set({ running }),
  setResult: (result) => set({ result }),
  setError: (error) => set({ error }),
}))

export { scenarioToEdges, scenarioToNodes }
