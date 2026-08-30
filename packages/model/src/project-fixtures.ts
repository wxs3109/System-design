import { createNode } from './catalog'
import { projectFileV3Schema, type ProjectFileV3 } from './project'

const connection = (id: string, source: string, target: string, overrides: Record<string, unknown> = {}) => ({
  id, source, target, sourcePort: 'out', targetPort: 'in', weight: 1,
  sourceSemantic: 'request' as const, targetSemantic: 'request' as const, routingMode: 'weighted-one' as const, ...overrides,
})

export const createOrderSystemContractFixture = (): ProjectFileV3 => projectFileV3Schema.parse({
  schemaVersion: 3,
  id: 'order-system-contracts',
  name: 'Order system contracts',
  modelingMode: 'business-aware',
  topology: {
    nodes: [
      { ...createNode('traffic', 'client-traffic', { x: 0, y: 0 }, 'capacity-load'), name: 'Client traffic', componentVersion: 1, config: {} },
      { ...createNode('service', 'orders-service', { x: 200, y: 0 }), name: 'Orders service', componentVersion: 1 },
      { ...createNode('cache', 'orders-cache', { x: 400, y: -100 }), name: 'Order cache', componentVersion: 1 },
      { ...createNode('database', 'orders-db', { x: 400, y: 100 }), name: 'Orders database', componentVersion: 2 },
      { ...createNode('stream', 'orders-stream', { x: 600, y: 0 }), name: 'Order events', componentVersion: 1 },
      { ...createNode('service', 'fulfillment-worker', { x: 800, y: 0 }), name: 'Fulfillment worker', componentVersion: 1 },
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
      operations: [
        { id: 'create-order', name: 'Create order', method: 'POST', path: '/orders', request: { schema: { schemaId: 'schema.CreateOrder', schemaVersion: 1 }, estimatedBytes: 1_024 }, responses: [{ statusCode: '201', body: { schema: { schemaId: 'schema.Order', schemaVersion: 1 }, estimatedBytes: 2_048 } }], handlerTimeMs: 5, slo: { latencyP95Ms: 250, availability: 0.999 } },
        { id: 'get-order', name: 'Get order', method: 'GET', path: '/orders/{id}', responses: [{ statusCode: '200', body: { schema: { schemaId: 'schema.Order', schemaVersion: 1 }, estimatedBytes: 2_048 } }, { statusCode: '404' }], handlerTimeMs: 2, slo: { latencyP95Ms: 100, availability: 0.999 } },
        { id: 'list-customer-orders', name: 'List customer orders', method: 'GET', path: '/orders', responses: [{ statusCode: '200', body: { schema: { schemaId: 'schema.Order', schemaVersion: 1 }, estimatedBytes: 8_192 } }], handlerTimeMs: 3, slo: { latencyP95Ms: 150, availability: 0.999 } },
      ],
    }],
    dataModels: [
      {
        id: 'orders-model', version: 1, name: 'Orders relational model', ownerNodeId: 'orders-db', kind: 'relational',
        tables: [
          { id: 'orders-table', name: 'orders', columns: [
            { id: 'id', name: 'id', type: { kind: 'uuid' }, nullable: false },
            { id: 'customer-id', name: 'customer_id', type: { kind: 'uuid' }, nullable: false },
            { id: 'status', name: 'status', type: { kind: 'string', maxLength: 32 }, nullable: false },
            { id: 'total', name: 'total', type: { kind: 'decimal', precision: 12, scale: 2 }, nullable: false },
            { id: 'created-at', name: 'created_at', type: { kind: 'datetime' }, nullable: false },
          ], primaryKey: { id: 'pk-orders', name: 'orders_pk', columnIds: ['id'] }, uniqueKeys: [], foreignKeys: [], indexes: [{ id: 'ix-customer', name: 'orders_customer', columnIds: ['customer-id', 'created-at'], includedColumnIds: ['id', 'status', 'total'], kind: 'btree', unique: false }], estimatedRows: 10_000_000, estimatedRowBytes: 512 },
          { id: 'order-items-table', name: 'order_items', columns: [
            { id: 'id', name: 'id', type: { kind: 'uuid' }, nullable: false },
            { id: 'order-id', name: 'order_id', type: { kind: 'uuid' }, nullable: false },
            { id: 'product-id', name: 'product_id', type: { kind: 'uuid' }, nullable: false },
            { id: 'quantity', name: 'quantity', type: { kind: 'integer', bits: 32 }, nullable: false },
            { id: 'unit-price', name: 'unit_price', type: { kind: 'decimal', precision: 12, scale: 2 }, nullable: false },
          ], primaryKey: { id: 'pk-order-items', name: 'order_items_pk', columnIds: ['id'] }, uniqueKeys: [], foreignKeys: [{ id: 'fk-items-order', name: 'order_items_order_fk', columnIds: ['order-id'], referencedTableId: 'orders-table', referencedColumnIds: ['id'] }], indexes: [{ id: 'ix-items-order', name: 'order_items_order', columnIds: ['order-id'], includedColumnIds: ['product-id', 'quantity', 'unit-price'], kind: 'btree', unique: false }], estimatedRows: 30_000_000, estimatedRowBytes: 256 },
        ],
      },
      { id: 'order-documents', version: 1, name: 'Order documents', ownerNodeId: 'orders-db', kind: 'document', collections: [{ id: 'order-audit', name: 'order_audit', documentSchema: { schemaId: 'schema.Order', schemaVersion: 1 }, partitionKey: '/id', secondaryIndexes: [], estimatedDocuments: 10_000_000, estimatedDocumentBytes: 2_048 }] },
      { id: 'order-kv', version: 1, name: 'Order key value', ownerNodeId: 'orders-db', kind: 'key-value', namespaces: [{ id: 'order-status', name: 'order_status', keySchema: { schemaId: 'schema.Order', schemaVersion: 1 }, valueSchema: { schemaId: 'schema.Order', schemaVersion: 1 }, keyDistribution: { kind: 'hotspot', keySpaceSize: 10_000_000, hotKeyCount: 100, hotTrafficFraction: 0.4 }, estimatedValueBytes: 512, ttlSeconds: 3_600, consistencyHint: 'session' }] },
    ],
    events: [{ id: 'order-created', version: 1, name: 'OrderCreated', payloadSchema: { schemaId: 'schema.OrderCreated', schemaVersion: 1 }, estimatedPayloadBytes: 512, partitionKey: '/orderId', ordering: 'partition-key', delivery: 'at-least-once', producerNodeId: 'orders-service', consumerNodeIds: ['fulfillment-worker'] }],
    cacheKeys: [{ id: 'order-cache-key', version: 1, name: 'Order cache key', pattern: 'order:{id}', valueSchema: { schemaId: 'schema.Order', schemaVersion: 1 }, estimatedValueBytes: 2_048, ttlSeconds: 300 }],
    interactions: [
      {
        id: 'create-order-flow', version: 1, name: 'Create order flow', entryOperation: { apiId: 'orders-api', apiVersion: 1, operationId: 'create-order' },
        actions: [
          { id: 'call-api', kind: 'api-call', dependsOn: [], sourceNodeId: 'client-traffic', targetNodeId: 'orders-service', operation: { apiId: 'orders-api', apiVersion: 1, operationId: 'create-order' } },
          { id: 'write-order', kind: 'data-access', dependsOn: ['call-api'], nodeId: 'orders-db', model: { modelId: 'orders-model', modelVersion: 1 }, objectId: 'orders-table', operation: 'insert', estimatedRows: 1 },
          { id: 'write-order-items', kind: 'data-access', dependsOn: ['write-order'], nodeId: 'orders-db', model: { modelId: 'orders-model', modelVersion: 1 }, objectId: 'order-items-table', operation: 'insert', estimatedRows: 3 },
          { id: 'cache-order', kind: 'cache-access', dependsOn: ['write-order'], nodeId: 'orders-cache', operation: 'put', key: { cacheKeyId: 'order-cache-key', cacheKeyVersion: 1 } },
          { id: 'publish-order', kind: 'event-publish', dependsOn: ['write-order', 'write-order-items'], producerNodeId: 'orders-service', brokerNodeId: 'orders-stream', event: { eventId: 'order-created', eventVersion: 1 } },
          { id: 'consume-order', kind: 'event-consume', dependsOn: ['publish-order'], consumerNodeId: 'fulfillment-worker', brokerNodeId: 'orders-stream', event: { eventId: 'order-created', eventVersion: 1 } },
        ],
      },
      {
        id: 'get-order-flow', version: 1, name: 'Get order with cache aside', entryOperation: { apiId: 'orders-api', apiVersion: 1, operationId: 'get-order' },
        actions: [
          { id: 'get-order-api', kind: 'api-call', dependsOn: [], sourceNodeId: 'client-traffic', targetNodeId: 'orders-service', operation: { apiId: 'orders-api', apiVersion: 1, operationId: 'get-order' } },
          { id: 'get-order-cache', kind: 'cache-access', dependsOn: ['get-order-api'], nodeId: 'orders-cache', operation: 'get', key: { cacheKeyId: 'order-cache-key', cacheKeyVersion: 1 } },
          { id: 'read-order', kind: 'data-access', dependsOn: ['get-order-cache'], condition: { actionId: 'get-order-cache', outcome: 'cache-miss' }, nodeId: 'orders-db', model: { modelId: 'orders-model', modelVersion: 1 }, objectId: 'orders-table', operation: 'point-read', estimatedRows: 1 },
          { id: 'put-order-cache', kind: 'cache-access', dependsOn: ['read-order'], condition: { actionId: 'get-order-cache', outcome: 'cache-miss' }, nodeId: 'orders-cache', operation: 'put', key: { cacheKeyId: 'order-cache-key', cacheKeyVersion: 1 } },
        ],
      },
      {
        id: 'list-customer-orders-flow', version: 1, name: 'List customer orders by index', entryOperation: { apiId: 'orders-api', apiVersion: 1, operationId: 'list-customer-orders' },
        actions: [
          { id: 'list-orders-api', kind: 'api-call', dependsOn: [], sourceNodeId: 'client-traffic', targetNodeId: 'orders-service', operation: { apiId: 'orders-api', apiVersion: 1, operationId: 'list-customer-orders' } },
          { id: 'read-customer-orders', kind: 'data-access', dependsOn: ['list-orders-api'], nodeId: 'orders-db', model: { modelId: 'orders-model', modelVersion: 1 }, objectId: 'orders-table', operation: 'index-read', indexId: 'ix-customer', estimatedRows: 25 },
        ],
      },
    ],
  },
  experiments: [{
    id: 'baseline', name: 'Baseline',
    workloads: [{ id: 'capacity-load', name: 'Capacity load', sourceNodeId: 'client-traffic', requestsPerSecond: 100, startAtSeconds: 0, durationSeconds: 60, pattern: 'poisson', requestBytes: 1_024 }],
    operationWorkloads: [{ id: 'order-operations', name: 'Order operations', sourceNodeId: 'client-traffic', phases: [{ id: 'warmup', startAtSeconds: 0, durationSeconds: 10, requestsPerSecond: 20, pattern: 'constant' }, { id: 'steady', startAtSeconds: 10, durationSeconds: 50, requestsPerSecond: 100, pattern: 'poisson' }], operationMix: [
      { operation: { apiId: 'orders-api', apiVersion: 1, operationId: 'create-order' }, interaction: { interactionId: 'create-order-flow', interactionVersion: 1 }, weight: 2, requestBytes: 1_024, responseBytes: 2_048, keyDistribution: { kind: 'hotspot', keySpaceSize: 10_000_000, hotKeyCount: 100, hotTrafficFraction: 0.4 }, valueSizeDistribution: { kind: 'fixed', bytes: 512 } },
      { operation: { apiId: 'orders-api', apiVersion: 1, operationId: 'get-order' }, interaction: { interactionId: 'get-order-flow', interactionVersion: 1 }, weight: 6, requestBytes: 128, responseBytes: 2_048, keyDistribution: { kind: 'hotspot', keySpaceSize: 10_000_000, hotKeyCount: 100, hotTrafficFraction: 0.4 }, valueSizeDistribution: { kind: 'fixed', bytes: 2_048 } },
      { operation: { apiId: 'orders-api', apiVersion: 1, operationId: 'list-customer-orders' }, interaction: { interactionId: 'list-customer-orders-flow', interactionVersion: 1 }, weight: 2, requestBytes: 256, responseBytes: 8_192, keyDistribution: { kind: 'hotspot', keySpaceSize: 1_000_000, hotKeyCount: 100, hotTrafficFraction: 0.4 }, valueSizeDistribution: { kind: 'uniform', minBytes: 2_048, maxBytes: 8_192 } },
    ] }],
    faults: [], simulation: { durationSeconds: 60, sampleIntervalMs: 1_000, maxRequests: 100_000, traceLimit: 200, maxHops: 64 }, seed: 'order-system-contracts',
  }],
  activeExperimentId: 'baseline',
})

export const createScheduledReportContractFixture = (): ProjectFileV3 => {
  const project = createOrderSystemContractFixture()
  project.id = 'scheduled-report-contracts'
  project.name = 'Scheduled report contracts'
  const scheduler = { ...createNode('scheduler', 'report-scheduler', { x: 0, y: 250 }), name: 'Report scheduler', componentVersion: 1 as const }
  scheduler.config = { ...scheduler.config, intervalMs: 5_000, scheduleMode: 'periodic', concurrencyLimit: 4, missedRunPolicy: 'catch-up', maxPendingRuns: 20, requestBytes: 256 }
  project.topology.nodes.push(scheduler)
  project.topology.edges.push(connection('scheduler-to-orders', 'report-scheduler', 'orders-service'))
  project.definitions.apis[0]!.operations.push({ id: 'build-order-report', name: 'Build order report', method: 'POST', path: '/reports/orders', responses: [{ statusCode: '202' }], handlerTimeMs: 8 })
  project.definitions.interactions.push({
    id: 'build-order-report-flow', version: 1, name: 'Build order report', entryOperation: { apiId: 'orders-api', apiVersion: 1, operationId: 'build-order-report' },
    actions: [
      { id: 'schedule-report', kind: 'api-call', dependsOn: [], sourceNodeId: 'report-scheduler', targetNodeId: 'orders-service', operation: { apiId: 'orders-api', apiVersion: 1, operationId: 'build-order-report' } },
      { id: 'scan-orders', kind: 'data-access', dependsOn: ['schedule-report'], nodeId: 'orders-db', model: { modelId: 'orders-model', modelVersion: 1 }, objectId: 'orders-table', operation: 'index-read', indexId: 'ix-customer', estimatedRows: 100 },
    ],
  })
  const experiment = project.experiments[0]!
  experiment.workloads = [{ id: 'inactive-client-load', name: 'Inactive client load', sourceNodeId: 'client-traffic', requestsPerSecond: 1, startAtSeconds: 60, durationSeconds: 1, pattern: 'constant', requestBytes: 1_024 }]
  experiment.operationWorkloads = [{
    id: 'scheduled-report', name: 'Scheduled order report', sourceNodeId: 'report-scheduler',
    phases: [{ id: 'scheduler-owned', startAtSeconds: 0, durationSeconds: 60, requestsPerSecond: 1, pattern: 'constant' }],
    operationMix: [{ operation: { apiId: 'orders-api', apiVersion: 1, operationId: 'build-order-report' }, interaction: { interactionId: 'build-order-report-flow', interactionVersion: 1 }, weight: 1, requestBytes: 256 }],
  }]
  experiment.simulation = { durationSeconds: 20, sampleIntervalMs: 1_000, maxRequests: 100, traceLimit: 100, maxHops: 64 }
  experiment.seed = 'scheduled-report-contracts'
  return projectFileV3Schema.parse(project)
}
