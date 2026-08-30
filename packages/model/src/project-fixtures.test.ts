import { describe, expect, it } from 'vitest'
import { createOrderSystemContractFixture, createScheduledReportContractFixture } from './project-fixtures'
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
  it('accepts an operation workload sourced by a Scheduler', () => {
    const fixture = createScheduledReportContractFixture()

    expect(projectFileV3Schema.safeParse(fixture).success).toBe(true)
    expect(fixture.experiments[0]?.operationWorkloads[0]?.sourceNodeId).toBe('report-scheduler')
  })

  it('rejects multiple operation workloads bound to the same Scheduler before compilation', () => {
    const fixture = createScheduledReportContractFixture()
    const duplicate = structuredClone(fixture.experiments[0]!.operationWorkloads[0]!)
    duplicate.id = 'second-scheduled-workload'
    fixture.experiments[0]!.operationWorkloads.push(duplicate)

    const result = projectFileV3Schema.safeParse(fixture)
    expect(result.success).toBe(false)
    if (result.success) throw new Error('Expected duplicate Scheduler workload binding to fail validation.')
    expect(result.error.issues).toContainEqual(expect.objectContaining({
      path: ['experiments', 0, 'operationWorkloads', 1, 'sourceNodeId'],
      message: 'Scheduler report-scheduler can bind only one operation workload per experiment.',
    }))
  })

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
    expect(fixture.definitions.apis[0]?.operations.map(({ method, path }) => `${method} ${path}`)).toEqual([
      'POST /orders',
      'GET /orders/{id}',
      'GET /orders',
    ])
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
    expect(fixture.definitions.dataModels[0]?.kind === 'relational' ? fixture.definitions.dataModels[0].tables.map(({ id }) => id) : []).toEqual([
      'orders-table',
      'order-items-table',
    ])
    expect(fixture.definitions.interactions[0]?.actions.map(({ kind }) => kind)).toEqual([
      'api-call',
      'data-access',
      'data-access',
      'cache-access',
      'event-publish',
      'event-consume',
    ])
    expect(fixture.definitions.interactions.map(({ id }) => id)).toEqual([
      'create-order-flow',
      'get-order-flow',
      'list-customer-orders-flow',
    ])
    expect(fixture.experiments[0]?.operationWorkloads[0]).toMatchObject({
      sourceNodeId: 'client-traffic',
      phases: [
        { id: 'warmup', pattern: 'constant' },
        { id: 'steady', pattern: 'poisson' },
      ],
    })
    expect(fixture.experiments[0]?.operationWorkloads[0]?.operationMix[0]).toMatchObject({
      weight: 2, requestBytes: 1_024, responseBytes: 2_048,
      keyDistribution: { kind: 'hotspot' }, valueSizeDistribution: { kind: 'fixed' },
    })
    expect(fixture.experiments[0]?.operationWorkloads[0]?.operationMix.map((mix) => mix.operation.operationId)).toEqual([
      'create-order',
      'get-order',
      'list-customer-orders',
    ])
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
        const action = fixture.definitions.interactions[0]!.actions[4]!
        if (action.kind === 'event-publish') action.producerNodeId = 'fulfillment-worker'
      },
      path: ['definitions', 'interactions', 0, 'actions', 4, 'producerNodeId'],
      message: 'Event order-created@1 is produced by orders-service.',
    },
    {
      name: 'event consumer',
      mutate: (fixture: ProjectFileV3) => {
        const action = fixture.definitions.interactions[0]!.actions[5]!
        if (action.kind === 'event-consume') action.consumerNodeId = 'orders-service'
      },
      path: ['definitions', 'interactions', 0, 'actions', 5, 'consumerNodeId'],
      message: 'Node orders-service is not a consumer of event order-created@1.',
    },
    {
      name: 'broker component',
      mutate: (fixture: ProjectFileV3) => {
        const action = fixture.definitions.interactions[0]!.actions[4]!
        if (action.kind === 'event-publish') action.brokerNodeId = 'orders-db'
      },
      path: ['definitions', 'interactions', 0, 'actions', 4, 'brokerNodeId'],
      message: 'Node orders-db must be a queue, stream, or topic component.',
    },
    {
      name: 'workload source component',
      mutate: (fixture: ProjectFileV3) => { fixture.experiments[0]!.operationWorkloads[0]!.sourceNodeId = 'orders-service' },
      path: ['experiments', 0, 'operationWorkloads', 0, 'sourceNodeId'],
      message: 'Node orders-service must be a traffic or scheduler component.',
    },
  ])('reports an actionable path for an invalid $name reference', ({ mutate, path, message }) => {
    const issues = validateMutation(mutate)
    expect(issues).toContainEqual(expect.objectContaining({ path, message }))
  })
})
