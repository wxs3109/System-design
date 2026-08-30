import { describe, expect, it } from 'vitest'
import legacyProjectFixture from './fixtures/project-file-v2-capacity.json'
import {
  emptyBusinessDefinitions,
  migrateProjectV2ToProjectV3,
  parseProjectFile,
  projectFileV2Schema,
  projectFileV3Schema,
  projectToScenario,
} from './index'

const readLegacyFixture = () => structuredClone(legacyProjectFixture)

describe('ProjectFile v2 compatibility fixture', () => {
  it('migrates to the canonical capacity-only v3 shape without mutating the source artifact', () => {
    const source = readLegacyFixture()
    const sourceSerialization = JSON.stringify(source)
    const normalizedV2 = projectFileV2Schema.parse(source)

    const migrated = migrateProjectV2ToProjectV3(source)

    expect(JSON.stringify(source)).toBe(sourceSerialization)
    expect(migrated).toEqual({
      ...normalizedV2,
      schemaVersion: 3,
      modelingMode: 'capacity-only',
      definitions: emptyBusinessDefinitions(),
      experiments: normalizedV2.experiments.map((experiment) => ({ ...experiment, operationWorkloads: [] })),
    })
    expect(parseProjectFile(readLegacyFixture())).toEqual(migrated)
    expect(migrateProjectV2ToProjectV3(readLegacyFixture())).toEqual(migrated)
  })

  it.each([
    ['baseline', 'baseline-load', 'legacy-baseline-seed'],
    ['regional-failure', 'failure-load', 'legacy-regional-failure-seed'],
  ] as const)('preserves the exact Phase 1 executable meaning of the %s experiment', (experimentId, workloadId, seed) => {
    const v2 = projectFileV2Schema.parse(readLegacyFixture())
    const v3 = parseProjectFile(readLegacyFixture())

    const expectedScenario = projectToScenario(v2, experimentId)
    const migratedScenario = projectToScenario(v3, experimentId)

    expect(migratedScenario).toEqual(expectedScenario)
    expect(migratedScenario.seed).toBe(seed)
    expect(migratedScenario.workloads).toEqual([expect.objectContaining({ id: workloadId })])
    expect(migratedScenario.nodes.find((node) => node.id === 'client-traffic')).toMatchObject({ config: { workloadId } })
    expect(migratedScenario.nodes.find((node) => node.id === 'orders-service')).not.toHaveProperty('rolePreset')
    expect(migratedScenario.nodes.find((node) => node.id === 'orders-db')).toMatchObject({ componentVersion: 2, config: { shardCount: 8 } })
    expect(migratedScenario.edges.every((edge) => edge.sourcePort === 'out' && edge.targetPort === 'in')).toBe(true)
  })

  it('retains deterministic group-fault expansion after migration', () => {
    const migrated = parseProjectFile(readLegacyFixture())
    const scenario = projectToScenario(migrated, 'regional-failure')
    const expanded = scenario.faults.filter((fault) => fault.sourceFaultId === 'primary-region-outage')

    expect(expanded.map((fault) => [fault.id, fault.target])).toEqual([
      ['primary-region-outage:node:0', { kind: 'node', id: 'orders-service' }],
      ['primary-region-outage:node:1', { kind: 'node', id: 'orders-db' }],
      ['primary-region-outage:node:2', { kind: 'node', id: 'orders-stream' }],
      ['primary-region-outage:edge:0', { kind: 'edge', id: 'client-to-orders' }],
      ['primary-region-outage:edge:1', { kind: 'edge', id: 'orders-to-db' }],
      ['primary-region-outage:edge:2', { kind: 'edge', id: 'orders-to-stream' }],
      ['primary-region-outage:edge:3', { kind: 'edge', id: 'stream-to-worker' }],
    ])
  })

  it('serializes the migrated fixture stably and reopens the serialized artifact as v3', () => {
    const migrated = parseProjectFile(readLegacyFixture())
    const serialization = JSON.stringify(migrated)
    const reopened = parseProjectFile(JSON.parse(serialization))

    expect(projectFileV3Schema.parse(reopened)).toEqual(migrated)
    expect(JSON.stringify(reopened)).toBe(serialization)
  })
})
