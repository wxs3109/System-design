import { beforeEach, describe, expect, it } from 'vitest'
import { createEmptyProject, createOrderSystemContractFixture, projectFileV3Schema, type SimulationResult } from '@system-design/model'
import { createRegisteredNode } from '@system-design/components'
import { createWorkbenchStore, projectToEdges, redoProject, undoProject, type WorkbenchStore } from './store'

const emptyResult: SimulationResult = {
  runId: 'run', scenarioId: 'history-project', seed: 'seed', simulatedDurationMs: 1, wallClockDurationMs: 1,
  summary: { generatedRequests: 0, completedRequests: 0, failedRequests: 0, throughputPerSecond: 0, errorRate: 0, latencyP50Ms: 0, latencyP95Ms: 0, latencyP99Ms: 0 },
  nodes: [], operations: [], actions: [], timeSeries: [], traces: [], events: [], spans: [], warnings: [],
}

let store: WorkbenchStore

beforeEach(() => {
  store = createWorkbenchStore()
})

describe('workbench store isolation', () => {
  it('owns independent edits, selection, runtime state and undo history', () => {
    const project = createOrderSystemContractFixture()
    const first = createWorkbenchStore(project)
    const second = createWorkbenchStore(project)
    first.getState().selectNode('orders-service')
    first.getState().updateSelectedNode({ name: 'First attempt API' })
    first.getState().setRunning(true)
    first.getState().setResult(emptyResult)
    first.getState().setError('First attempt error')
    second.getState().selectEdge('client-to-orders')
    second.getState().updateSelectedEdge({ name: 'Second attempt edge' })
    const secondProject = structuredClone(second.getState().project)

    expect(first.getState().selectedEdgeId).toBeNull()
    expect(second.getState()).toMatchObject({ selectedNodeId: null, selectedEdgeId: 'client-to-orders', running: false, result: null, error: null })
    expect(second.getState().project.topology.nodes.find((node) => node.id === 'orders-service')?.name).not.toBe('First attempt API')
    expect(first.temporal.getState().pastStates).toHaveLength(1)
    expect(second.temporal.getState().pastStates).toHaveLength(1)

    undoProject(first)
    expect(first.getState().project).toEqual(project)
    expect(first.getState().result).toBeNull()
    expect(second.getState().project).toEqual(secondProject)
    expect(second.temporal.getState().pastStates).toHaveLength(1)
    expect(second.temporal.getState().futureStates).toHaveLength(0)
    redoProject(first)
    expect(first.getState().project.topology.nodes.find((node) => node.id === 'orders-service')?.name).toBe('First attempt API')
    expect(second.getState().project).toEqual(secondProject)
  })

  it('restores only the target store and clears only its undo and redo history', () => {
    const first = createWorkbenchStore()
    const second = createWorkbenchStore()
    first.getState().updateMeta({ seed: 'first' })
    second.getState().updateMeta({ seed: 'second' })
    second.getState().updateMeta({ seed: 'second-next' })
    undoProject(second)
    const secondProject = structuredClone(second.getState().project)
    const restored = createEmptyProject('restored')

    first.getState().restoreProject(restored)

    expect(first.getState().project).toEqual(restored)
    expect(first.temporal.getState().pastStates).toHaveLength(0)
    expect(first.temporal.getState().futureStates).toHaveLength(0)
    expect(second.getState().project).toEqual(secondProject)
    expect(second.temporal.getState().pastStates).toHaveLength(1)
    expect(second.temporal.getState().futureStates).toHaveLength(1)
    redoProject(second)
    expect(second.getState().project.experiments[0]?.seed).toBe('second-next')
  })

  it('copies and validates initial projects without sharing nested references', () => {
    const project = createOrderSystemContractFixture()
    const first = createWorkbenchStore(project)
    const second = createWorkbenchStore(project)
    const originalProject = structuredClone(project)

    project.topology.nodes[0]!.name = 'Changed outside the store'
    project.definitions.apis[0]!.operations[0]!.handlerTimeMs = 999

    expect(first.getState().project).toEqual(originalProject)
    expect(second.getState().project).toEqual(originalProject)
    expect(first.getState().project.topology.nodes[0]).not.toBe(second.getState().project.topology.nodes[0])
    expect(first.getState().project.definitions.apis[0]!.operations[0]).not.toBe(second.getState().project.definitions.apis[0]!.operations[0])
    expect(first.temporal.getState().pastStates).toHaveLength(0)
    expect(second.temporal.getState().pastStates).toHaveLength(0)

    project.definitions.apis[0]!.ownerNodeId = 'missing-service'
    expect(() => createWorkbenchStore(project)).toThrow('Unknown topology node: missing-service')
  })
})

describe('validated project undo and redo', () => {
  it('commits valid definition edits into project history and rejects invalid references without changing state', () => {
    const project = createOrderSystemContractFixture()
    store.getState().restoreProject(project)
    const edited = structuredClone(project)
    edited.definitions.apis[0]!.operations[0]!.handlerTimeMs = 12

    expect(store.getState().commitProjectEdit(edited)).toEqual({ success: true })
    expect(store.getState().project.definitions.apis[0]!.operations[0]!.handlerTimeMs).toBe(12)
    expect(store.temporal.getState().pastStates).toHaveLength(1)

    const invalid = structuredClone(store.getState().project)
    invalid.definitions.apis[0]!.ownerNodeId = 'missing-service'
    const before = structuredClone(store.getState().project)
    const result = store.getState().commitProjectEdit(invalid)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.issues).toContainEqual(expect.objectContaining({
      path: ['definitions', 'apis', 0, 'ownerNodeId'],
      message: 'Unknown topology node: missing-service',
    }))
    expect(store.getState().project).toEqual(before)

    undoProject(store)
    expect(store.getState().project).toEqual(project)
    redoProject(store)
    expect(store.getState().project.definitions.apis[0]!.operations[0]!.handlerTimeMs).toBe(12)
  })

  it('restores the exact project revision and clears stale results', () => {
    const project = createEmptyProject('history-project')
    store.getState().restoreProject(project)
    const before = structuredClone(store.getState().project)
    store.getState().updateMeta({ seed: 'changed-seed' })
    const after = structuredClone(store.getState().project)
    store.getState().setResult(emptyResult)

    undoProject(store)
    expect(store.getState().project).toEqual(before)
    expect(store.getState().result).toBeNull()
    expect(() => projectFileV3Schema.parse(store.getState().project)).not.toThrow()

    redoProject(store)
    expect(store.getState().project).toEqual(after)
    expect(() => projectFileV3Schema.parse(store.getState().project)).not.toThrow()
  })

  it('starts restored sessions with an empty undo stack', () => {
    store.getState().updateMeta({ seed: 'first-change' })
    expect(store.temporal.getState().pastStates).not.toHaveLength(0)
    store.getState().restoreProject(createEmptyProject('restored-project'))
    expect(store.temporal.getState().pastStates).toHaveLength(0)
    expect(store.temporal.getState().futureStates).toHaveLength(0)
  })

  it('keeps regions, node membership, group faults and undo history consistent', () => {
    const project = createEmptyProject('regions')
    project.topology.nodes = [{ id: 'api', name: 'API', type: 'service', componentVersion: 1, position: { x: 0, y: 0 }, config: { replicas: 1, concurrencyPerReplica: 1, serviceTimeMs: 1, jitterMs: 0, errorRate: 0, maxQueueSize: 1 } }]
    store.getState().restoreProject(project)
    store.getState().selectNode('api')
    store.getState().addRegion('region')
    const region = store.getState().project.topology.groups[0]!
    expect(region.nodeIds).toEqual(['api'])

    const withFault = structuredClone(store.getState().project)
    withFault.experiments[0]!.faults = [{ id: 'outage', type: 'region-outage', target: { kind: 'group', id: region.id }, startAtSeconds: 1, durationSeconds: 2, enabled: true }]
    store.getState().setProject(withFault)
    store.getState().deleteRegion(region.id)
    expect(store.getState().project.topology.groups).toEqual([])
    expect(store.getState().project.experiments[0]!.faults).toEqual([])
    undoProject(store)
    expect(store.getState().project.topology.groups).toHaveLength(1)
    expect(store.getState().project.experiments[0]!.faults).toHaveLength(1)
  })

  it('removes a deleted node from every region membership', () => {
    const project = createEmptyProject('region-membership')
    project.topology.nodes = [{ id: 'api', name: 'API', type: 'service', componentVersion: 1, position: { x: 0, y: 0 }, config: { replicas: 1, concurrencyPerReplica: 1, serviceTimeMs: 1, jitterMs: 0, errorRate: 0, maxQueueSize: 1 } }]
    project.topology.groups = [{ id: 'west', name: 'West', kind: 'region', nodeIds: ['api'] }]
    store.getState().restoreProject(project)
    store.getState().selectNode('api')
    store.getState().deleteSelectedNode()
    expect(store.getState().project.topology.groups[0]?.nodeIds).toEqual([])
    expect(() => projectFileV3Schema.parse(store.getState().project)).not.toThrow()
  })

  it('rejects deleting a topology node that is still owned or used by a business definition', () => {
    const project = createOrderSystemContractFixture()
    store.getState().restoreProject(project)
    store.getState().selectNode('orders-service')
    store.getState().deleteSelectedNode()

    expect(store.getState().project).toEqual(project)
    expect(store.getState().error).toMatch(/Unknown topology node: orders-service/)
    expect(store.getState().selectedNodeId).toBe('orders-service')
  })

  it('adds a role preset as a resolved behavior with stable preset identity', () => {
    store.getState().addRolePreset('worker', 1, { x: 10, y: 20 })
    const node = store.getState().project.topology.nodes[0]!
    expect(node).toMatchObject({ name: 'Worker', type: 'service', componentVersion: 1, rolePreset: { id: 'worker', version: 1 }, config: { replicas: 4, concurrencyPerReplica: 1 } })
    expect(() => projectFileV3Schema.parse(store.getState().project)).not.toThrow()
  })

  it('creates a variant and nested preset through its component category', () => {
    store.getState().addCatalogComponent('service', 'service', { x: 10, y: 20 }, { id: 'worker', version: 1 })
    expect(store.getState().project.topology.nodes[0]).toMatchObject({
      name: 'Worker', type: 'service', componentVersion: 1, rolePreset: { id: 'worker', version: 1 },
    })
    expect(() => store.getState().addCatalogComponent('database', 'service', { x: 0, y: 0 })).toThrow('does not belong to category database')
    expect(() => store.getState().addCatalogComponent('database', 'database', { x: 0, y: 0 }, { id: 'sql-store', version: 1 })).toThrow('retained for compatibility')
    expect(() => store.getState().addRolePreset('sql-store', 1, { x: 0, y: 0 })).toThrow('cannot create new components')
  })

  it('adds a Client preset with the normal Traffic Generator workload contract', () => {
    store.getState().addRolePreset('client', 1, { x: 0, y: 0 })
    const project = store.getState().project
    expect(project.topology.nodes[0]).toMatchObject({ name: 'Client', type: 'traffic', rolePreset: { id: 'client', version: 1 } })
    expect(project.experiments[0]!.workloads[0]).toMatchObject({ sourceNodeId: project.topology.nodes[0]!.id, name: 'Client workload' })
  })

  it('pastes a component with a new identity, copied configuration, and no copied connections', () => {
    const project = createEmptyProject('paste-component')
    project.topology.nodes = [createRegisteredNode('scheduler', 'due-scan', { x: 10, y: 20 })]
    store.getState().restoreProject(project)

    store.getState().pasteComponent(project.topology.nodes[0]!, { x: 50, y: 70 }, 'Due scan copy')

    const pasted = store.getState().project.topology.nodes[1]!
    expect(pasted).toMatchObject({ name: 'Due scan copy', type: 'scheduler', position: { x: 50, y: 70 }, config: project.topology.nodes[0]!.config })
    expect(pasted.id).not.toBe('due-scan')
    expect(store.getState().project.topology.edges).toEqual([])
    expect(store.getState().selectedNodeId).toBe(pasted.id)
    expect(() => projectFileV3Schema.parse(store.getState().project)).not.toThrow()
  })

  it('edits and renders an optional connection name alongside its routing semantics', () => {
    const project = createOrderSystemContractFixture()
    store.getState().restoreProject(project)
    store.getState().selectEdge('client-to-orders')
    store.getState().updateSelectedEdge({ name: 'Submit order' })

    const updated = store.getState().project
    expect(updated.topology.edges.find((edge) => edge.id === 'client-to-orders')?.name).toBe('Submit order')
    expect(projectToEdges(updated).find((edge) => edge.id === 'client-to-orders')?.label).toBe('Submit order')
    expect(() => projectFileV3Schema.parse(updated)).not.toThrow()
  })

  it('keeps the completed result when React Flow reports an edge selection change', () => {
    const project = createOrderSystemContractFixture()
    store.getState().restoreProject(project)
    store.getState().setResult(emptyResult)
    store.getState().onEdgesChange([{ id: 'client-to-orders', type: 'select', selected: true }])
    expect(store.getState().result).toEqual(emptyResult)
    expect(store.getState().project).toEqual(project)
  })

  it('applies a complete node layout as one undoable edit without clearing results', () => {
    const project = createOrderSystemContractFixture()
    store.getState().restoreProject(project)
    store.getState().setResult(emptyResult)
    const positions = Object.fromEntries(project.topology.nodes.map((node, index) => [node.id, { x: index * 250, y: index * 100 }]))
    store.getState().applyNodeLayout(positions)

    expect(store.getState().project.topology.nodes.map((node) => node.position)).toEqual(Object.values(positions))
    expect(store.getState().result).toEqual(emptyResult)
    undoProject(store)
    expect(store.getState().project.topology.nodes.map((node) => node.position)).toEqual(project.topology.nodes.map((node) => node.position))
  })

  it('creates an independent workload when pasting a traffic component', () => {
    store.getState().addRolePreset('client', 1, { x: 0, y: 0 })
    const source = store.getState().project.topology.nodes[0]!

    store.getState().pasteComponent(source, { x: 40, y: 40 })

    const project = store.getState().project
    const pasted = project.topology.nodes[1]!
    expect(pasted.type).toBe('traffic')
    if (pasted.type !== 'traffic') throw new Error('Expected pasted traffic component.')
    expect(pasted.config.workloadId).not.toBe((source.config as { workloadId: string }).workloadId)
    expect(project.experiments[0]!.workloads).toContainEqual(expect.objectContaining({ id: pasted.config.workloadId, sourceNodeId: pasted.id }))
    expect(() => projectFileV3Schema.parse(project)).not.toThrow()
  })

  it('skips Scheduler for default faults and rejects unsupported Scheduler node policies', () => {
    const project = createEmptyProject('scheduler-controls')
    project.topology.nodes = [
      createRegisteredNode('scheduler', 'scheduler', { x: 0, y: 0 }),
      createRegisteredNode('service', 'service', { x: 100, y: 0 }),
    ]
    store.getState().restoreProject(project)
    store.getState().addFault()
    expect(store.getState().project.experiments[0]!.faults[0]?.target).toEqual({ kind: 'node', id: 'service' })

    store.getState().attachPolicy({ kind: 'node', id: 'scheduler' }, 'rate-limit', 1)
    expect(store.getState().project.topology.policies).toEqual([])
    expect(store.getState().error).toContain('Scheduler does not support Rate Limit')
  })

  it('runs an unknown preset as its resolved behavior but rejects a known mismatched preset', () => {
    const project = createEmptyProject('invalid-preset')
    project.topology.nodes = [{ id: 'worker', name: 'Worker', type: 'service', componentVersion: 1, rolePreset: { id: 'missing', version: 1 }, position: { x: 0, y: 0 }, config: { replicas: 1, concurrencyPerReplica: 1, serviceTimeMs: 1, jitterMs: 0, errorRate: 0, maxQueueSize: 1 } }]
    expect(() => store.getState().setProject(project)).not.toThrow()
    expect(store.getState().project.topology.nodes[0]).toMatchObject({ type: 'service', rolePreset: { id: 'missing', version: 1 } })
    project.topology.nodes[0]!.rolePreset = { id: 'api-gateway', version: 1 }
    expect(() => store.getState().setProject(project)).toThrow('requires load-balancer@1')
  })
})
