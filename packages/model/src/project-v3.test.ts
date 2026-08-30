import { describe, expect, it } from 'vitest'
import { createOrderSystemContractFixture } from './project-fixtures'
import { createEmptyProject, migrateProjectV2ToProjectV3, migrateScenarioV1ToProjectV2, parseProjectFile, projectFileV3Schema, projectToScenario } from './project'
import { createEmptyScenario } from './factories'

describe('ProjectFile v3', () => {
  it('round-trips a complete generic business contract fixture', () => {
    const fixture = createOrderSystemContractFixture()
    expect(parseProjectFile(JSON.parse(JSON.stringify(fixture)))).toEqual(fixture)
    expect(fixture.definitions.dataModels.map((model) => model.kind)).toEqual(['relational', 'document', 'key-value'])
    expect(fixture.definitions.interactions[0]?.actions.map((action) => action.kind)).toEqual(['api-call', 'data-access', 'cache-access', 'event-publish', 'event-consume'])
    expect(fixture.experiments[0]?.operationWorkloads[0]?.phases).toHaveLength(2)
  })

  it('migrates v2 deterministically without inventing business meaning or changing execution', () => {
    const scenario = createEmptyScenario('capacity-only')
    const v2 = migrateScenarioV1ToProjectV2(scenario)
    const first = migrateProjectV2ToProjectV3(v2)
    const second = parseProjectFile(JSON.parse(JSON.stringify(v2)))
    expect(second).toEqual(first)
    expect(first).toMatchObject({ schemaVersion: 3, modelingMode: 'capacity-only', definitions: { jsonSchemas: [], apis: [], dataModels: [], events: [], cacheKeys: [], interactions: [] } })
    expect(first.experiments.every((experiment) => experiment.operationWorkloads.length === 0)).toBe(true)
    expect(projectToScenario(first)).toEqual(projectToScenario(v2))
  })

  it('rejects broken cross-resource references with actionable paths', () => {
    const fixture = createOrderSystemContractFixture()
    fixture.definitions.interactions[0]!.actions[1] = { ...fixture.definitions.interactions[0]!.actions[1]!, kind: 'data-access', nodeId: 'orders-db', model: { modelId: 'orders-model', modelVersion: 1 }, objectId: 'orders-table', operation: 'index-read', indexId: 'missing-index' }
    const parsed = projectFileV3Schema.safeParse(fixture)
    expect(parsed.success).toBe(false)
    if (!parsed.success) expect(parsed.error.issues.some((issue) => issue.message.includes('Unknown index missing-index'))).toBe(true)
  })

  it.each([
    ['schema', (project: ReturnType<typeof createOrderSystemContractFixture>) => { project.definitions.apis[0]!.operations[0]!.request!.schema.schemaId = 'missing-schema' }],
    ['owner node', (project: ReturnType<typeof createOrderSystemContractFixture>) => { project.definitions.apis[0]!.ownerNodeId = 'missing-service' }],
    ['operation', (project: ReturnType<typeof createOrderSystemContractFixture>) => { project.definitions.interactions[0]!.entryOperation.operationId = 'missing-operation' }],
    ['event', (project: ReturnType<typeof createOrderSystemContractFixture>) => { const action = project.definitions.interactions[0]!.actions[3]!; if (action.kind === 'event-publish') action.event.eventId = 'missing-event' }],
    ['cache key', (project: ReturnType<typeof createOrderSystemContractFixture>) => { const action = project.definitions.interactions[0]!.actions[2]!; if (action.kind === 'cache-access') action.key.cacheKeyId = 'missing-cache-key' }],
    ['interaction', (project: ReturnType<typeof createOrderSystemContractFixture>) => { project.experiments[0]!.operationWorkloads[0]!.operationMix[0]!.interaction.interactionId = 'missing-interaction' }],
  ] as const)('rejects a broken %s reference', (_label, mutate) => {
    const fixture = createOrderSystemContractFixture()
    mutate(fixture)
    expect(projectFileV3Schema.safeParse(fixture).success).toBe(false)
  })

  it('rejects contracts bound to incompatible topology component types', () => {
    const fixture = createOrderSystemContractFixture()
    fixture.definitions.apis[0]!.ownerNodeId = 'orders-db'
    expect(projectFileV3Schema.safeParse(fixture).success).toBe(false)
  })

  it('keeps empty current projects explicitly capacity-only', () => {
    expect(createEmptyProject()).toMatchObject({ schemaVersion: 3, modelingMode: 'capacity-only', definitions: { schemaVersion: 1 }, experiments: [{ operationWorkloads: [] }] })
  })

  it('allows traffic and hot-key faults to target operation workloads in the same experiment', () => {
    const fixture = createOrderSystemContractFixture()
    fixture.experiments[0]!.faults.push({
      id: 'operation-spike', type: 'traffic-spike', target: { kind: 'workload', id: 'order-operations' },
      startAtSeconds: 0, durationSeconds: 1, factor: 2, enabled: true,
    })
    expect(projectFileV3Schema.safeParse(fixture).success).toBe(true)
    expect(projectToScenario(fixture).faults).toContainEqual(expect.objectContaining({ id: 'operation-spike', target: { kind: 'workload', id: 'order-operations' } }))
  })
})
