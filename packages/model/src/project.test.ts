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
  scenario.faults.push({ id: 'fault', targetNodeId: 'service', type: 'capacity-drop', startAtSeconds: 2, durationSeconds: 3, factor: 0.5 })
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
