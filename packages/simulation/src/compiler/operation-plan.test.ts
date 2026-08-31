import { describe, expect, it } from 'vitest'
import { createNode, createOrderSystemContractFixture } from '@system-design/model'
import { compileSimulationInput } from './compiler'

const addWorkflow = (project: ReturnType<typeof createOrderSystemContractFixture>) => {
  project.topology.nodes.push({ ...createNode('workflow', 'order-workflow', { x: 600, y: 100 }), componentVersion: 1 })
  project.topology.edges.push(
    { id: 'orders-to-workflow', source: 'orders-service', target: 'order-workflow', sourcePort: 'out', targetPort: 'in', weight: 1, sourceSemantic: 'request', targetSemantic: 'request', routingMode: 'weighted-one' },
    { id: 'workflow-to-orders', source: 'order-workflow', target: 'orders-service', sourcePort: 'out', targetPort: 'in', weight: 1, sourceSemantic: 'request', targetSemantic: 'request', routingMode: 'weighted-one' },
    { id: 'workflow-to-worker', source: 'order-workflow', target: 'fulfillment-worker', sourcePort: 'out', targetPort: 'in', weight: 1, sourceSemantic: 'request', targetSemantic: 'request', routingMode: 'weighted-one' },
  )
  project.definitions.workflows.push({
    id: 'checkout', version: 1, name: 'Checkout', ownerNodeId: 'order-workflow',
    steps: [
      {
        id: 'persist', targetNodeId: 'orders-service', operation: { apiId: 'orders-api', apiVersion: 1, operationId: 'get-order' }, timeoutMs: 90,
        retry: { maxAttempts: 3, backoff: 'exponential', baseDelayMs: 10, maxDelayMs: 80, jitterRatio: 0.25 },
      },
      {
        id: 'dispatch', targetNodeId: 'fulfillment-worker', timeoutMs: 200,
        retry: { maxAttempts: 1, backoff: 'fixed', baseDelayMs: 0, maxDelayMs: 0, jitterRatio: 0 },
        compensation: {
          targetNodeId: 'orders-service', operation: { apiId: 'orders-api', apiVersion: 1, operationId: 'create-order' }, timeoutMs: 50,
          retry: { maxAttempts: 2, backoff: 'fixed', baseDelayMs: 5, maxDelayMs: 5, jitterRatio: 0 },
        },
      },
    ],
  })
  project.definitions.interactions[0]!.actions.splice(1, 0, {
    id: 'run-checkout', kind: 'workflow', dependsOn: ['call-api'], nodeId: 'order-workflow',
    workflow: { workflowId: 'checkout', workflowVersion: 1 }, idempotencyKeyPattern: 'checkout:{key}',
  })
  return project
}

describe('operation-aware compiler', () => {
  it('binds every interaction action to explicit topology paths and contract costs', () => {
    const compiled = compileSimulationInput(createOrderSystemContractFixture())
    expect(compiled.operations.phases).toHaveLength(2)
    const plan = [...compiled.operations.plans.values()][0]!
    expect(plan.operation.operationId).toBe('create-order')
    expect(plan.actions.map((action) => ({ id: action.id, edges: action.edgeIds }))).toEqual([
      { id: 'call-api', edges: ['client-to-orders'] },
      { id: 'write-order', edges: ['orders-to-db'] },
      { id: 'write-order-items', edges: ['orders-to-db'] },
      { id: 'cache-order', edges: ['orders-to-cache'] },
      { id: 'publish-order', edges: ['orders-to-stream'] },
      { id: 'consume-order', edges: ['stream-to-worker'] },
    ])
    expect(plan.actions.find((action) => action.id === 'write-order')?.data).toMatchObject({ operation: 'insert', cardinality: 10_000_000, recordBytes: 512 })
    expect(plan.actions.find((action) => action.id === 'call-api')?.handlerTimeMs).toBe(5)
  })

  it('compiles Search Index document cardinality and bytes into its executable action', () => {
    const project = createOrderSystemContractFixture()
    project.topology.nodes.push({ ...createNode('search-index', 'orders-search', { x: 600, y: 100 }), componentVersion: 1 })
    project.topology.edges.push({
      id: 'orders-to-search', source: 'orders-service', target: 'orders-search', sourcePort: 'out', targetPort: 'in',
      weight: 1, sourceSemantic: 'request', targetSemantic: 'request', routingMode: 'weighted-one',
    })
    const document = project.definitions.dataModels.find((model) => model.kind === 'document')!
    document.ownerNodeId = 'orders-search'
    const action = project.definitions.interactions[0]!.actions[1]!
    if (action.kind !== 'data-access') throw new Error('Expected data action')
    action.nodeId = 'orders-search'
    action.model = { modelId: document.id, modelVersion: document.version }
    action.objectId = document.collections[0]!.id
    action.operation = 'scan'
    delete action.indexId

    const compiled = compileSimulationInput(project)
    const plan = [...compiled.operations.plans.values()].find((candidate) => candidate.operation.operationId === 'create-order')!
    expect(plan.actions.find((candidate) => candidate.id === action.id)).toMatchObject({
      nodeId: 'orders-search',
      data: { modelKind: 'document', cardinality: 10_000_000, recordBytes: 2_048, operation: 'scan' },
    })
  })

  it('compiles Workflow definitions into topology-bound executable activities', () => {
    const compiled = compileSimulationInput(addWorkflow(createOrderSystemContractFixture()))
    const plan = [...compiled.operations.plans.values()].find((candidate) => candidate.operation.operationId === 'create-order')!
    expect(plan.actions.find((candidate) => candidate.id === 'run-checkout')).toMatchObject({
      kind: 'workflow', nodeId: 'order-workflow', sourceNodeId: 'orders-service', edgeIds: ['orders-to-workflow'],
      workflow: {
        definitionId: 'checkout@1', idempotencyKeyPattern: 'checkout:{key}',
        steps: [
          {
            id: 'persist', targetNodeId: 'orders-service', edgeIds: ['workflow-to-orders'], operationId: 'get-order',
            requestBytes: 1_024, responseBytes: 2_048, handlerTimeMs: 2, serviceTimeMs: 30, jitterMs: 5, errorRate: 0, timeoutMs: 90,
            retry: { maxAttempts: 3, backoff: 'exponential', baseDelayMs: 10, maxDelayMs: 80, jitterRatio: 0.25 },
          },
          {
            id: 'dispatch', targetNodeId: 'fulfillment-worker', edgeIds: ['workflow-to-worker'], handlerTimeMs: 0, serviceTimeMs: 30, timeoutMs: 200,
            compensation: {
              targetNodeId: 'orders-service', edgeIds: ['workflow-to-orders'], operationId: 'create-order', requestBytes: 1_024, responseBytes: 2_048,
              handlerTimeMs: 5, serviceTimeMs: 30, timeoutMs: 50, retry: { maxAttempts: 2, backoff: 'fixed', baseDelayMs: 5, maxDelayMs: 5, jitterRatio: 0 },
            },
          },
        ],
      },
    })
  })

  it('rejects Workflow activities without an enabled synchronous target path', () => {
    const missingPath = addWorkflow(createOrderSystemContractFixture())
    missingPath.topology.edges = missingPath.topology.edges.filter((edge) => edge.id !== 'workflow-to-worker')
    expect(() => compileSimulationInput(missingPath)).toThrow(/Workflow checkout has no synchronous topology path from order-workflow to step target fulfillment-worker/)

    const disabledTarget = addWorkflow(createOrderSystemContractFixture())
    disabledTarget.topology.nodes.find((node) => node.id === 'fulfillment-worker')!.disabled = true
    expect(() => compileSimulationInput(disabledTarget)).toThrow(/run-checkout has a disabled or missing target node fulfillment-worker/)
  })

  it('rejects an interaction whose claimed action has no matching topology path', () => {
    const project = createOrderSystemContractFixture()
    project.topology.edges = project.topology.edges.filter((edge) => edge.id !== 'orders-to-db')
    expect(() => compileSimulationInput(project)).toThrow(/write-order has no synchronous topology path/)
  })

  it('keeps workload-specific overrides in distinct executable plans', () => {
    const project = createOrderSystemContractFixture()
    const second = structuredClone(project.experiments[0]!.operationWorkloads[0]!)
    second.id = 'large-order-operations'
    second.operationMix[0]!.requestBytes = 8_192
    second.operationMix[0]!.keyDistribution = { kind: 'uniform', keySpaceSize: 10_000_000 }
    project.experiments[0]!.operationWorkloads.push(second)

    const compiled = compileSimulationInput(project)
    expect(compiled.operations.plans).toHaveLength(6)
    expect([...compiled.operations.plans.values()].filter((plan) => plan.operation.operationId === 'create-order')).toHaveLength(2)
    expect(compiled.operations.phases.find((phase) => phase.workloadId === 'order-operations')!.plans[0]!.plan.requestBytes).toBe(1_024)
    expect(compiled.operations.phases.find((phase) => phase.workloadId === second.id)!.plans[0]!.plan).toMatchObject({
      requestBytes: 8_192,
      keyDistribution: { kind: 'uniform' },
    })
  })

  it('rejects an interaction entry that is not bound to its operation workload source', () => {
    const project = createOrderSystemContractFixture()
    const entry = project.definitions.interactions[0]!.actions[0]!
    if (entry.kind !== 'api-call') throw new Error('Expected API entry action')
    entry.sourceNodeId = 'orders-service'
    expect(() => compileSimulationInput(project)).toThrow(/must begin with an unconditional API call.*from workload source client-traffic/)
  })

  it('requires the workload entry API call to be the first executable action', () => {
    const project = createOrderSystemContractFixture()
    project.definitions.interactions[0]!.actions.unshift({
      id: 'unrelated-call', kind: 'service-call', dependsOn: [], sourceNodeId: 'orders-service', targetNodeId: 'fulfillment-worker',
    })
    expect(() => compileSimulationInput(project)).toThrow(/must begin with an unconditional API call/)
  })

  it('infers storage callers from the service context established by dependencies', () => {
    const project = createOrderSystemContractFixture()
    project.topology.edges.push(
      { id: 'orders-to-worker', source: 'orders-service', target: 'fulfillment-worker', sourcePort: 'out', targetPort: 'in', weight: 1, sourceSemantic: 'request', targetSemantic: 'request', routingMode: 'weighted-one' },
      { id: 'worker-to-db', source: 'fulfillment-worker', target: 'orders-db', sourcePort: 'out', targetPort: 'in', weight: 1, sourceSemantic: 'request', targetSemantic: 'request', routingMode: 'weighted-one' },
    )
    const interaction = project.definitions.interactions[0]!
    interaction.actions = [
      interaction.actions[0]!,
      { id: 'call-worker', kind: 'service-call', dependsOn: ['call-api'], sourceNodeId: 'orders-service', targetNodeId: 'fulfillment-worker' },
      { ...interaction.actions[1]!, dependsOn: ['call-worker'] },
    ]

    const action = [...compileSimulationInput(project).operations.plans.values()][0]!.actions[2]!
    expect(action).toMatchObject({ id: 'write-order', sourceNodeId: 'fulfillment-worker', edgeIds: ['worker-to-db'] })
  })

  it('rejects a storage action whose dependency branches have no unique caller', () => {
    const project = createOrderSystemContractFixture()
    project.topology.edges.push({ id: 'orders-to-worker', source: 'orders-service', target: 'fulfillment-worker', sourcePort: 'out', targetPort: 'in', weight: 1, sourceSemantic: 'request', targetSemantic: 'request', routingMode: 'weighted-one' })
    const interaction = project.definitions.interactions[0]!
    interaction.actions.splice(1, 0, { id: 'call-worker', kind: 'service-call', dependsOn: ['call-api'], sourceNodeId: 'orders-service', targetNodeId: 'fulfillment-worker' })
    const data = interaction.actions[2]!
    if (data.kind !== 'data-access') throw new Error('Expected data action')
    data.dependsOn = ['call-api', 'call-worker']
    expect(() => compileSimulationInput(project)).toThrow(/write-order has ambiguous caller context across nodes orders-service, fulfillment-worker/)
  })

  it('rejects disabled action endpoints before runtime', () => {
    const project = createOrderSystemContractFixture()
    project.topology.nodes.find((node) => node.id === 'orders-service')!.disabled = true
    expect(() => compileSimulationInput(project)).toThrow(/disabled or missing target node orders-service/)
  })

  it('rejects cache outcomes on actions that cannot produce them', () => {
    const project = createOrderSystemContractFixture()
    const cache = project.definitions.interactions[0]!.actions[2]!
    cache.condition = { actionId: 'write-order', outcome: 'cache-hit' }
    expect(() => compileSimulationInput(project)).toThrow(/write-order is not a cache get action/)
  })

  it('rejects range reads through hash indexes', () => {
    const project = createOrderSystemContractFixture()
    const model = project.definitions.dataModels[0]!
    if (model.kind !== 'relational') throw new Error('Expected relational model')
    model.tables[0]!.indexes[0]!.kind = 'hash'
    const action = project.definitions.interactions[0]!.actions[1]!
    if (action.kind !== 'data-access') throw new Error('Expected data action')
    action.operation = 'range-read'
    action.indexId = 'ix-customer'
    expect(() => compileSimulationInput(project)).toThrow(/cannot execute a range read through hash index ix-customer/)
  })

  it('labels contract semantics that are still descriptive', () => {
    const compiled = compileSimulationInput(createOrderSystemContractFixture())
    expect(compiled.operations.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('call-api: api.slo is descriptive'),
      expect.stringContaining('write-order: data.columns is descriptive'),
      expect.stringContaining('cache-order: cache.pattern is descriptive'),
      expect.stringContaining('publish-order: event.delivery is descriptive'),
    ]))
    const plan = [...compiled.operations.plans.values()][0]!
    expect(plan.actions.find((action) => action.id === 'write-order')?.descriptiveFields).toContain('data.indexColumns')
  })
})
