import { describe, expect, it } from 'vitest'
import { createOrderSystemContractFixture } from './project-fixtures'
import { parseProjectFile, projectFileV3Schema, type ProjectFileV3 } from './project'

const validateMutation = (mutate: (fixture: ProjectFileV3) => void) => {
  const fixture = createOrderSystemContractFixture()
  mutate(fixture)
  const result = projectFileV3Schema.safeParse(fixture)
  expect(result.success).toBe(false)
  if (result.success) throw new Error('Expected the mutated fixture to fail validation.')
  return result.error.issues
}

describe('order-system contract fixture', () => {
  it('creates deterministic, independently mutable project values', () => {
    const first = createOrderSystemContractFixture()
    const second = createOrderSystemContractFixture()

    expect(first).toEqual(second)
    expect(first).not.toBe(second)
    expect(first.definitions).not.toBe(second.definitions)

    first.name = 'Changed locally'
    first.definitions.apis[0]!.operations[0]!.name = 'Changed operation'
    expect(second.name).toBe('Order system contracts')
    expect(second.definitions.apis[0]!.operations[0]!.name).toBe('Create order')
  })

  it('pins a serialization-stable example of every generic contract family', () => {
    const fixture = createOrderSystemContractFixture()
    const reparsed = parseProjectFile(JSON.parse(JSON.stringify(fixture)))

    expect(reparsed).toEqual(fixture)
    expect(fixture).toMatchObject({
      schemaVersion: 3,
      modelingMode: 'business-aware',
      definitions: { schemaVersion: 1 },
      activeExperimentId: 'baseline',
    })
    expect(fixture.definitions.jsonSchemas.map(({ id }) => id)).toEqual([
      'schema.CreateOrder',
      'schema.Order',
      'schema.OrderCreated',
    ])
    expect(fixture.definitions.apis[0]?.operations[0]).toMatchObject({
      id: 'create-order',
      method: 'POST',
      path: '/orders',
      request: { estimatedBytes: 1_024 },
      responses: [{ statusCode: '201', body: { estimatedBytes: 2_048 } }],
    })
    expect(fixture.definitions.dataModels.map(({ kind }) => kind)).toEqual([
      'relational',
      'document',
      'key-value',
    ])
    expect(fixture.definitions.events[0]).toMatchObject({
      id: 'order-created',
      producerNodeId: 'orders-service',
      consumerNodeIds: ['fulfillment-worker'],
      ordering: 'partition-key',
    })
    expect(fixture.definitions.cacheKeys[0]).toMatchObject({
      id: 'order-cache-key',
      pattern: 'order:{id}',
      ttlSeconds: 300,
    })
    expect(fixture.definitions.interactions[0]?.actions.map(({ kind }) => kind)).toEqual([
      'api-call',
      'data-access',
      'cache-access',
      'event-publish',
      'event-consume',
    ])
    expect(fixture.experiments[0]?.operationWorkloads[0]).toMatchObject({
      sourceNodeId: 'client-traffic',
      phases: [
        { id: 'warmup', pattern: 'constant' },
        { id: 'steady', pattern: 'poisson' },
      ],
      operationMix: [{
        weight: 1,
        requestBytes: 1_024,
        responseBytes: 2_048,
        keyDistribution: { kind: 'hotspot' },
        valueSizeDistribution: { kind: 'fixed' },
      }],
    })
  })

  it.each([
    {
      name: 'API payload schema',
      mutate: (fixture: ProjectFileV3) => { fixture.definitions.apis[0]!.operations[0]!.request!.schema.schemaId = 'schema.Missing' },
      path: ['definitions', 'apis', 0, 'operations', 0, 'request', 'schema'],
      message: 'Unknown JSON Schema: schema.Missing@1',
    },
    {
      name: 'document schema',
      mutate: (fixture: ProjectFileV3) => {
        const model = fixture.definitions.dataModels[1]!
        if (model.kind === 'document') model.collections[0]!.documentSchema.schemaVersion = 2
      },
      path: ['definitions', 'dataModels', 1, 'collections', 0, 'documentSchema'],
      message: 'Unknown JSON Schema: schema.Order@2',
    },
    {
      name: 'data object',
      mutate: (fixture: ProjectFileV3) => {
        const action = fixture.definitions.interactions[0]!.actions[1]!
        if (action.kind === 'data-access') action.objectId = 'missing-table'
      },
      path: ['definitions', 'interactions', 0, 'actions', 1, 'objectId'],
      message: 'Unknown relational data object: missing-table',
    },
    {
      name: 'event producer',
      mutate: (fixture: ProjectFileV3) => {
        const action = fixture.definitions.interactions[0]!.actions[3]!
        if (action.kind === 'event-publish') action.producerNodeId = 'fulfillment-worker'
      },
      path: ['definitions', 'interactions', 0, 'actions', 3, 'producerNodeId'],
      message: 'Event order-created@1 is produced by orders-service.',
    },
    {
      name: 'event consumer',
      mutate: (fixture: ProjectFileV3) => {
        const action = fixture.definitions.interactions[0]!.actions[4]!
        if (action.kind === 'event-consume') action.consumerNodeId = 'orders-service'
      },
      path: ['definitions', 'interactions', 0, 'actions', 4, 'consumerNodeId'],
      message: 'Node orders-service is not a consumer of event order-created@1.',
    },
    {
      name: 'broker component',
      mutate: (fixture: ProjectFileV3) => {
        const action = fixture.definitions.interactions[0]!.actions[3]!
        if (action.kind === 'event-publish') action.brokerNodeId = 'orders-db'
      },
      path: ['definitions', 'interactions', 0, 'actions', 3, 'brokerNodeId'],
      message: 'Node orders-db must be a queue or stream component.',
    },
    {
      name: 'workload source component',
      mutate: (fixture: ProjectFileV3) => { fixture.experiments[0]!.operationWorkloads[0]!.sourceNodeId = 'orders-service' },
      path: ['experiments', 0, 'operationWorkloads', 0, 'sourceNodeId'],
      message: 'Node orders-service must be a traffic component.',
    },
  ])('reports an actionable path for an invalid $name reference', ({ mutate, path, message }) => {
    const issues = validateMutation(mutate)
    expect(issues).toContainEqual(expect.objectContaining({ path, message }))
  })
})
