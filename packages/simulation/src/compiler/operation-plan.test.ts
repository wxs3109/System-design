import { describe, expect, it } from 'vitest'
import { createNode, createOrderSystemContractFixture } from '@system-design/model'
import { compileSimulationInput } from './compiler'

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
