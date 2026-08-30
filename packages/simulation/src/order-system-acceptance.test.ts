import { describe, expect, it } from 'vitest'
import {
  createOrderSystemContractFixture,
  parseProjectFile,
  type ApiOperationReference,
  type InteractionDefinition,
  type OperationMixEntry,
  type ProjectFileV3,
} from '@system-design/model'
import { runSimulation } from './engine'

type Fixture = ReturnType<typeof createOrderSystemContractFixture>

const sameOperation = (left: ApiOperationReference, right: ApiOperationReference) =>
  left.apiId === right.apiId && left.apiVersion === right.apiVersion && left.operationId === right.operationId

const operationByRoute = (project: Fixture, method: string, path: string): ApiOperationReference => {
  for (const api of project.definitions.apis) {
    const operation = api.operations.find((candidate) => candidate.method === method && candidate.path === path)
    if (operation) return { apiId: api.id, apiVersion: api.version, operationId: operation.id }
  }
  throw new Error(`Missing ${method} ${path} in the generic order-system fixture.`)
}

const interactionFor = (project: Fixture, operation: ApiOperationReference): InteractionDefinition => {
  const interaction = project.definitions.interactions.find((candidate) => sameOperation(candidate.entryOperation, operation))
  if (!interaction) throw new Error(`Missing interaction for ${operation.operationId}.`)
  return interaction
}

const indexedQueryOperation = (project: Fixture): ApiOperationReference => {
  const interaction = project.definitions.interactions.find((candidate) => candidate.actions.some((action) => action.kind === 'data-access' && action.operation === 'index-read'))
  if (!interaction) throw new Error('Missing the indexed customer-order interaction.')
  return interaction.entryOperation
}

const mixFor = (project: Fixture, operation: ApiOperationReference): OperationMixEntry => {
  const mix = project.experiments.flatMap((experiment) => experiment.operationWorkloads)
    .flatMap((workload) => workload.operationMix)
    .find((candidate) => sameOperation(candidate.operation, operation))
  if (!mix) throw new Error(`Missing workload mix for ${operation.operationId}.`)
  return structuredClone(mix)
}

const makeDeterministic = (project: Fixture) => {
  for (const node of project.topology.nodes) {
    if (node.type === 'service') Object.assign(node.config, { replicas: 4, concurrencyPerReplica: 100, serviceTimeMs: 0.5, jitterMs: 0, errorRate: 0, maxQueueSize: 10_000 })
    if (node.type === 'database') Object.assign(node.config, { maxConnections: 500, queryTimeMs: 10, jitterMs: 0, errorRate: 0, maxQueueSize: 10_000, shardCount: 8, replicasPerShard: 1, readPreference: 'primary' })
    if (node.type === 'cache') Object.assign(node.config, { maxConcurrentRequests: 500, operationTimeMs: 0.1, jitterMs: 0, errorRate: 0, maxQueueSize: 10_000, capacityEntries: 10_000, ttlMs: 60_000 })
    if (node.type === 'stream') Object.assign(node.config, { maxConcurrentRequests: 500, publishTimeMs: 0.1, consumeTimeMs: 0.1, jitterMs: 0, errorRate: 0, maxQueueSize: 10_000 })
  }
}

const withOperationMix = (
  project: Fixture,
  entries: Array<{ operation: ApiOperationReference; weight: number; keyDistribution?: OperationMixEntry['keyDistribution'] }>,
  requestsPerSecond = 100,
  durationSeconds = 1,
  traceLimit = 100,
) => {
  const experiment = project.experiments.find((candidate) => candidate.id === project.activeExperimentId)!
  const source = experiment.operationWorkloads[0]?.sourceNodeId ?? 'client-traffic'
  experiment.operationWorkloads = [{
    id: 'order-acceptance',
    name: 'Order acceptance workload',
    sourceNodeId: source,
    phases: [{ id: 'acceptance', startAtSeconds: 0, durationSeconds, requestsPerSecond, pattern: 'constant' }],
    operationMix: entries.map(({ operation, weight, keyDistribution }) => ({
      ...mixFor(project, operation),
      weight,
      ...(keyDistribution === undefined ? {} : { keyDistribution }),
    })),
  }]
  experiment.simulation = { durationSeconds: Math.max(5, durationSeconds + 3), sampleIntervalMs: 100, maxRequests: 2_000, traceLimit, maxHops: 64 }
  makeDeterministic(project)
  return project
}

const singleOperation = (
  operation: ApiOperationReference,
  options: { requestsPerSecond?: number; durationSeconds?: number; traceLimit?: number; keyDistribution?: OperationMixEntry['keyDistribution'] } = {},
) => withOperationMix(createOrderSystemContractFixture(), [{ operation, weight: 1, keyDistribution: options.keyDistribution }], options.requestsPerSecond, options.durationSeconds, options.traceLimit)

const actionMetric = (result: Awaited<ReturnType<typeof runSimulation>>, operationId: string, actionId: string) => {
  const metric = result.actions.find((candidate) => candidate.operationId === operationId && candidate.actionId === actionId)
  if (!metric) throw new Error(`Missing action metric ${operationId}/${actionId}.`)
  return metric
}

const ancestorsOf = (interaction: InteractionDefinition, actionId: string) => {
  const actions = new Map(interaction.actions.map((action) => [action.id, action]))
  const ancestors = new Set<string>()
  const visit = (id: string) => {
    const action = actions.get(id)
    for (const dependency of action?.dependsOn ?? []) if (!ancestors.has(dependency)) { ancestors.add(dependency); visit(dependency) }
  }
  visit(actionId)
  return ancestors
}

describe('P2.5 generic order-system acceptance', () => {
  it('stores a complete generic API, relational model, interaction, and workload fixture', () => {
    const project = createOrderSystemContractFixture()
    expect(parseProjectFile(JSON.parse(JSON.stringify(project)))).toEqual(project)

    const createOrder = operationByRoute(project, 'POST', '/orders')
    const getOrder = operationByRoute(project, 'GET', '/orders/{id}')
    const customerQuery = indexedQueryOperation(project)
    expect(new Set([createOrder.operationId, getOrder.operationId, customerQuery.operationId]).size).toBe(3)

    const relational = project.definitions.dataModels.find((model) => model.kind === 'relational')
    if (!relational || relational.kind !== 'relational') throw new Error('Missing relational order model.')
    const normalizedName = (name: string) => name.toLowerCase().replaceAll('_', '').replaceAll('-', '')
    const orders = relational.tables.find((table) => normalizedName(table.name) === 'orders')
    const items = relational.tables.find((table) => normalizedName(table.name) === 'orderitems')
    expect(orders?.columns.length).toBeGreaterThanOrEqual(3)
    expect(items?.columns.length).toBeGreaterThanOrEqual(3)
    expect(orders?.columns.every((column) => Boolean(column.type.kind))).toBe(true)
    expect(items?.columns.every((column) => Boolean(column.type.kind))).toBe(true)
    const orderForeignKey = items?.foreignKeys.find((key) => key.referencedTableId === orders?.id)
    expect(orderForeignKey).toBeDefined()
    expect(orderForeignKey?.referencedColumnIds).toEqual(orders?.primaryKey.columnIds)

    const createFlow = interactionFor(project, createOrder)
    const inserts = createFlow.actions.filter((action): action is Extract<typeof action, { kind: 'data-access' }> => action.kind === 'data-access' && action.operation === 'insert')
    expect(new Set(inserts.map((action) => action.objectId))).toEqual(new Set([orders?.id, items?.id]))
    const publish = createFlow.actions.find((action) => action.kind === 'event-publish')
    const consume = createFlow.actions.find((action) => action.kind === 'event-consume')
    expect(publish).toBeDefined()
    expect(consume).toBeDefined()
    const publishAncestors = ancestorsOf(createFlow, publish!.id)
    expect(inserts.every((action) => publishAncestors.has(action.id))).toBe(true)
    expect(ancestorsOf(createFlow, consume!.id)).toContain(publish!.id)

    const readFlow = interactionFor(project, getOrder)
    const cacheGet = readFlow.actions.find((action) => action.kind === 'cache-access' && action.operation === 'get')
    const missRead = readFlow.actions.find((action) => action.kind === 'data-access')
    const cachePut = readFlow.actions.find((action) => action.kind === 'cache-access' && action.operation === 'put')
    expect(cacheGet).toBeDefined()
    expect(missRead?.condition).toEqual({ actionId: cacheGet?.id, outcome: 'cache-miss' })
    expect(cachePut?.condition).toEqual({ actionId: cacheGet?.id, outcome: 'cache-miss' })
    expect(cachePut?.dependsOn).toContain(missRead?.id)

    const queryFlow = interactionFor(project, customerQuery)
    const indexedRead = queryFlow.actions.find((action) => action.kind === 'data-access')
    expect(indexedRead).toMatchObject({ kind: 'data-access', operation: 'index-read', objectId: orders?.id })
    expect(indexedRead && 'indexId' in indexedRead ? indexedRead.indexId : undefined).toBeTruthy()

    const mixedOperations = project.experiments.flatMap((experiment) => experiment.operationWorkloads).flatMap((workload) => workload.operationMix)
    expect(mixedOperations.some((mix) => sameOperation(mix.operation, createOrder))).toBe(true)
    expect(mixedOperations.some((mix) => sameOperation(mix.operation, getOrder))).toBe(true)
    expect(mixedOperations.some((mix) => sameOperation(mix.operation, customerQuery))).toBe(true)
  })

  it('executes cache-aside reads with one miss path followed by measured hits', async () => {
    const fixture = createOrderSystemContractFixture()
    const getOrder = operationByRoute(fixture, 'GET', '/orders/{id}')
    const project = withOperationMix(fixture, [{
      operation: getOrder,
      weight: 1,
      keyDistribution: { kind: 'hotspot', keySpaceSize: 1, hotKeyCount: 1, hotTrafficFraction: 1 },
    }], 50, 1, 100)
    const flow = interactionFor(project, getOrder)
    const cacheGet = flow.actions.find((action) => action.kind === 'cache-access' && action.operation === 'get')!
    const databaseRead = flow.actions.find((action) => action.kind === 'data-access')!

    const result = await runSimulation(project, 'order-cache-aside')
    const cacheMetric = actionMetric(result, getOrder.operationId, cacheGet.id)
    const databaseMetric = actionMetric(result, getOrder.operationId, databaseRead.id)
    const cacheNode = result.nodes.find((node) => node.nodeId === 'orders-cache')

    expect(result.events.some((event) => event.type === 'cache-miss' && event.actionId === cacheGet.id)).toBe(true)
    expect(result.events.some((event) => event.type === 'cache-hit' && event.actionId === cacheGet.id)).toBe(true)
    expect(Number(cacheNode?.details.cacheHitRate)).toBeGreaterThan(0.8)
    expect(databaseMetric.completed).toBeGreaterThan(0)
    expect(databaseMetric.completed).toBeLessThan(cacheMetric.completed)
  })

  it('makes a declared customer index cheaper than the equivalent scan and explains both costs', async () => {
    const fixture = createOrderSystemContractFixture()
    const query = indexedQueryOperation(fixture)
    const indexed = withOperationMix(fixture, [{ operation: query, weight: 1 }], 10, 1, 20)
    indexed.experiments[0]!.simulation.durationSeconds = 60
    const indexedAction = interactionFor(indexed, query).actions.find((action) => action.kind === 'data-access')!
    const scan = structuredClone(indexed) as ProjectFileV3
    const scanAction = interactionFor(scan, query).actions.find((action) => action.kind === 'data-access')
    if (!scanAction || scanAction.kind !== 'data-access') throw new Error('Missing customer query data action.')
    scanAction.operation = 'scan'
    delete scanAction.indexId

    const [indexedResult, scanResult] = await Promise.all([
      runSimulation(indexed, 'order-query-comparison'),
      runSimulation(scan, 'order-query-comparison'),
    ])
    const indexedMetric = actionMetric(indexedResult, query.operationId, indexedAction.id)
    const scanMetric = actionMetric(scanResult, query.operationId, scanAction.id)
    const indexedEvidence = indexedResult.events.find((event) => event.type === 'database-read' && event.actionId === indexedAction.id)
    const scanEvidence = scanResult.events.find((event) => event.type === 'database-read' && event.actionId === scanAction.id)

    expect(scanMetric.recordsExamined).toBeGreaterThan(indexedMetric.recordsExamined)
    expect(scanMetric.averageDurationMs).toBeGreaterThan(indexedMetric.averageDurationMs)
    expect(scanResult.summary.latencyP95Ms).toBeGreaterThan(indexedResult.summary.latencyP95Ms)
    expect(indexedMetric.explanation).toMatch(/index lookup/i)
    expect(scanMetric.explanation).toMatch(/scan examines all/i)
    expect(String(indexedEvidence?.attributes.explanation)).toMatch(/index lookup/i)
    expect(String(scanEvidence?.attributes.explanation)).toMatch(/scan examines all/i)
  })

  it('shows hot customer keys concentrating load on fewer database shards', async () => {
    const fixture = createOrderSystemContractFixture()
    const query = indexedQueryOperation(fixture)
    const uniform = withOperationMix(fixture, [{ operation: query, weight: 1, keyDistribution: { kind: 'uniform', keySpaceSize: 100_000 } }], 200, 1, 0)
    const hot = structuredClone(uniform) as ProjectFileV3
    hot.experiments[0]!.operationWorkloads[0]!.operationMix[0]!.keyDistribution = { kind: 'hotspot', keySpaceSize: 100_000, hotKeyCount: 1, hotTrafficFraction: 1 }

    const [uniformResult, hotResult] = await Promise.all([runSimulation(uniform, 'order-key-skew'), runSimulation(hot, 'order-key-skew')])
    const hottestShare = (result: typeof uniformResult) => Number(result.nodes.find((node) => node.nodeId === 'orders-db')?.details.hottestShardShare)
    expect(hottestShare(hotResult)).toBeGreaterThan(0.95)
    expect(hottestShare(hotResult)).toBeGreaterThan(hottestShare(uniformResult))
  })

  it('measures fewer database reads and lower latency with the cache-aside path enabled', async () => {
    const fixture = createOrderSystemContractFixture()
    const getOrder = operationByRoute(fixture, 'GET', '/orders/{id}')
    const cached = withOperationMix(fixture, [{ operation: getOrder, weight: 1, keyDistribution: { kind: 'hotspot', keySpaceSize: 1, hotKeyCount: 1, hotTrafficFraction: 1 } }], 40, 1, 100)
    const cachedFlow = interactionFor(cached, getOrder)
    const cachedRead = cachedFlow.actions.find((action) => action.kind === 'data-access')!
    const uncached = structuredClone(cached) as ProjectFileV3
    const uncachedFlow = interactionFor(uncached, getOrder)
    const removed = new Set(uncachedFlow.actions.filter((action) => action.kind === 'cache-access').map((action) => action.id))
    uncachedFlow.actions = uncachedFlow.actions.filter((action) => !removed.has(action.id)).map((action) => {
      const dependencies = action.dependsOn.filter((dependency) => !removed.has(dependency))
      const condition = action.condition && removed.has(action.condition.actionId) ? undefined : action.condition
      const { condition: _condition, ...withoutCondition } = action
      return { ...withoutCondition, dependsOn: dependencies.length === 0 && action.kind === 'data-access' ? [uncachedFlow.actions[0]!.id] : dependencies, ...(condition === undefined ? {} : { condition }) }
    }) as InteractionDefinition['actions']

    const [cachedResult, uncachedResult] = await Promise.all([runSimulation(cached, 'order-cache-config'), runSimulation(uncached, 'order-cache-config')])
    const cachedReads = actionMetric(cachedResult, getOrder.operationId, cachedRead.id).completed
    const uncachedReads = actionMetric(uncachedResult, getOrder.operationId, cachedRead.id).completed
    expect(cachedReads).toBeLessThan(uncachedReads)
    expect(cachedResult.summary.latencyP95Ms).toBeLessThan(uncachedResult.summary.latencyP95Ms)
  })

  it('changes measured operation, database, and event traffic with read/write weights', async () => {
    const fixture = createOrderSystemContractFixture()
    const createOrder = operationByRoute(fixture, 'POST', '/orders')
    const getOrder = operationByRoute(fixture, 'GET', '/orders/{id}')
    const readHeavy = withOperationMix(fixture, [{ operation: createOrder, weight: 1 }, { operation: getOrder, weight: 9 }], 100, 2, 0)
    const writeHeavy = structuredClone(readHeavy) as ProjectFileV3
    writeHeavy.experiments[0]!.operationWorkloads[0]!.operationMix[0]!.weight = 9
    writeHeavy.experiments[0]!.operationWorkloads[0]!.operationMix[1]!.weight = 1

    const [readResult, writeResult] = await Promise.all([runSimulation(readHeavy, 'order-mix'), runSimulation(writeHeavy, 'order-mix')])
    const generated = (result: typeof readResult, operationId: string) => result.operations.find((operation) => operation.operationId === operationId)?.generatedRequests ?? 0
    const completedActions = (result: typeof readResult, operationId: string, actionKind: string) => result.actions
      .filter((action) => action.operationId === operationId && action.actionKind === actionKind)
      .reduce((total, action) => total + action.completed, 0)

    expect(generated(readResult, getOrder.operationId)).toBeGreaterThan(generated(readResult, createOrder.operationId))
    expect(generated(writeResult, createOrder.operationId)).toBeGreaterThan(generated(writeResult, getOrder.operationId))
    expect(completedActions(writeResult, createOrder.operationId, 'data-access')).toBeGreaterThan(completedActions(readResult, createOrder.operationId, 'data-access'))
    expect(completedActions(readResult, getOrder.operationId, 'data-access')).toBeGreaterThan(completedActions(writeResult, getOrder.operationId, 'data-access'))
    expect(completedActions(writeResult, createOrder.operationId, 'event-publish')).toBeGreaterThan(completedActions(readResult, createOrder.operationId, 'event-publish'))
  })

  it('replays exactly and preserves write-before-publish-before-consume causality', async () => {
    const fixture = createOrderSystemContractFixture()
    const createOrder = operationByRoute(fixture, 'POST', '/orders')
    const project = withOperationMix(fixture, [{ operation: createOrder, weight: 1 }], 5, 0.2, 10)

    const [first, replay] = await Promise.all([
      runSimulation(project, 'order-causality'),
      runSimulation(structuredClone(project), 'order-causality'),
    ])
    expect(replay.events).toEqual(first.events)
    expect(replay.summary).toEqual(first.summary)
    expect(replay.operations).toEqual(first.operations)
    expect(replay.actions).toEqual(first.actions)

    const traceId = first.events.find((event) => event.operationId === createOrder.operationId && event.type === 'operation-started')?.traceId
    const trace = first.events.filter((event) => event.traceId === traceId)
    const writes = trace.filter((event) => event.type === 'database-written')
    const publish = trace.find((event) => event.type === 'message-published')
    const consume = trace.find((event) => event.type === 'message-consumed')
    expect(writes).toHaveLength(2)
    expect(publish).toBeDefined()
    expect(consume).toBeDefined()
    expect(Math.max(...writes.map((event) => event.sequence))).toBeLessThan(publish!.sequence)
    expect(publish!.sequence).toBeLessThan(consume!.sequence)
  })
})
