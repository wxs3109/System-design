import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  createEmptyScenario,
  createNode,
  migrateScenarioV1ToProjectV2,
  migrateProjectV2ToProjectV3,
  parseProjectFile,
  projectFileV2Schema,
  projectToScenario,
  scenarioSchema,
  type ComponentType,
  type Scenario,
} from './index'

const identifierArbitrary = fc.stringMatching(/^[a-z][a-z0-9-]{0,23}$/)
const finiteCoordinateArbitrary = fc.integer({ min: -100_000, max: 100_000 })

const executableScenarioArbitrary: fc.Arbitrary<Scenario> = fc.record({
  projectId: identifierArbitrary,
  name: identifierArbitrary,
  seed: identifierArbitrary,
  componentType: fc.constantFrom<ComponentType>('network', 'load-balancer', 'service', 'queue', 'cache', 'cdn', 'search-index', 'stream', 'topic', 'object-storage', 'database'),
  trafficPosition: fc.record({ x: finiteCoordinateArbitrary, y: finiteCoordinateArbitrary }),
  componentPosition: fc.record({ x: finiteCoordinateArbitrary, y: finiteCoordinateArbitrary }),
  edgeWeight: fc.integer({ min: 1, max: 100 }),
  requestsPerSecond: fc.integer({ min: 1, max: 250 }),
  startAtSeconds: fc.integer({ min: 0, max: 5 }),
  durationSeconds: fc.integer({ min: 1, max: 20 }),
  pattern: fc.constantFrom('constant' as const, 'poisson' as const),
  requestBytes: fc.integer({ min: 1, max: 1_000_000 }),
  simulationDurationSeconds: fc.integer({ min: 1, max: 30 }),
  sampleIntervalMs: fc.integer({ min: 1, max: 5_000 }),
  maxRequests: fc.integer({ min: 1, max: 50_000 }),
  traceLimit: fc.integer({ min: 0, max: 1_000 }),
  maxHops: fc.integer({ min: 1, max: 100 }),
}).map((input) => {
  const scenario = createEmptyScenario(input.projectId)
  scenario.name = input.name
  scenario.seed = input.seed
  scenario.simulation = {
    durationSeconds: input.simulationDurationSeconds,
    sampleIntervalMs: input.sampleIntervalMs,
    maxRequests: input.maxRequests,
    traceLimit: input.traceLimit,
    maxHops: input.maxHops,
  }
  scenario.nodes = [
    createNode('traffic', 'traffic', input.trafficPosition, 'load'),
    createNode(input.componentType, 'component', input.componentPosition),
  ]
  scenario.edges = [{ id: 'edge', source: 'traffic', target: 'component', sourcePort: 'out', targetPort: 'in', weight: input.edgeWeight }]
  scenario.workloads = [{
    id: 'load', name: 'Generated load', sourceNodeId: 'traffic', requestsPerSecond: input.requestsPerSecond,
    startAtSeconds: input.startAtSeconds, durationSeconds: input.durationSeconds, pattern: input.pattern, requestBytes: input.requestBytes,
  }]
  return scenarioSchema.parse(scenario)
})

describe('ProjectFile migration properties', () => {
  it('migrates every generated v1 scenario deterministically without changing executable semantics', () => {
    fc.assert(fc.property(executableScenarioArbitrary, (scenario) => {
      const migrated = migrateScenarioV1ToProjectV2(scenario)
      const replay = parseProjectFile(JSON.parse(JSON.stringify(scenario)))

      expect(replay).toEqual(migrateProjectV2ToProjectV3(migrated))
      expect(projectToScenario(migrated)).toEqual(scenario)
      expect(projectFileV2Schema.safeParse(migrated).success).toBe(true)
    }), { numRuns: 100 })
  })

  it('keeps migrated projects valid and stable across JSON serialization', () => {
    fc.assert(fc.property(executableScenarioArbitrary, (scenario) => {
      const migrated = migrateProjectV2ToProjectV3(migrateScenarioV1ToProjectV2(scenario))
      const serialized = JSON.stringify(migrated)
      const parsed = parseProjectFile(JSON.parse(serialized))

      expect(parsed.schemaVersion).toBe(3)
      expect(JSON.stringify(parsed)).toBe(serialized)
    }), { numRuns: 100 })
  })
})
