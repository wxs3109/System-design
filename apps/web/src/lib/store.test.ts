import { afterEach, describe, expect, it } from 'vitest'
import { createEmptyProject, projectFileV2Schema, type SimulationResult } from '@system-design/model'
import { redoProject, undoProject, useWorkbenchStore } from './store'

const emptyResult: SimulationResult = {
  runId: 'run', scenarioId: 'history-project', seed: 'seed', simulatedDurationMs: 1, wallClockDurationMs: 1,
  summary: { generatedRequests: 0, completedRequests: 0, failedRequests: 0, throughputPerSecond: 0, errorRate: 0, latencyP50Ms: 0, latencyP95Ms: 0, latencyP99Ms: 0 },
  nodes: [], timeSeries: [], traces: [], events: [], spans: [], warnings: [],
}

afterEach(() => {
  useWorkbenchStore.getState().restoreProject(createEmptyProject())
})

describe('validated project undo and redo', () => {
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
    expect(() => projectFileV2Schema.parse(useWorkbenchStore.getState().project)).not.toThrow()

    redoProject()
    expect(useWorkbenchStore.getState().project).toEqual(after)
    expect(() => projectFileV2Schema.parse(useWorkbenchStore.getState().project)).not.toThrow()
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
    expect(() => projectFileV2Schema.parse(useWorkbenchStore.getState().project)).not.toThrow()
  })
})
