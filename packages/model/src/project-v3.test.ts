import { describe, expect, it } from 'vitest'
import { createNode } from './catalog'
import { createOrderSystemContractFixture } from './project-fixtures'
import { createEmptyProject, migrateProjectV2ToProjectV3, migrateScenarioV1ToProjectV2, parseProjectFile, projectFileV3Schema, projectToScenario } from './project'
import { createEmptyScenario } from './factories'

describe('ProjectFile v3', () => {
  it('round-trips a complete generic business contract fixture', () => {
    const fixture = createOrderSystemContractFixture()
    expect(parseProjectFile(JSON.parse(JSON.stringify(fixture)))).toEqual(fixture)
    expect(fixture.definitions.dataModels.map((model) => model.kind)).toEqual(['relational', 'document', 'key-value'])
    expect(fixture.definitions.interactions[0]?.actions.map((action) => action.kind)).toEqual(['api-call', 'data-access', 'data-access', 'cache-access', 'event-publish', 'event-consume'])
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
    ['event', (project: ReturnType<typeof createOrderSystemContractFixture>) => { const action = project.definitions.interactions[0]!.actions[4]!; if (action.kind === 'event-publish') action.event.eventId = 'missing-event' }],
    ['cache key', (project: ReturnType<typeof createOrderSystemContractFixture>) => { const action = project.definitions.interactions[0]!.actions[3]!; if (action.kind === 'cache-access') action.key.cacheKeyId = 'missing-cache-key' }],
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

  it('allows only document models and supported operations on Search Index nodes', () => {
    const fixture = createOrderSystemContractFixture()
    fixture.topology.nodes.push({ ...createNode('search-index', 'orders-search', { x: 600, y: 100 }), name: 'Orders search', componentVersion: 1 })
    fixture.topology.edges.push({ id: 'orders-to-search', source: 'orders-service', target: 'orders-search', sourcePort: 'out', targetPort: 'in', weight: 1, sourceSemantic: 'request', targetSemantic: 'request', routingMode: 'weighted-one' })
    const document = fixture.definitions.dataModels.find((model) => model.kind === 'document')!
    document.ownerNodeId = 'orders-search'
    const action = fixture.definitions.interactions[0]!.actions[1]!
    if (action.kind !== 'data-access') throw new Error('Expected data action')
    action.nodeId = 'orders-search'
    action.model = { modelId: document.id, modelVersion: document.version }
    action.objectId = document.collections[0]!.id
    action.operation = 'scan'
    delete action.indexId
    expect(projectFileV3Schema.safeParse(fixture).success).toBe(true)

    const relationalOwner = structuredClone(fixture)
    relationalOwner.definitions.dataModels[0]!.ownerNodeId = 'orders-search'
    expect(projectFileV3Schema.safeParse(relationalOwner).success).toBe(false)

    const pointRead = structuredClone(fixture)
    const pointReadAction = pointRead.definitions.interactions[0]!.actions[1]!
    if (pointReadAction.kind !== 'data-access') throw new Error('Expected data action')
    pointReadAction.operation = 'point-read'
    expect(projectFileV3Schema.safeParse(pointRead).success).toBe(false)

    const wrongOwner = structuredClone(fixture)
    wrongOwner.definitions.dataModels.find((model) => model.id === document.id)!.ownerNodeId = 'orders-db'
    expect(projectFileV3Schema.safeParse(wrongOwner).success).toBe(false)
  })

  it('accepts Topic as an event broker while retaining event producer and consumer contracts', () => {
    const fixture = createOrderSystemContractFixture()
    fixture.topology.nodes.push({ ...createNode('topic', 'order-topic', { x: 600, y: 100 }), name: 'Order topic', componentVersion: 1 })
    fixture.topology.edges = fixture.topology.edges.map((edge) => edge.source === 'orders-service' && edge.target === 'orders-stream'
      ? { ...edge, target: 'order-topic' }
      : edge.source === 'orders-stream' && edge.target === 'fulfillment-worker'
        ? { ...edge, source: 'order-topic' }
        : edge)
    for (const action of fixture.definitions.interactions[0]!.actions) {
      if (action.kind === 'event-publish' || action.kind === 'event-consume') action.brokerNodeId = 'order-topic'
    }
    expect(projectFileV3Schema.safeParse(fixture).success).toBe(true)

    const wrongConsumer = structuredClone(fixture)
    const consume = wrongConsumer.definitions.interactions[0]!.actions.find((action) => action.kind === 'event-consume')!
    if (consume.kind !== 'event-consume') throw new Error('Expected consume action')
    consume.consumerNodeId = 'orders-service'
    expect(projectFileV3Schema.safeParse(wrongConsumer).success).toBe(false)
  })

  it('validates realtime actions against Realtime Gateway nodes', () => {
    const fixture = createOrderSystemContractFixture()
    fixture.topology.nodes.push({ ...createNode('realtime-gateway', 'order-live', { x: 600, y: 100 }), componentVersion: 1 })
    fixture.topology.edges.push({ id: 'orders-to-live', source: 'orders-service', target: 'order-live', sourcePort: 'out', targetPort: 'in', weight: 1, sourceSemantic: 'request', targetSemantic: 'request', routingMode: 'weighted-one' })
    fixture.definitions.interactions[0]!.actions.splice(1, 0, { id: 'broadcast-order', kind: 'realtime', dependsOn: ['call-api'], nodeId: 'order-live', operation: 'broadcast', connectionPattern: 'order-client:{request}', channelPattern: 'order:{key}', messageBytes: 512 })
    expect(projectFileV3Schema.safeParse(fixture).success).toBe(true)

    const wrongTarget = structuredClone(fixture)
    const action = wrongTarget.definitions.interactions[0]!.actions.find((candidate) => candidate.kind === 'realtime')!
    if (action.kind !== 'realtime') throw new Error('Expected realtime action')
    action.nodeId = 'orders-db'
    expect(projectFileV3Schema.safeParse(wrongTarget).success).toBe(false)

    const missingMessageBytes = structuredClone(fixture)
    const broadcast = missingMessageBytes.definitions.interactions[0]!.actions.find((candidate) => candidate.kind === 'realtime')!
    if (broadcast.kind !== 'realtime') throw new Error('Expected realtime action')
    broadcast.messageBytes = undefined
    expect(projectFileV3Schema.safeParse(missingMessageBytes).success).toBe(false)
  })

  it('validates workflow definitions, activity owners, and action references', () => {
    const fixture = createOrderSystemContractFixture()
    fixture.topology.nodes.push({ ...createNode('workflow', 'order-workflow', { x: 600, y: 100 }), componentVersion: 1 })
    fixture.topology.edges.push({ id: 'orders-to-workflow', source: 'orders-service', target: 'order-workflow', sourcePort: 'out', targetPort: 'in', weight: 1, sourceSemantic: 'request', targetSemantic: 'request', routingMode: 'weighted-one' })
    fixture.topology.edges.push({ id: 'workflow-to-orders', source: 'order-workflow', target: 'orders-service', sourcePort: 'out', targetPort: 'in', weight: 1, sourceSemantic: 'request', targetSemantic: 'request', routingMode: 'weighted-one' })
    fixture.definitions.workflows.push({
      id: 'checkout', version: 1, name: 'Checkout', ownerNodeId: 'order-workflow', steps: [{
        id: 'persist-order', targetNodeId: 'orders-service', operation: { apiId: 'orders-api', apiVersion: 1, operationId: 'create-order' },
        timeoutMs: 1_000, retry: { maxAttempts: 3, backoff: 'exponential', baseDelayMs: 50, maxDelayMs: 1_000, jitterRatio: 0 },
        compensation: { targetNodeId: 'orders-service', timeoutMs: 500, retry: { maxAttempts: 1, backoff: 'fixed', baseDelayMs: 0, maxDelayMs: 0, jitterRatio: 0 } },
      }],
    })
    fixture.definitions.interactions[0]!.actions.splice(1, 0, { id: 'run-checkout', kind: 'workflow', dependsOn: ['call-api'], nodeId: 'order-workflow', workflow: { workflowId: 'checkout', workflowVersion: 1 }, idempotencyKeyPattern: 'checkout:{key}' })
    expect(projectFileV3Schema.safeParse(fixture).success).toBe(true)

    const wrongTarget = structuredClone(fixture)
    wrongTarget.definitions.workflows[0]!.steps[0]!.targetNodeId = 'orders-db'
    expect(projectFileV3Schema.safeParse(wrongTarget).success).toBe(false)

    const wrongOwner = structuredClone(fixture)
    wrongOwner.definitions.workflows[0]!.ownerNodeId = 'orders-service'
    expect(projectFileV3Schema.safeParse(wrongOwner).success).toBe(false)

    const wrongOperationOwner = structuredClone(fixture)
    wrongOperationOwner.definitions.workflows[0]!.steps[0]!.targetNodeId = 'fulfillment-worker'
    expect(projectFileV3Schema.safeParse(wrongOperationOwner).success).toBe(false)

    const wrongCompensationOperationOwner = structuredClone(fixture)
    wrongCompensationOperationOwner.definitions.workflows[0]!.steps[0]!.compensation!.targetNodeId = 'fulfillment-worker'
    wrongCompensationOperationOwner.definitions.workflows[0]!.steps[0]!.compensation!.operation = { apiId: 'orders-api', apiVersion: 1, operationId: 'create-order' }
    expect(projectFileV3Schema.safeParse(wrongCompensationOperationOwner).success).toBe(false)

    const missingDefinition = structuredClone(fixture)
    const action = missingDefinition.definitions.interactions[0]!.actions.find((candidate) => candidate.kind === 'workflow')!
    if (action.kind !== 'workflow') throw new Error('Expected workflow action')
    action.workflow.workflowId = 'missing-workflow'
    expect(projectFileV3Schema.safeParse(missingDefinition).success).toBe(false)

    const wrongActionOwner = structuredClone(fixture)
    const ownerAction = wrongActionOwner.definitions.interactions[0]!.actions.find((candidate) => candidate.kind === 'workflow')!
    if (ownerAction.kind !== 'workflow') throw new Error('Expected workflow action')
    ownerAction.nodeId = 'orders-service'
    expect(projectFileV3Schema.safeParse(wrongActionOwner).success).toBe(false)
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
