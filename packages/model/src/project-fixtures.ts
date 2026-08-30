import { createNode } from './catalog'
import { projectFileV3Schema, type ProjectFileV3 } from './project'

const connection = (id: string, source: string, target: string, overrides: Record<string, unknown> = {}) => ({
  id, source, target, sourcePort: 'out', targetPort: 'in', weight: 1,
  sourceSemantic: 'request', targetSemantic: 'request', routingMode: 'weighted-one', ...overrides,
})

export const createOrderSystemContractFixture = (): ProjectFileV3 => projectFileV3Schema.parse({
  schemaVersion: 3,
  id: 'order-system-contracts',
  name: 'Order system contracts',
  modelingMode: 'business-aware',
  topology: {
    nodes: [
      { ...createNode('traffic', 'client-traffic', { x: 0, y: 0 }, 'capacity-load'), componentVersion: 1, config: {} },
      { ...createNode('service', 'orders-service', { x: 200, y: 0 }), componentVersion: 1 },
      { ...createNode('cache', 'orders-cache', { x: 400, y: -100 }), componentVersion: 1 },
      { ...createNode('database', 'orders-db', { x: 400, y: 100 }), componentVersion: 2 },
      { ...createNode('stream', 'orders-stream', { x: 600, y: 0 }), componentVersion: 1 },
      { ...createNode('service', 'fulfillment-worker', { x: 800, y: 0 }), componentVersion: 1 },
    ],
    edges: [
      connection('client-to-orders', 'client-traffic', 'orders-service'),
      connection('orders-to-cache', 'orders-service', 'orders-cache'),
      connection('orders-to-db', 'orders-service', 'orders-db'),
      connection('orders-to-stream', 'orders-service', 'orders-stream', { sourcePort: 'publish', targetPort: 'consume', sourceSemantic: 'publish', targetSemantic: 'consume', routingMode: 'async-publish' }),
      connection('stream-to-worker', 'orders-stream', 'fulfillment-worker', { sourcePort: 'publish', targetPort: 'consume', sourceSemantic: 'publish', targetSemantic: 'consume', routingMode: 'async-publish' }),
    ],
    groups: [], policies: [],
  },
  definitions: {
    schemaVersion: 1,
    jsonSchemas: [
      { id: 'schema.CreateOrder', version: 1, name: 'Create order', dialect: 'https://json-schema.org/draft/2020-12/schema', schema: { type: 'object', required: ['customerId'], properties: { customerId: { type: 'string' } } } },
      { id: 'schema.Order', version: 1, name: 'Order', dialect: 'https://json-schema.org/draft/2020-12/schema', schema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
      { id: 'schema.OrderCreated', version: 1, name: 'Order created', dialect: 'https://json-schema.org/draft/2020-12/schema', schema: { type: 'object', required: ['orderId'], properties: { orderId: { type: 'string' } } } },
    ],
    apis: [{
      id: 'orders-api', version: 1, name: 'Orders API', ownerNodeId: 'orders-service',
      operations: [{ id: 'create-order', name: 'Create order', method: 'POST', path: '/orders', request: { schema: { schemaId: 'schema.CreateOrder', schemaVersion: 1 }, estimatedBytes: 1_024 }, responses: [{ statusCode: '201', body: { schema: { schemaId: 'schema.Order', schemaVersion: 1 }, estimatedBytes: 2_048 } }], handlerTimeMs: 5, slo: { latencyP95Ms: 250, availability: 0.999 } }],
    }],
    dataModels: [
      {
        id: 'orders-model', version: 1, name: 'Orders relational model', ownerNodeId: 'orders-db', kind: 'relational',
        tables: [{ id: 'orders-table', name: 'orders', columns: [
          { id: 'id', name: 'id', type: { kind: 'uuid' }, nullable: false },
          { id: 'customer-id', name: 'customer_id', type: { kind: 'uuid' }, nullable: false },
          { id: 'status', name: 'status', type: { kind: 'string', maxLength: 32 }, nullable: false },
        ], primaryKey: { id: 'pk-orders', name: 'orders_pk', columnIds: ['id'] }, uniqueKeys: [], foreignKeys: [], indexes: [{ id: 'ix-customer', name: 'orders_customer', columnIds: ['customer-id'], includedColumnIds: ['id', 'status'], kind: 'btree', unique: false }], estimatedRows: 10_000_000, estimatedRowBytes: 512 }],
      },
      { id: 'order-documents', version: 1, name: 'Order documents', ownerNodeId: 'orders-db', kind: 'document', collections: [{ id: 'order-audit', name: 'order_audit', documentSchema: { schemaId: 'schema.Order', schemaVersion: 1 }, partitionKey: '/id', secondaryIndexes: [], estimatedDocuments: 10_000_000, estimatedDocumentBytes: 2_048 }] },
      { id: 'order-kv', version: 1, name: 'Order key value', ownerNodeId: 'orders-db', kind: 'key-value', namespaces: [{ id: 'order-status', name: 'order_status', keySchema: { schemaId: 'schema.Order', schemaVersion: 1 }, valueSchema: { schemaId: 'schema.Order', schemaVersion: 1 }, keyDistribution: { kind: 'hotspot', keySpaceSize: 10_000_000, hotKeyCount: 100, hotTrafficFraction: 0.4 }, estimatedValueBytes: 512, ttlSeconds: 3_600, consistencyHint: 'session' }] },
    ],
    events: [{ id: 'order-created', version: 1, name: 'OrderCreated', payloadSchema: { schemaId: 'schema.OrderCreated', schemaVersion: 1 }, estimatedPayloadBytes: 512, partitionKey: '/orderId', ordering: 'partition-key', delivery: 'at-least-once', producerNodeId: 'orders-service', consumerNodeIds: ['fulfillment-worker'] }],
    cacheKeys: [{ id: 'order-cache-key', version: 1, name: 'Order cache key', pattern: 'order:{id}', valueSchema: { schemaId: 'schema.Order', schemaVersion: 1 }, estimatedValueBytes: 2_048, ttlSeconds: 300 }],
    interactions: [{
      id: 'create-order-flow', version: 1, name: 'Create order flow', entryOperation: { apiId: 'orders-api', apiVersion: 1, operationId: 'create-order' },
      actions: [
        { id: 'call-api', kind: 'api-call', dependsOn: [], sourceNodeId: 'client-traffic', targetNodeId: 'orders-service', operation: { apiId: 'orders-api', apiVersion: 1, operationId: 'create-order' } },
        { id: 'write-order', kind: 'data-access', dependsOn: ['call-api'], nodeId: 'orders-db', model: { modelId: 'orders-model', modelVersion: 1 }, objectId: 'orders-table', operation: 'insert', estimatedRows: 1 },
        { id: 'cache-order', kind: 'cache-access', dependsOn: ['write-order'], nodeId: 'orders-cache', operation: 'put', key: { cacheKeyId: 'order-cache-key', cacheKeyVersion: 1 } },
        { id: 'publish-order', kind: 'event-publish', dependsOn: ['write-order'], producerNodeId: 'orders-service', brokerNodeId: 'orders-stream', event: { eventId: 'order-created', eventVersion: 1 } },
        { id: 'consume-order', kind: 'event-consume', dependsOn: ['publish-order'], consumerNodeId: 'fulfillment-worker', brokerNodeId: 'orders-stream', event: { eventId: 'order-created', eventVersion: 1 } },
      ],
    }],
  },
  experiments: [{
    id: 'baseline', name: 'Baseline',
    workloads: [{ id: 'capacity-load', name: 'Capacity load', sourceNodeId: 'client-traffic', requestsPerSecond: 100, startAtSeconds: 0, durationSeconds: 60, pattern: 'poisson', requestBytes: 1_024 }],
    operationWorkloads: [{ id: 'order-operations', name: 'Order operations', sourceNodeId: 'client-traffic', phases: [{ id: 'warmup', startAtSeconds: 0, durationSeconds: 10, requestsPerSecond: 20, pattern: 'constant' }, { id: 'steady', startAtSeconds: 10, durationSeconds: 50, requestsPerSecond: 100, pattern: 'poisson' }], operationMix: [{ operation: { apiId: 'orders-api', apiVersion: 1, operationId: 'create-order' }, interaction: { interactionId: 'create-order-flow', interactionVersion: 1 }, weight: 1, requestBytes: 1_024, responseBytes: 2_048, keyDistribution: { kind: 'hotspot', keySpaceSize: 10_000_000, hotKeyCount: 100, hotTrafficFraction: 0.4 }, valueSizeDistribution: { kind: 'fixed', bytes: 512 } }] }],
    faults: [], simulation: { durationSeconds: 60, sampleIntervalMs: 1_000, maxRequests: 100_000, traceLimit: 200, maxHops: 64 }, seed: 'order-system-contracts',
  }],
  activeExperimentId: 'baseline',
})
