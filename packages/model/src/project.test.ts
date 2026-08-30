import { describe, expect, it } from 'vitest'
import {
  UnsupportedProjectVersionError,
  createEmptyScenario,
  createNode,
  migrateScenarioV1ToProjectV2,
  parseProjectFile,
  projectFileV2Schema,
  projectToScenario,
  setActiveExperiment,
} from './index'

const scenarioV1 = () => {
  const scenario = createEmptyScenario('migration-source')
  scenario.name = 'Migration source'
  scenario.seed = 'stable-seed'
  const traffic = createNode('traffic', 'traffic', { x: 1, y: 2 }, 'workload')
  const service = createNode('service', 'service', { x: 3, y: 4 })
  scenario.nodes.push(traffic, service)
  scenario.edges.push({ id: 'edge', source: 'traffic', target: 'service', sourcePort: 'out', targetPort: 'in', weight: 1 })
  scenario.workloads.push({ id: 'workload', name: 'Load', sourceNodeId: 'traffic', requestsPerSecond: 25, startAtSeconds: 0, durationSeconds: 10, pattern: 'constant', requestBytes: 512 })
  scenario.faults.push({ id: 'fault', targetNodeId: 'service', type: 'capacity-drop', startAtSeconds: 2, durationSeconds: 3, factor: 0.5, enabled: true })
  return scenario
}

describe('ProjectFile v2', () => {
  it('migrates Scenario v1 deterministically without semantic loss', () => {
    const source = scenarioV1()
    const first = migrateScenarioV1ToProjectV2(source)
    const second = parseProjectFile(JSON.parse(JSON.stringify(source)))
    expect(second).toEqual(first)
    expect(projectToScenario(first)).toEqual(source)
    expect(first.topology.nodes.every((node) => node.componentVersion === 1)).toBe(true)
    expect(first.topology.nodes[0]!.config).toEqual({})
  })

  it('round-trips a valid v2 project', () => {
    const project = migrateScenarioV1ToProjectV2(scenarioV1())
    expect(parseProjectFile(JSON.parse(JSON.stringify(project)))).toEqual(project)
    expect(projectFileV2Schema.parse(project)).toEqual(project)
    expect(project.topology.edges[0]).toMatchObject({ routingMode: 'weighted-one', sourceSemantic: 'request', targetSemantic: 'request' })
  })

  it('round-trips optional role preset metadata without changing behavior identity', () => {
    const project = migrateScenarioV1ToProjectV2(scenarioV1())
    const service = project.topology.nodes.find((node) => node.id === 'service')!
    service.rolePreset = { id: 'worker', version: 1 }
    const parsed = parseProjectFile(JSON.parse(JSON.stringify(project)))
    expect(parsed.topology.nodes.find((node) => node.id === 'service')).toMatchObject({ type: 'service', componentVersion: 1, rolePreset: { id: 'worker', version: 1 } })
    const executable = projectToScenario(parsed).nodes.find((node) => node.id === 'service')!
    expect(executable).toMatchObject({ type: 'service' })
    expect(executable).not.toHaveProperty('rolePreset')
  })

  it('preserves explicit component behavior versions in the executable scenario', () => {
    const project = migrateScenarioV1ToProjectV2(scenarioV1())
    const database = {
      id: 'database', name: 'Database', type: 'database', componentVersion: 2, position: { x: 10, y: 20 },
      config: { maxConnections: 100, queryTimeMs: 12, jitterMs: 0, errorRate: 0, maxQueueSize: 100, shardCount: 4, replicasPerShard: 2, readPreference: 'replica-preferred', replicationDelayMs: 100, writeRatio: 0.2, keySpaceSize: 1_000, hotKeyProbability: 0 },
    }
    project.topology.nodes.push(database)
    const scenario = projectToScenario(project)
    expect(scenario.nodes.find((node) => node.id === 'database')).toMatchObject({ componentVersion: 2, config: { shardCount: 4 } })
    expect(parseProjectFile(project).topology.nodes.find((node) => node.id === 'database')).toEqual(database)
  })

  it.each(['weighted-one', 'fan-out', 'async-publish'] as const)('round-trips %s routing', (routingMode) => {
    const project = migrateScenarioV1ToProjectV2(scenarioV1())
    project.topology.edges[0]!.routingMode = routingMode
    if (routingMode === 'async-publish') {
      project.topology.edges[0]!.sourceSemantic = 'publish'
      project.topology.edges[0]!.targetSemantic = 'consume'
    }
    expect(projectFileV2Schema.parse(JSON.parse(JSON.stringify(project))).topology.edges[0]!.routingMode).toBe(routingMode)
  })

  it('rejects asynchronous routing without publish and consume semantics', () => {
    const project = migrateScenarioV1ToProjectV2(scenarioV1())
    project.topology.edges[0]!.routingMode = 'async-publish'
    expect(projectFileV2Schema.safeParse(project).success).toBe(false)
  })

  it('rejects unsupported versions with an actionable error', () => {
    expect(() => parseProjectFile({ schemaVersion: 99 })).toThrow(UnsupportedProjectVersionError)
    expect(() => parseProjectFile({ schemaVersion: 99 })).toThrow('schemaVersion 1 or 2')
  })

  it('validates references across topology and experiments', () => {
    const project = migrateScenarioV1ToProjectV2(scenarioV1())
    project.experiments[0]!.faults[0]!.targetNodeId = 'missing'
    expect(projectFileV2Schema.safeParse(project).success).toBe(false)
  })

  it('validates typed fault targets and expands regions deterministically', () => {
    const project = migrateScenarioV1ToProjectV2(scenarioV1())
    project.topology.groups = [{ id: 'region-a', name: 'Region A', kind: 'region', nodeIds: ['service'] }]
    project.experiments[0]!.faults = [{ id: 'outage', type: 'region-outage', target: { kind: 'group', id: 'region-a' }, startAtSeconds: 2, durationSeconds: 3, enabled: true }]
    expect(projectFileV2Schema.safeParse(project).success).toBe(true)
    expect(projectToScenario(project).faults).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'outage:node:0', sourceFaultId: 'outage', type: 'region-outage', target: { kind: 'node', id: 'service' } }),
      expect.objectContaining({ id: 'outage:edge:0', sourceFaultId: 'outage', type: 'region-outage', target: { kind: 'edge', id: 'edge' } }),
    ]))

    project.experiments[0]!.faults[0] = { id: 'invalid', type: 'packet-loss', target: { kind: 'node', id: 'service' }, startAtSeconds: 0, durationSeconds: 1, factor: 0.5, enabled: true }
    expect(projectFileV2Schema.safeParse(project).success).toBe(false)
  })

  it('preserves disabled faults in executable scenarios without applying them', () => {
    const project = migrateScenarioV1ToProjectV2(scenarioV1())
    project.experiments[0]!.faults[0] = { ...project.experiments[0]!.faults[0]!, enabled: false }
    expect(projectToScenario(project).faults).toEqual([expect.objectContaining({ id: 'fault', enabled: false })])
  })

  it('keeps topology independent while switching experiments', () => {
    const project = migrateScenarioV1ToProjectV2(scenarioV1())
    const candidate = structuredClone(project.experiments[0]!)
    candidate.id = 'burst'
    candidate.name = 'Burst experiment'
    candidate.seed = 'burst-seed'
    project.experiments.push(candidate)
    const switched = setActiveExperiment(project, 'burst')
    expect(switched.topology).toEqual(project.topology)
    expect(projectToScenario(switched).seed).toBe('burst-seed')
    expect(() => setActiveExperiment(project, 'missing')).toThrow('Unknown active experiment')
  })
})
