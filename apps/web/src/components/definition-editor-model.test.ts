import { describe, expect, it } from 'vitest'
import { performance } from 'node:perf_hooks'
import { createEmptyProject, createOrderSystemContractFixture, projectFileV3Schema } from '@system-design/model'
import {
  addDefinitionResource,
  buildDefinitionTopologyBinding,
  createDefinitionResource,
  findDefinitionResource,
  listDefinitionResources,
  removeDefinitionResource,
  replaceDefinitionResource,
  validateDefinitionCandidate,
} from './definition-editor-model'

describe('definition editor project transforms', () => {
  it('lists and finds every project-level definition and active operation workload', () => {
    const project = createOrderSystemContractFixture()
    expect(listDefinitionResources(project, 'jsonSchemas')).toHaveLength(3)
    expect(listDefinitionResources(project, 'dataModels').map((item) => item.detail)).toEqual([
      'relational · 2 objects', 'document · 1 objects', 'key-value · 1 objects',
    ])
    expect(listDefinitionResources(project, 'operationWorkloads')).toEqual([expect.objectContaining({ id: 'order-operations', kind: 'operationWorkloads' })])
    expect(findDefinitionResource(project, { kind: 'events', id: 'order-created', version: 1 })).toMatchObject({ name: 'OrderCreated' })
  })

  it('projects an interaction onto exact executable topology paths with step labels', () => {
    const project = createOrderSystemContractFixture()
    const binding = buildDefinitionTopologyBinding(project, { kind: 'interactions', id: 'create-order-flow', version: 1 })!
    expect(binding.nodeIds).toEqual(new Set(['client-traffic', 'orders-service', 'orders-db', 'orders-cache', 'orders-stream', 'fulfillment-worker']))
    expect(binding.edgeIds).toEqual(new Set(['client-to-orders', 'orders-to-db', 'orders-to-cache', 'orders-to-stream', 'stream-to-worker']))
    expect(binding.edgeLabels.get('client-to-orders')).toBe('1. Create order')
    expect(binding.edgeLabels.get('orders-to-db')).toContain('2. insert orders')
    expect(binding.edgeLabels.get('orders-to-db')).toContain('3. insert order_items')
    expect(binding.edgeLabels.get('orders-to-stream')).toBe('5. Publish OrderCreated')
    expect(binding.edgeLabels.get('stream-to-worker')).toBe('6. Consume OrderCreated')

    const modelBinding = buildDefinitionTopologyBinding(project, { kind: 'dataModels', id: 'orders-model', version: 1 })!
    expect(modelBinding.nodeIds).toEqual(new Set(['orders-db']))
    expect(modelBinding.edgeIds).toEqual(new Set())
  })

  it('creates resources with safe references and switches a capacity project to business-aware', () => {
    let project = createEmptyProject('editor-create')
    project.topology.nodes = [
      { id: 'traffic', name: 'Traffic', type: 'traffic', componentVersion: 1, position: { x: 0, y: 0 }, config: {} },
      { id: 'service', name: 'Service', type: 'service', componentVersion: 1, position: { x: 0, y: 0 }, config: { replicas: 1, concurrencyPerReplica: 1, serviceTimeMs: 1, jitterMs: 0, errorRate: 0, maxQueueSize: 10 } },
      { id: 'workflow', name: 'Workflow', type: 'workflow', componentVersion: 1, position: { x: 0, y: 0 }, config: { maxConcurrentInstances: 10, persistenceTimeMs: 1, defaultStepTimeMs: 10, jitterMs: 0, errorRate: 0, maxQueueSize: 10 } },
      { id: 'database', name: 'Database', type: 'database', componentVersion: 2, position: { x: 0, y: 0 }, config: { maxConnections: 10, queryTimeMs: 1, jitterMs: 0, errorRate: 0, maxQueueSize: 10, shardCount: 1, replicasPerShard: 1, readPreference: 'primary', replicationDelayMs: 10, writeRatio: 0.5, keySpaceSize: 1000, hotKeyProbability: 0 } },
    ]
    project.experiments[0]!.workloads = [{ id: 'capacity-load', name: 'Capacity load', sourceNodeId: 'traffic', requestsPerSecond: 1, startAtSeconds: 0, durationSeconds: 30, pattern: 'constant', requestBytes: 1 }]
    for (const [kind, modelKind] of [['jsonSchemas'], ['apis'], ['dataModels', 'relational'], ['events'], ['cacheKeys'], ['workflows'], ['interactions'], ['operationWorkloads']] as const) {
      project = addDefinitionResource(project, kind, createDefinitionResource(project, kind, modelKind))
    }
    expect(project.modelingMode).toBe('business-aware')
    expect(() => projectFileV3Schema.parse(project)).not.toThrow()
  })

  it('replaces valid drafts, exposes inline paths for broken references, and rejects deletions with dependents', () => {
    const project = createOrderSystemContractFixture()
    const selection = { kind: 'apis' as const, id: 'orders-api', version: 1 }
    const api = structuredClone(findDefinitionResource(project, selection)!)
    if (!('operations' in api)) throw new Error('Expected an API')
    api.operations[0]!.handlerTimeMs = 42
    const valid = validateDefinitionCandidate(project, selection, api)
    expect(valid.issues).toEqual([])
    expect(valid.project?.definitions.apis[0]?.operations[0]?.handlerTimeMs).toBe(42)

    api.ownerNodeId = 'missing-service'
    expect(validateDefinitionCandidate(project, selection, api).issues).toContainEqual(expect.objectContaining({
      path: ['definitions', 'apis', 0, 'ownerNodeId'], message: 'Unknown topology node: missing-service',
    }))

    const removed = removeDefinitionResource(project, { kind: 'jsonSchemas', id: 'schema.Order', version: 1 })
    const removalResult = projectFileV3Schema.safeParse(removed)
    expect(removalResult.success).toBe(false)
    if (!removalResult.success) expect(removalResult.error.issues).toContainEqual(expect.objectContaining({
      path: ['definitions', 'dataModels', 1, 'collections', 0, 'documentSchema'],
      message: 'Unknown JSON Schema: schema.Order@1',
    }))
    expect(replaceDefinitionResource(project, selection, api).definitions.apis[0]?.ownerNodeId).toBe('missing-service')
  })

  it('lists and updates large definition catalogs within the editor budget', () => {
    const project = createOrderSystemContractFixture()
    const template = project.definitions.jsonSchemas[0]!
    project.definitions.jsonSchemas = Array.from({ length: 1_000 }, (_, index) => ({ ...structuredClone(template), id: `schema.Item${index}`, name: `Item ${index}` }))
    const start = performance.now()
    const listed = listDefinitionResources(project, 'jsonSchemas')
    const selected = listed[750]!
    const resource = findDefinitionResource(project, selected)!
    const replaced = replaceDefinitionResource(project, selected, { ...resource, name: 'Edited item' })
    expect(listed).toHaveLength(1_000)
    expect(replaced.definitions.jsonSchemas[750]!.name).toBe('Edited item')
    expect(performance.now() - start).toBeLessThan(100)
  })
})
