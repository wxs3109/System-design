import { afterEach, describe, expect, it } from 'vitest'
import { createEmptyProject, createOrderSystemContractFixture, projectFileV3Schema, type SimulationResult } from '@system-design/model'
import { createRegisteredNode } from '@system-design/components'
import { redoProject, undoProject, useWorkbenchStore } from './store'

const emptyResult: SimulationResult = {
  runId: 'run', scenarioId: 'history-project', seed: 'seed', simulatedDurationMs: 1, wallClockDurationMs: 1,
  summary: { generatedRequests: 0, completedRequests: 0, failedRequests: 0, throughputPerSecond: 0, errorRate: 0, latencyP50Ms: 0, latencyP95Ms: 0, latencyP99Ms: 0 },
  nodes: [], operations: [], actions: [], timeSeries: [], traces: [], events: [], spans: [], warnings: [],
}

afterEach(() => {
  useWorkbenchStore.getState().restoreProject(createEmptyProject())
})

describe('validated project undo and redo', () => {
  it('commits valid definition edits into project history and rejects invalid references without changing state', () => {
    const project = createOrderSystemContractFixture()
    useWorkbenchStore.getState().restoreProject(project)
    const edited = structuredClone(project)
    edited.definitions.apis[0]!.operations[0]!.handlerTimeMs = 12

    expect(useWorkbenchStore.getState().commitProjectEdit(edited)).toEqual({ success: true })
    expect(useWorkbenchStore.getState().project.definitions.apis[0]!.operations[0]!.handlerTimeMs).toBe(12)
    expect(useWorkbenchStore.temporal.getState().pastStates).toHaveLength(1)

    const invalid = structuredClone(useWorkbenchStore.getState().project)
    invalid.definitions.apis[0]!.ownerNodeId = 'missing-service'
    const before = structuredClone(useWorkbenchStore.getState().project)
    const result = useWorkbenchStore.getState().commitProjectEdit(invalid)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.issues).toContainEqual(expect.objectContaining({
      path: ['definitions', 'apis', 0, 'ownerNodeId'],
      message: 'Unknown topology node: missing-service',
    }))
    expect(useWorkbenchStore.getState().project).toEqual(before)

    undoProject()
    expect(useWorkbenchStore.getState().project).toEqual(project)
    redoProject()
    expect(useWorkbenchStore.getState().project.definitions.apis[0]!.operations[0]!.handlerTimeMs).toBe(12)
  })

  it('restores the exact project revision and clears stale results', () => {
    const project = createEmptyProject('history-project')
    useWorkbenchStore.getState().restoreProject(project)
    const before = structuredClone(useWorkbenchStore.getState().project)
    useWorkbenchStore.getState().updateMeta({ seed: 'changed-seed' })
    const after = structuredClone(useWorkbenchStore.getState().project)
    useWorkbenchStore.getState().setResult(emptyResult)

    undoProject()
    expect(useWorkbenchStore.getState().project).toEqual(before)
    expect(useWorkbenchStore.getState().result).toBeNull()
    expect(() => projectFileV3Schema.parse(useWorkbenchStore.getState().project)).not.toThrow()

    redoProject()
    expect(useWorkbenchStore.getState().project).toEqual(after)
    expect(() => projectFileV3Schema.parse(useWorkbenchStore.getState().project)).not.toThrow()
  })

  it('starts restored sessions with an empty undo stack', () => {
    useWorkbenchStore.getState().updateMeta({ seed: 'first-change' })
    expect(useWorkbenchStore.temporal.getState().pastStates).not.toHaveLength(0)
    useWorkbenchStore.getState().restoreProject(createEmptyProject('restored-project'))
    expect(useWorkbenchStore.temporal.getState().pastStates).toHaveLength(0)
    expect(useWorkbenchStore.temporal.getState().futureStates).toHaveLength(0)
  })

  it('keeps regions, node membership, group faults and undo history consistent', () => {
    const project = createEmptyProject('regions')
    project.topology.nodes = [{ id: 'api', name: 'API', type: 'service', componentVersion: 1, position: { x: 0, y: 0 }, config: { replicas: 1, concurrencyPerReplica: 1, serviceTimeMs: 1, jitterMs: 0, errorRate: 0, maxQueueSize: 1 } }]
    useWorkbenchStore.getState().restoreProject(project)
    useWorkbenchStore.getState().selectNode('api')
    useWorkbenchStore.getState().addRegion('region')
    const region = useWorkbenchStore.getState().project.topology.groups[0]!
    expect(region.nodeIds).toEqual(['api'])

    const withFault = structuredClone(useWorkbenchStore.getState().project)
    withFault.experiments[0]!.faults = [{ id: 'outage', type: 'region-outage', target: { kind: 'group', id: region.id }, startAtSeconds: 1, durationSeconds: 2, enabled: true }]
    useWorkbenchStore.getState().setProject(withFault)
    useWorkbenchStore.getState().deleteRegion(region.id)
    expect(useWorkbenchStore.getState().project.topology.groups).toEqual([])
    expect(useWorkbenchStore.getState().project.experiments[0]!.faults).toEqual([])
    undoProject()
    expect(useWorkbenchStore.getState().project.topology.groups).toHaveLength(1)
    expect(useWorkbenchStore.getState().project.experiments[0]!.faults).toHaveLength(1)
  })

  it('removes a deleted node from every region membership', () => {
    const project = createEmptyProject('region-membership')
    project.topology.nodes = [{ id: 'api', name: 'API', type: 'service', componentVersion: 1, position: { x: 0, y: 0 }, config: { replicas: 1, concurrencyPerReplica: 1, serviceTimeMs: 1, jitterMs: 0, errorRate: 0, maxQueueSize: 1 } }]
    project.topology.groups = [{ id: 'west', name: 'West', kind: 'region', nodeIds: ['api'] }]
    useWorkbenchStore.getState().restoreProject(project)
    useWorkbenchStore.getState().selectNode('api')
    useWorkbenchStore.getState().deleteSelectedNode()
    expect(useWorkbenchStore.getState().project.topology.groups[0]?.nodeIds).toEqual([])
    expect(() => projectFileV3Schema.parse(useWorkbenchStore.getState().project)).not.toThrow()
  })

  it('rejects deleting a topology node that is still owned or used by a business definition', () => {
    const project = createOrderSystemContractFixture()
    useWorkbenchStore.getState().restoreProject(project)
    useWorkbenchStore.getState().selectNode('orders-service')
    useWorkbenchStore.getState().deleteSelectedNode()

    expect(useWorkbenchStore.getState().project).toEqual(project)
    expect(useWorkbenchStore.getState().error).toMatch(/Unknown topology node: orders-service/)
    expect(useWorkbenchStore.getState().selectedNodeId).toBe('orders-service')
  })

  it('adds a role preset as a resolved behavior with stable preset identity', () => {
    useWorkbenchStore.getState().addRolePreset('worker', 1, { x: 10, y: 20 })
    const node = useWorkbenchStore.getState().project.topology.nodes[0]!
    expect(node).toMatchObject({ name: 'Worker', type: 'service', componentVersion: 1, rolePreset: { id: 'worker', version: 1 }, config: { replicas: 4, concurrencyPerReplica: 1 } })
    expect(() => projectFileV3Schema.parse(useWorkbenchStore.getState().project)).not.toThrow()
  })

  it('creates a variant and nested preset through its component category', () => {
    useWorkbenchStore.getState().addCatalogComponent('service', 'service', { x: 10, y: 20 }, { id: 'worker', version: 1 })
    expect(useWorkbenchStore.getState().project.topology.nodes[0]).toMatchObject({
      name: 'Worker', type: 'service', componentVersion: 1, rolePreset: { id: 'worker', version: 1 },
    })
    expect(() => useWorkbenchStore.getState().addCatalogComponent('database', 'service', { x: 0, y: 0 })).toThrow('does not belong to category database')
    expect(() => useWorkbenchStore.getState().addCatalogComponent('database', 'database', { x: 0, y: 0 }, { id: 'sql-store', version: 1 })).toThrow('retained for compatibility')
    expect(() => useWorkbenchStore.getState().addRolePreset('sql-store', 1, { x: 0, y: 0 })).toThrow('cannot create new components')
  })

  it('adds a Client preset with the normal Traffic Generator workload contract', () => {
    useWorkbenchStore.getState().addRolePreset('client', 1, { x: 0, y: 0 })
    const project = useWorkbenchStore.getState().project
    expect(project.topology.nodes[0]).toMatchObject({ name: 'Client', type: 'traffic', rolePreset: { id: 'client', version: 1 } })
    expect(project.experiments[0]!.workloads[0]).toMatchObject({ sourceNodeId: project.topology.nodes[0]!.id, name: 'Client workload' })
  })

  it('pastes a component with a new identity, copied configuration, and no copied connections', () => {
    const project = createEmptyProject('paste-component')
    project.topology.nodes = [createRegisteredNode('scheduler', 'due-scan', { x: 10, y: 20 })]
    useWorkbenchStore.getState().restoreProject(project)

    useWorkbenchStore.getState().pasteComponent(project.topology.nodes[0]!, { x: 50, y: 70 }, 'Due scan copy')

    const pasted = useWorkbenchStore.getState().project.topology.nodes[1]!
    expect(pasted).toMatchObject({ name: 'Due scan copy', type: 'scheduler', position: { x: 50, y: 70 }, config: project.topology.nodes[0]!.config })
    expect(pasted.id).not.toBe('due-scan')
    expect(useWorkbenchStore.getState().project.topology.edges).toEqual([])
    expect(useWorkbenchStore.getState().selectedNodeId).toBe(pasted.id)
    expect(() => projectFileV3Schema.parse(useWorkbenchStore.getState().project)).not.toThrow()
  })

  it('creates an independent workload when pasting a traffic component', () => {
    useWorkbenchStore.getState().addRolePreset('client', 1, { x: 0, y: 0 })
    const source = useWorkbenchStore.getState().project.topology.nodes[0]!

    useWorkbenchStore.getState().pasteComponent(source, { x: 40, y: 40 })

    const project = useWorkbenchStore.getState().project
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
    useWorkbenchStore.getState().restoreProject(project)
    useWorkbenchStore.getState().addFault()
    expect(useWorkbenchStore.getState().project.experiments[0]!.faults[0]?.target).toEqual({ kind: 'node', id: 'service' })

    useWorkbenchStore.getState().attachPolicy({ kind: 'node', id: 'scheduler' }, 'rate-limit', 1)
    expect(useWorkbenchStore.getState().project.topology.policies).toEqual([])
    expect(useWorkbenchStore.getState().error).toContain('Scheduler does not support Rate Limit')
  })

  it('runs an unknown preset as its resolved behavior but rejects a known mismatched preset', () => {
    const project = createEmptyProject('invalid-preset')
    project.topology.nodes = [{ id: 'worker', name: 'Worker', type: 'service', componentVersion: 1, rolePreset: { id: 'missing', version: 1 }, position: { x: 0, y: 0 }, config: { replicas: 1, concurrencyPerReplica: 1, serviceTimeMs: 1, jitterMs: 0, errorRate: 0, maxQueueSize: 1 } }]
    expect(() => useWorkbenchStore.getState().setProject(project)).not.toThrow()
    expect(useWorkbenchStore.getState().project.topology.nodes[0]).toMatchObject({ type: 'service', rolePreset: { id: 'missing', version: 1 } })
    project.topology.nodes[0]!.rolePreset = { id: 'api-gateway', version: 1 }
    expect(() => useWorkbenchStore.getState().setProject(project)).toThrow('requires load-balancer@1')
  })
})
