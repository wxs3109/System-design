import { createRegisteredNode } from '@system-design/components'
import { createEmptyProject, createOrderSystemContractFixture, projectFileV3Schema, type ProjectFile } from '@system-design/model'

const connection = (id: string, source: string, target: string) => ({
  id, source, target, sourcePort: 'out', targetPort: 'in', weight: 1,
  sourceSemantic: 'request' as const, targetSemantic: 'request' as const, routingMode: 'weighted-one' as const,
})

const asyncConnection = (id: string, source: string, target: string) => ({
  id, source, target, sourcePort: 'publish', targetPort: 'consume', weight: 1,
  sourceSemantic: 'publish' as const, targetSemantic: 'consume' as const, routingMode: 'async-publish' as const,
})

export const createDirectExample = (): ProjectFile => {
  const project = createEmptyProject('direct-service')
  project.name = 'Direct service'
  project.topology.nodes = [
    createRegisteredNode('traffic', 'traffic-direct', { x: 60, y: 180 }, 'workload-direct'),
    createRegisteredNode('network', 'network-direct', { x: 330, y: 180 }),
    createRegisteredNode('service', 'service-direct', { x: 600, y: 180 }),
    createRegisteredNode('database', 'database-direct', { x: 870, y: 180 }),
  ]
  project.topology.edges = [connection('edge-direct-1', 'traffic-direct', 'network-direct'), connection('edge-direct-2', 'network-direct', 'service-direct'), connection('edge-direct-3', 'service-direct', 'database-direct')]
  project.topology.groups = [{ id: 'region-primary', name: 'Primary region', kind: 'region', nodeIds: ['network-direct', 'service-direct', 'database-direct'] }]
  const experiment = project.experiments[0]!
  experiment.seed = 'direct-service'
  experiment.workloads = [{ id: 'workload-direct', name: 'Web requests', sourceNodeId: 'traffic-direct', requestsPerSecond: 120, startAtSeconds: 0, durationSeconds: 30, pattern: 'poisson', requestBytes: 8_192 }]
  return project
}

export const createAsyncExample = (): ProjectFile => {
  const project = createEmptyProject('async-pipeline')
  project.name = 'Async pipeline'
  project.topology.nodes = [
    createRegisteredNode('traffic', 'traffic-async', { x: 60, y: 180 }, 'workload-async'),
    createRegisteredNode('service', 'producer-async', { x: 330, y: 180 }),
    createRegisteredNode('queue', 'queue-async', { x: 600, y: 180 }),
    createRegisteredNode('service', 'worker-async', { x: 870, y: 180 }),
    createRegisteredNode('database', 'database-async', { x: 1_140, y: 180 }),
  ]
  project.topology.nodes[1]!.name = 'Producer API'
  project.topology.nodes[3]!.name = 'Workers'
  project.topology.edges = [connection('edge-async-1', 'traffic-async', 'producer-async'), connection('edge-async-2', 'producer-async', 'queue-async'), connection('edge-async-3', 'queue-async', 'worker-async'), connection('edge-async-4', 'worker-async', 'database-async')]
  const experiment = project.experiments[0]!
  experiment.seed = 'async-pipeline'
  experiment.workloads = [{ id: 'workload-async', name: 'Ingest events', sourceNodeId: 'traffic-async', requestsPerSecond: 300, startAtSeconds: 0, durationSeconds: 30, pattern: 'poisson', requestBytes: 2_048 }]
  return project
}

export const createDataPlatformExample = (): ProjectFile => {
  const project = createEmptyProject('data-platform')
  project.name = 'Data platform'
  project.topology.nodes = [
    createRegisteredNode('traffic', 'traffic-data', { x: 30, y: 150 }, 'workload-data'),
    createRegisteredNode('cache', 'cache-data', { x: 280, y: 150 }),
    createRegisteredNode('service', 'hit-data', { x: 540, y: 40 }),
    createRegisteredNode('database', 'database-data', { x: 540, y: 240 }),
    createRegisteredNode('service', 'producer-data', { x: 800, y: 150 }),
    createRegisteredNode('stream', 'stream-data', { x: 1_060, y: 150 }),
    createRegisteredNode('object-storage', 'objects-data', { x: 1_320, y: 150 }),
  ]
  project.topology.nodes[2]!.name = 'Cached response'
  const cache = project.topology.nodes[1]!
  cache.config = { ...cache.config, keySpaceSize: 10, capacityEntries: 10, ttlMs: 60_000, jitterMs: 0 }
  const database = project.topology.nodes[3]!
  database.config = { ...database.config, shardCount: 4, replicasPerShard: 2, readPreference: 'replica-preferred', writeRatio: 0.2, hotKeyProbability: 0.6, errorRate: 0, jitterMs: 0 }
  const stream = project.topology.nodes[5]!
  stream.config = { ...stream.config, partitions: 4, consumersPerGroup: 1, batchSize: 1, consumeTimeMs: 100, jitterMs: 0 }
  const objects = project.topology.nodes[6]!
  objects.config = { ...objects.config, defaultObjectSizeBytes: 8_192, errorRate: 0, jitterMs: 0 }
  project.topology.edges = [
    connection('edge-data-entry', 'traffic-data', 'cache-data'),
    { ...connection('edge-data-hit', 'cache-data', 'hit-data'), sourcePort: 'hit', sourceSemantic: 'hit' },
    { ...connection('edge-data-miss', 'cache-data', 'database-data'), sourcePort: 'miss', sourceSemantic: 'miss' },
    connection('edge-data-db', 'database-data', 'producer-data'),
    { ...connection('edge-data-stream', 'producer-data', 'stream-data'), sourcePort: 'publish', targetPort: 'consume', sourceSemantic: 'publish', targetSemantic: 'consume', routingMode: 'async-publish' },
    { ...connection('edge-data-objects', 'stream-data', 'objects-data'), sourcePort: 'publish', targetPort: 'consume', sourceSemantic: 'publish', targetSemantic: 'consume', routingMode: 'async-publish' },
  ]
  const experiment = project.experiments[0]!
  experiment.seed = 'data-platform'
  experiment.simulation.durationSeconds = 10
  experiment.workloads = [{ id: 'workload-data', name: 'Keyed requests', sourceNodeId: 'traffic-data', requestsPerSecond: 50, startAtSeconds: 0, durationSeconds: 10, pattern: 'poisson', requestBytes: 8_192 }]
  return project
}

export const createScheduledBatchExample = (): ProjectFile => {
  const project = createEmptyProject('scheduled-batch-pipeline')
  project.name = 'Scheduled batch pipeline'
  project.topology.nodes = [
    createRegisteredNode('scheduler', 'batch-scheduler', { x: 60, y: 180 }),
    createRegisteredNode('queue', 'batch-queue', { x: 330, y: 180 }),
    createRegisteredNode('service', 'batch-workers', { x: 600, y: 180 }),
    createRegisteredNode('database', 'batch-database', { x: 870, y: 180 }),
  ]
  const scheduler = project.topology.nodes[0]!
  scheduler.name = 'Nightly release'
  scheduler.config = { ...scheduler.config, scheduleMode: 'batch', intervalMs: 1_000, batchSize: 8, jitterMs: 100, missedRunPolicy: 'catch-up', concurrencyLimit: 4, maxPendingRuns: 100, requestBytes: 4_096 }
  project.topology.nodes[1]!.name = 'Batch backlog'
  project.topology.nodes[2]!.name = 'Batch workers'
  project.topology.nodes[3]!.name = 'Reporting database'
  project.topology.edges = [connection('batch-release', 'batch-scheduler', 'batch-queue'), connection('batch-dispatch', 'batch-queue', 'batch-workers'), connection('batch-write', 'batch-workers', 'batch-database')]
  const experiment = project.experiments[0]!
  experiment.seed = 'scheduled-batch-pipeline'
  experiment.simulation = { durationSeconds: 10, sampleIntervalMs: 500, maxRequests: 1_000, traceLimit: 100, maxHops: 20 }
  return project
}

export const createVideoDeliveryExample = (): ProjectFile => {
  const project = createEmptyProject('video-delivery')
  project.name = 'Video delivery'
  const viewers = createRegisteredNode('traffic', 'video-viewers', { x: 60, y: 180 }, 'video-views')
  const cdn = createRegisteredNode('cdn', 'video-cdn', { x: 360, y: 180 })
  const cachedResponse = createRegisteredNode('service', 'edge-response', { x: 680, y: 60 })
  const origin = createRegisteredNode('object-storage', 'video-origin', { x: 680, y: 300 })
  viewers.name = 'Video viewers'
  cdn.name = 'Edge CDN'
  cachedResponse.name = 'Cached response'
  origin.name = 'Video origin'
  cdn.config = { ...cdn.config, popCount: 4, popSelection: 'consistent-hash', capacityEntriesPerPop: 16, ttlMs: 60_000, keySpaceSize: 8, hotKeyProbability: 0.4, maxConcurrentRequests: 1_000, lookupTimeMs: 0.1, edgeLatencyMs: 8, edgeBandwidthMbps: 1_000, originRoundTripMs: 80, originBandwidthMbps: 200, defaultObjectSizeBytes: 1_048_576, jitterMs: 0, errorRate: 0, maxQueueSize: 10_000 }
  cachedResponse.config = { ...cachedResponse.config, serviceTimeMs: 0.1, jitterMs: 0, errorRate: 0 }
  origin.config = { ...origin.config, defaultObjectSizeBytes: 1_048_576, baseLatencyMs: 10, jitterMs: 0, readThroughputMbps: 500, errorRate: 0 }
  project.topology.nodes = [viewers, cdn, cachedResponse, origin]
  project.topology.edges = [
    connection('viewer-to-cdn', 'video-viewers', 'video-cdn'),
    { ...connection('cdn-cache-hit', 'video-cdn', 'edge-response'), sourcePort: 'hit', sourceSemantic: 'hit' },
    { ...connection('cdn-origin-fetch', 'video-cdn', 'video-origin'), sourcePort: 'miss', sourceSemantic: 'miss' },
  ]
  const experiment = project.experiments[0]!
  experiment.seed = 'video-delivery'
  experiment.simulation = { durationSeconds: 5, sampleIntervalMs: 500, maxRequests: 1_000, traceLimit: 100, maxHops: 10 }
  experiment.workloads = [{ id: 'video-views', name: 'Video requests', sourceNodeId: 'video-viewers', requestsPerSecond: 30, startAtSeconds: 0, durationSeconds: 4, pattern: 'constant', requestBytes: 256 }]
  return project
}

export const createCloudDriveDeliveryExample = (): ProjectFile => {
  const project = createEmptyProject('cloud-drive-delivery')
  project.name = 'Cloud drive delivery'
  const downloads = createRegisteredNode('traffic', 'drive-downloads', { x: 60, y: 180 }, 'file-downloads')
  const cdn = createRegisteredNode('cdn', 'download-cdn', { x: 360, y: 180 })
  const cachedResponse = createRegisteredNode('service', 'download-edge-response', { x: 680, y: 60 })
  const origin = createRegisteredNode('object-storage', 'drive-origin', { x: 680, y: 300 })
  downloads.name = 'File downloads'
  cdn.name = 'Download CDN'
  cachedResponse.name = 'Cached file response'
  origin.name = 'Drive object store'
  cdn.config = { ...cdn.config, popCount: 6, popSelection: 'round-robin', capacityEntriesPerPop: 32, ttlMs: 300_000, keySpaceSize: 24, hotKeyProbability: 0.2, maxConcurrentRequests: 1_000, lookupTimeMs: 0.2, edgeLatencyMs: 12, edgeBandwidthMbps: 500, originRoundTripMs: 100, originBandwidthMbps: 100, defaultObjectSizeBytes: 8_388_608, jitterMs: 0, errorRate: 0, maxQueueSize: 10_000 }
  cachedResponse.config = { ...cachedResponse.config, serviceTimeMs: 0.2, jitterMs: 0, errorRate: 0 }
  origin.config = { ...origin.config, defaultObjectSizeBytes: 8_388_608, baseLatencyMs: 15, jitterMs: 0, readThroughputMbps: 250, errorRate: 0 }
  project.topology.nodes = [downloads, cdn, cachedResponse, origin]
  project.topology.edges = [
    connection('downloads-to-cdn', 'drive-downloads', 'download-cdn'),
    { ...connection('download-cache-hit', 'download-cdn', 'download-edge-response'), sourcePort: 'hit', sourceSemantic: 'hit' },
    { ...connection('download-origin-fetch', 'download-cdn', 'drive-origin'), sourcePort: 'miss', sourceSemantic: 'miss' },
  ]
  const experiment = project.experiments[0]!
  experiment.seed = 'cloud-drive-delivery'
  experiment.simulation = { durationSeconds: 6, sampleIntervalMs: 500, maxRequests: 1_000, traceLimit: 100, maxHops: 10 }
  experiment.workloads = [{ id: 'file-downloads', name: 'File downloads', sourceNodeId: 'drive-downloads', requestsPerSecond: 20, startAtSeconds: 0, durationSeconds: 5, pattern: 'poisson', requestBytes: 512 }]
  return project
}

export const createProductSearchExample = (): ProjectFile => {
  const project = createEmptyProject('product-search')
  project.name = 'Product search'
  project.modelingMode = 'business-aware'
  const shoppers = createRegisteredNode('traffic', 'search-shoppers', { x: 40, y: 80 }, 'unused-search-queries')
  const catalogChanges = createRegisteredNode('traffic', 'catalog-changes', { x: 40, y: 300 }, 'unused-catalog-changes')
  const searchApi = createRegisteredNode('service', 'product-search-api', { x: 330, y: 80 })
  const catalogIndexer = createRegisteredNode('service', 'catalog-indexer', { x: 330, y: 300 })
  const search = createRegisteredNode('search-index', 'product-search-index', { x: 650, y: 190 })
  shoppers.name = 'Shoppers'
  catalogChanges.name = 'Catalog changes'
  searchApi.name = 'Product search API'
  catalogIndexer.name = 'Catalog indexer'
  search.name = 'Product search index'
  searchApi.config = { ...searchApi.config, replicas: 3, concurrencyPerReplica: 30, serviceTimeMs: 3, jitterMs: 0, errorRate: 0 }
  catalogIndexer.config = { ...catalogIndexer.config, replicas: 2, concurrencyPerReplica: 10, serviceTimeMs: 4, jitterMs: 0, errorRate: 0 }
  search.config = { ...search.config, shardCount: 4, replicasPerShard: 1, maxConcurrentRequestsPerCopy: 50, writeRatio: 0.1, keySpaceSize: 100_000, indexingDelayMs: 150, refreshIntervalMs: 500, replicaRefreshDelayMs: 100, queryBaseTimeMs: 1.5, shardQueryTimeMs: 3, fanOutTimePerShardMs: 0.2, mergeTimePerCandidateMs: 0.01, defaultResultLimit: 24, indexWriteTimeMs: 2, indexingThroughputMbps: 300, jitterMs: 0, errorRate: 0 }
  project.topology.nodes = [shoppers, catalogChanges, searchApi, catalogIndexer, search]
  project.topology.edges = [
    connection('shoppers-to-search-api', 'search-shoppers', 'product-search-api'),
    connection('search-api-to-index', 'product-search-api', 'product-search-index'),
    connection('changes-to-indexer', 'catalog-changes', 'catalog-indexer'),
    connection('indexer-to-product-index', 'catalog-indexer', 'product-search-index'),
  ]
  project.definitions = {
    schemaVersion: 1,
    jsonSchemas: [
      { id: 'schema.Product', version: 1, name: 'Product document', dialect: 'https://json-schema.org/draft/2020-12/schema', schema: { type: 'object', required: ['id', 'title', 'category'], properties: { id: { type: 'string' }, title: { type: 'string' }, category: { type: 'string' }, price: { type: 'number' } } } },
      { id: 'schema.ProductResults', version: 1, name: 'Product search results', dialect: 'https://json-schema.org/draft/2020-12/schema', schema: { type: 'object', properties: { items: { type: 'array', items: { $ref: '#/$defs/product' } } }, $defs: { product: { type: 'object' } } } },
    ],
    apis: [
      { id: 'product-search-api-contract', version: 1, name: 'Product Search API', ownerNodeId: 'product-search-api', operations: [{ id: 'search-products', name: 'Search products', method: 'GET', path: '/products/search', responses: [{ statusCode: '200', body: { schema: { schemaId: 'schema.ProductResults', schemaVersion: 1 }, estimatedBytes: 12_288 } }], handlerTimeMs: 2, slo: { latencyP95Ms: 120, availability: 0.999 } }] },
      { id: 'catalog-index-api', version: 1, name: 'Catalog Index API', ownerNodeId: 'catalog-indexer', operations: [{ id: 'upsert-product', name: 'Upsert product document', method: 'PUT', path: '/internal/search/products/{id}', request: { schema: { schemaId: 'schema.Product', schemaVersion: 1 }, estimatedBytes: 2_048 }, responses: [{ statusCode: '202' }], handlerTimeMs: 3 }] },
    ],
    dataModels: [{ id: 'product-search-model', version: 1, name: 'Product search documents', ownerNodeId: 'product-search-index', kind: 'document', collections: [{ id: 'products', name: 'products', documentSchema: { schemaId: 'schema.Product', schemaVersion: 1 }, partitionKey: '/id', secondaryIndexes: [{ id: 'ix-product-text', name: 'product_text_and_facets', fields: [{ path: '/title', direction: 'asc' }, { path: '/category', direction: 'asc' }], unique: false }], estimatedDocuments: 100_000, estimatedDocumentBytes: 2_048 }] }],
    events: [], cacheKeys: [], workflows: [],
    interactions: [
      { id: 'search-products-flow', version: 1, name: 'Search product catalog', entryOperation: { apiId: 'product-search-api-contract', apiVersion: 1, operationId: 'search-products' }, actions: [
        { id: 'call-product-search', kind: 'api-call', dependsOn: [], sourceNodeId: 'search-shoppers', targetNodeId: 'product-search-api', operation: { apiId: 'product-search-api-contract', apiVersion: 1, operationId: 'search-products' } },
        { id: 'query-product-index', kind: 'data-access', dependsOn: ['call-product-search'], nodeId: 'product-search-index', model: { modelId: 'product-search-model', modelVersion: 1 }, objectId: 'products', operation: 'index-read', indexId: 'ix-product-text', estimatedRows: 24 },
      ] },
      { id: 'upsert-product-flow', version: 1, name: 'Refresh product document', entryOperation: { apiId: 'catalog-index-api', apiVersion: 1, operationId: 'upsert-product' }, actions: [
        { id: 'call-catalog-indexer', kind: 'api-call', dependsOn: [], sourceNodeId: 'catalog-changes', targetNodeId: 'catalog-indexer', operation: { apiId: 'catalog-index-api', apiVersion: 1, operationId: 'upsert-product' } },
        { id: 'write-product-index', kind: 'data-access', dependsOn: ['call-catalog-indexer'], nodeId: 'product-search-index', model: { modelId: 'product-search-model', modelVersion: 1 }, objectId: 'products', operation: 'update', estimatedRows: 1 },
      ] },
    ],
  }
  const experiment = project.experiments[0]!
  experiment.seed = 'product-search'
  experiment.simulation = { durationSeconds: 6, sampleIntervalMs: 250, maxRequests: 2_000, traceLimit: 100, maxHops: 16 }
  experiment.workloads = [
    { id: 'unused-search-queries', name: 'Superseded search capacity load', sourceNodeId: 'search-shoppers', requestsPerSecond: 1, startAtSeconds: 0, durationSeconds: 5, pattern: 'constant', requestBytes: 256 },
    { id: 'unused-catalog-changes', name: 'Superseded catalog capacity load', sourceNodeId: 'catalog-changes', requestsPerSecond: 1, startAtSeconds: 0, durationSeconds: 5, pattern: 'constant', requestBytes: 2_048 },
  ]
  experiment.operationWorkloads = [
    { id: 'shopper-searches', name: 'Shopper searches', sourceNodeId: 'search-shoppers', phases: [{ id: 'steady-search', startAtSeconds: 0, durationSeconds: 5, requestsPerSecond: 40, pattern: 'poisson' }], operationMix: [{ operation: { apiId: 'product-search-api-contract', apiVersion: 1, operationId: 'search-products' }, interaction: { interactionId: 'search-products-flow', interactionVersion: 1 }, weight: 1, requestBytes: 256, responseBytes: 12_288, keyDistribution: { kind: 'uniform', keySpaceSize: 1 }, valueSizeDistribution: { kind: 'fixed', bytes: 2_048 } }] },
    { id: 'catalog-updates', name: 'Catalog updates', sourceNodeId: 'catalog-changes', phases: [{ id: 'steady-indexing', startAtSeconds: 0, durationSeconds: 5, requestsPerSecond: 6, pattern: 'constant' }], operationMix: [{ operation: { apiId: 'catalog-index-api', apiVersion: 1, operationId: 'upsert-product' }, interaction: { interactionId: 'upsert-product-flow', interactionVersion: 1 }, weight: 1, requestBytes: 2_048, keyDistribution: { kind: 'uniform', keySpaceSize: 1 }, valueSizeDistribution: { kind: 'fixed', bytes: 2_048 } }] },
  ]
  return projectFileV3Schema.parse(project)
}

export const createLogSearchExample = (): ProjectFile => {
  const project = createEmptyProject('log-search')
  project.name = 'Log search'
  project.modelingMode = 'business-aware'
  const investigators = createRegisteredNode('traffic', 'log-investigators', { x: 20, y: 50 }, 'unused-log-queries')
  const agents = createRegisteredNode('traffic', 'log-agents', { x: 20, y: 330 }, 'unused-log-ingest')
  const queryApi = createRegisteredNode('service', 'log-query-api', { x: 270, y: 50 })
  const collector = createRegisteredNode('service', 'log-collector', { x: 270, y: 330 })
  const stream = createRegisteredNode('stream', 'log-stream', { x: 510, y: 330 })
  const indexers = createRegisteredNode('service', 'log-indexers', { x: 750, y: 330 })
  const search = createRegisteredNode('search-index', 'log-search-index', { x: 750, y: 100 })
  investigators.name = 'Investigators'
  agents.name = 'Log agents'
  queryApi.name = 'Log query API'
  collector.name = 'Log collector'
  stream.name = 'Ingest stream'
  indexers.name = 'Log indexers'
  search.name = 'Log search index'
  queryApi.config = { ...queryApi.config, replicas: 3, concurrencyPerReplica: 25, serviceTimeMs: 4, jitterMs: 0, errorRate: 0 }
  collector.config = { ...collector.config, replicas: 4, concurrencyPerReplica: 40, serviceTimeMs: 2, jitterMs: 0, errorRate: 0 }
  stream.config = { ...stream.config, partitions: 8, producerCapacity: 1_000, consumerGroups: 1, consumersPerGroup: 8, batchSize: 50, acknowledgement: 'explicit', publishTimeMs: 0.5, consumeTimeMs: 2, jitterMs: 0, maxDepth: 100_000, errorRate: 0 }
  indexers.config = { ...indexers.config, replicas: 8, concurrencyPerReplica: 10, serviceTimeMs: 3, jitterMs: 0, errorRate: 0 }
  search.config = { ...search.config, shardCount: 8, replicasPerShard: 2, maxConcurrentRequestsPerCopy: 40, writeRatio: 0.8, keySpaceSize: 1_000_000, indexingDelayMs: 300, refreshIntervalMs: 1_000, replicaRefreshDelayMs: 250, queryBaseTimeMs: 2, shardQueryTimeMs: 6, fanOutTimePerShardMs: 0.4, mergeTimePerCandidateMs: 0.02, defaultResultLimit: 100, indexWriteTimeMs: 4, indexingThroughputMbps: 200, jitterMs: 0, errorRate: 0 }
  project.topology.nodes = [investigators, agents, queryApi, collector, stream, indexers, search]
  project.topology.edges = [
    connection('investigators-to-query-api', 'log-investigators', 'log-query-api'),
    connection('query-api-to-log-index', 'log-query-api', 'log-search-index'),
    connection('agents-to-collector', 'log-agents', 'log-collector'),
    asyncConnection('collector-to-log-stream', 'log-collector', 'log-stream'),
    asyncConnection('stream-to-log-indexers', 'log-stream', 'log-indexers'),
    connection('indexers-to-log-index', 'log-indexers', 'log-search-index'),
  ]
  project.definitions = {
    schemaVersion: 1,
    jsonSchemas: [
      { id: 'schema.LogEntry', version: 1, name: 'Log entry', dialect: 'https://json-schema.org/draft/2020-12/schema', schema: { type: 'object', required: ['id', 'timestamp', 'message'], properties: { id: { type: 'string' }, timestamp: { type: 'string', format: 'date-time' }, service: { type: 'string' }, level: { type: 'string' }, message: { type: 'string' } } } },
      { id: 'schema.LogQuery', version: 1, name: 'Log search query', dialect: 'https://json-schema.org/draft/2020-12/schema', schema: { type: 'object', required: ['query'], properties: { query: { type: 'string' }, from: { type: 'string', format: 'date-time' }, to: { type: 'string', format: 'date-time' } } } },
      { id: 'schema.LogResults', version: 1, name: 'Log search results', dialect: 'https://json-schema.org/draft/2020-12/schema', schema: { type: 'object', properties: { matches: { type: 'array', items: { type: 'object' } } } } },
    ],
    apis: [
      { id: 'log-query-api-contract', version: 1, name: 'Log Query API', ownerNodeId: 'log-query-api', operations: [{ id: 'search-logs', name: 'Search logs', method: 'POST', path: '/logs/search', request: { schema: { schemaId: 'schema.LogQuery', schemaVersion: 1 }, estimatedBytes: 512 }, responses: [{ statusCode: '200', body: { schema: { schemaId: 'schema.LogResults', schemaVersion: 1 }, estimatedBytes: 65_536 } }], handlerTimeMs: 3, slo: { latencyP95Ms: 500, availability: 0.999 } }] },
      { id: 'log-ingest-api', version: 1, name: 'Log Ingest API', ownerNodeId: 'log-collector', operations: [{ id: 'ingest-log', name: 'Ingest log entry', method: 'POST', path: '/logs', request: { schema: { schemaId: 'schema.LogEntry', schemaVersion: 1 }, estimatedBytes: 1_024 }, responses: [{ statusCode: '202' }], handlerTimeMs: 1 }] },
    ],
    dataModels: [{ id: 'log-search-model', version: 1, name: 'Time-partitioned log documents', ownerNodeId: 'log-search-index', kind: 'document', collections: [{ id: 'logs', name: 'logs', documentSchema: { schemaId: 'schema.LogEntry', schemaVersion: 1 }, partitionKey: '/service', secondaryIndexes: [{ id: 'ix-log-time-message', name: 'log_time_message', fields: [{ path: '/timestamp', direction: 'desc' }, { path: '/message', direction: 'asc' }], unique: false }], estimatedDocuments: 1_000_000, estimatedDocumentBytes: 1_024 }] }],
    events: [{ id: 'log-received', version: 1, name: 'LogReceived', payloadSchema: { schemaId: 'schema.LogEntry', schemaVersion: 1 }, estimatedPayloadBytes: 1_024, partitionKey: '/service', ordering: 'partition-key', delivery: 'at-least-once', producerNodeId: 'log-collector', consumerNodeIds: ['log-indexers'] }],
    cacheKeys: [], workflows: [],
    interactions: [
      { id: 'search-logs-flow', version: 1, name: 'Search recent logs', entryOperation: { apiId: 'log-query-api-contract', apiVersion: 1, operationId: 'search-logs' }, actions: [
        { id: 'call-log-query', kind: 'api-call', dependsOn: [], sourceNodeId: 'log-investigators', targetNodeId: 'log-query-api', operation: { apiId: 'log-query-api-contract', apiVersion: 1, operationId: 'search-logs' } },
        { id: 'query-log-index', kind: 'data-access', dependsOn: ['call-log-query'], nodeId: 'log-search-index', model: { modelId: 'log-search-model', modelVersion: 1 }, objectId: 'logs', operation: 'index-read', indexId: 'ix-log-time-message', estimatedRows: 100 },
      ] },
      { id: 'ingest-log-flow', version: 1, name: 'Stream and index a log entry', entryOperation: { apiId: 'log-ingest-api', apiVersion: 1, operationId: 'ingest-log' }, actions: [
        { id: 'call-log-collector', kind: 'api-call', dependsOn: [], sourceNodeId: 'log-agents', targetNodeId: 'log-collector', operation: { apiId: 'log-ingest-api', apiVersion: 1, operationId: 'ingest-log' } },
        { id: 'publish-log', kind: 'event-publish', dependsOn: ['call-log-collector'], producerNodeId: 'log-collector', brokerNodeId: 'log-stream', event: { eventId: 'log-received', eventVersion: 1 } },
        { id: 'consume-log', kind: 'event-consume', dependsOn: ['publish-log'], consumerNodeId: 'log-indexers', brokerNodeId: 'log-stream', event: { eventId: 'log-received', eventVersion: 1 } },
        { id: 'index-log', kind: 'data-access', dependsOn: ['consume-log'], nodeId: 'log-search-index', model: { modelId: 'log-search-model', modelVersion: 1 }, objectId: 'logs', operation: 'insert', estimatedRows: 1 },
      ] },
    ],
  }
  const experiment = project.experiments[0]!
  experiment.seed = 'log-search'
  experiment.simulation = { durationSeconds: 6, sampleIntervalMs: 250, maxRequests: 3_000, traceLimit: 100, maxHops: 24 }
  experiment.workloads = [
    { id: 'unused-log-queries', name: 'Superseded query capacity load', sourceNodeId: 'log-investigators', requestsPerSecond: 1, startAtSeconds: 0, durationSeconds: 5, pattern: 'constant', requestBytes: 512 },
    { id: 'unused-log-ingest', name: 'Superseded ingest capacity load', sourceNodeId: 'log-agents', requestsPerSecond: 1, startAtSeconds: 0, durationSeconds: 5, pattern: 'constant', requestBytes: 1_024 },
  ]
  experiment.operationWorkloads = [
    { id: 'log-queries', name: 'Investigation queries', sourceNodeId: 'log-investigators', phases: [{ id: 'query-window', startAtSeconds: 0, durationSeconds: 5, requestsPerSecond: 12, pattern: 'poisson' }], operationMix: [{ operation: { apiId: 'log-query-api-contract', apiVersion: 1, operationId: 'search-logs' }, interaction: { interactionId: 'search-logs-flow', interactionVersion: 1 }, weight: 1, requestBytes: 512, responseBytes: 65_536, keyDistribution: { kind: 'uniform', keySpaceSize: 1 }, valueSizeDistribution: { kind: 'fixed', bytes: 1_024 } }] },
    { id: 'log-ingest', name: 'Continuous log ingest', sourceNodeId: 'log-agents', phases: [{ id: 'ingest-window', startAtSeconds: 0, durationSeconds: 5, requestsPerSecond: 60, pattern: 'constant' }], operationMix: [{ operation: { apiId: 'log-ingest-api', apiVersion: 1, operationId: 'ingest-log' }, interaction: { interactionId: 'ingest-log-flow', interactionVersion: 1 }, weight: 1, requestBytes: 1_024, keyDistribution: { kind: 'uniform', keySpaceSize: 1 }, valueSizeDistribution: { kind: 'fixed', bytes: 1_024 } }] },
  ]
  return projectFileV3Schema.parse(project)
}

export const createOrderEventFanOutExample = (): ProjectFile => {
  const project = createEmptyProject('order-event-fan-out')
  project.name = 'Order event fan-out'
  project.modelingMode = 'business-aware'
  const checkout = createRegisteredNode('traffic', 'order-checkouts', { x: 30, y: 180 }, 'order-checkout-load')
  const orders = createRegisteredNode('service', 'order-api', { x: 290, y: 180 })
  const topic = createRegisteredNode('topic', 'order-events-topic', { x: 560, y: 180 })
  const fulfillment = createRegisteredNode('service', 'fulfillment-subscription', { x: 860, y: 70 })
  const email = createRegisteredNode('service', 'email-subscription', { x: 860, y: 290 })
  checkout.name = 'Customer checkouts'
  orders.name = 'Orders API'
  topic.name = 'Order events topic'
  fulfillment.name = 'Fulfillment subscription'
  email.name = 'Email subscription'
  orders.config = { ...orders.config, replicas: 2, concurrencyPerReplica: 20, serviceTimeMs: 4, jitterMs: 0, errorRate: 0 }
  topic.config = { ...topic.config, subscriptionCount: 2, maxRetainedMessages: 10_000, retentionMs: 60_000, batchSize: 20, acknowledgement: 'explicit', publishCapacity: 200, publishTimeMs: 1, deliveryTimeMs: 4, jitterMs: 0, maxQueueSize: 10_000, errorRate: 0 }
  fulfillment.config = { ...fulfillment.config, replicas: 2, concurrencyPerReplica: 10, serviceTimeMs: 8, jitterMs: 0, errorRate: 0 }
  email.config = { ...email.config, replicas: 2, concurrencyPerReplica: 10, serviceTimeMs: 12, jitterMs: 0, errorRate: 0 }
  project.topology.nodes = [checkout, orders, topic, fulfillment, email]
  project.topology.edges = [
    connection('checkouts-to-orders', 'order-checkouts', 'order-api'),
    asyncConnection('orders-to-order-topic', 'order-api', 'order-events-topic'),
    asyncConnection('order-topic-to-fulfillment', 'order-events-topic', 'fulfillment-subscription'),
    asyncConnection('order-topic-to-email', 'order-events-topic', 'email-subscription'),
  ]
  project.definitions = {
    schemaVersion: 1,
    jsonSchemas: [{ id: 'schema.OrderEvent', version: 1, name: 'Order event', dialect: 'https://json-schema.org/draft/2020-12/schema', schema: { type: 'object', required: ['orderId'], properties: { orderId: { type: 'string' }, status: { type: 'string' } } } }],
    apis: [{ id: 'order-events-api', version: 1, name: 'Order events API', ownerNodeId: 'order-api', operations: [{ id: 'accept-order', name: 'Accept order', method: 'POST', path: '/orders', request: { schema: { schemaId: 'schema.OrderEvent', schemaVersion: 1 }, estimatedBytes: 768 }, responses: [{ statusCode: '202' }], handlerTimeMs: 4 }] }],
    dataModels: [], cacheKeys: [], workflows: [],
    events: [{ id: 'order-accepted', version: 1, name: 'OrderAccepted', payloadSchema: { schemaId: 'schema.OrderEvent', schemaVersion: 1 }, estimatedPayloadBytes: 768, partitionKey: '/orderId', ordering: 'partition-key', delivery: 'at-least-once', producerNodeId: 'order-api', consumerNodeIds: ['fulfillment-subscription', 'email-subscription'] }],
    interactions: [{
      id: 'order-event-flow', version: 1, name: 'Order event fan-out', entryOperation: { apiId: 'order-events-api', apiVersion: 1, operationId: 'accept-order' },
      actions: [
        { id: 'accept-order', kind: 'api-call', dependsOn: [], sourceNodeId: 'order-checkouts', targetNodeId: 'order-api', operation: { apiId: 'order-events-api', apiVersion: 1, operationId: 'accept-order' } },
        { id: 'publish-order', kind: 'event-publish', dependsOn: ['accept-order'], producerNodeId: 'order-api', brokerNodeId: 'order-events-topic', event: { eventId: 'order-accepted', eventVersion: 1 } },
        { id: 'consume-fulfillment', kind: 'event-consume', dependsOn: ['publish-order'], consumerNodeId: 'fulfillment-subscription', brokerNodeId: 'order-events-topic', event: { eventId: 'order-accepted', eventVersion: 1 } },
        { id: 'consume-email', kind: 'event-consume', dependsOn: ['publish-order'], consumerNodeId: 'email-subscription', brokerNodeId: 'order-events-topic', event: { eventId: 'order-accepted', eventVersion: 1 } },
      ],
    }],
  }
  const experiment = project.experiments[0]!
  experiment.seed = 'order-event-fan-out'
  experiment.simulation = { durationSeconds: 4, sampleIntervalMs: 250, maxRequests: 1_000, traceLimit: 100, maxHops: 16 }
  experiment.workloads = [{ id: 'order-checkout-load', name: 'Compatibility load', sourceNodeId: 'order-checkouts', requestsPerSecond: 1, startAtSeconds: 0, durationSeconds: 1, pattern: 'constant', requestBytes: 768 }]
  experiment.operationWorkloads = [{ id: 'order-event-operations', name: 'Completed checkouts', sourceNodeId: 'order-checkouts', phases: [{ id: 'steady', startAtSeconds: 0, durationSeconds: 3, requestsPerSecond: 20, pattern: 'constant' }], operationMix: [{ operation: { apiId: 'order-events-api', apiVersion: 1, operationId: 'accept-order' }, interaction: { interactionId: 'order-event-flow', interactionVersion: 1 }, weight: 1, requestBytes: 768, responseBytes: 128, keyDistribution: { kind: 'uniform', keySpaceSize: 1_000_000 }, valueSizeDistribution: { kind: 'fixed', bytes: 768 } }] }]
  return projectFileV3Schema.parse(project)
}

export const createIncidentFanOutExample = (): ProjectFile => {
  const project = createEmptyProject('incident-fan-out')
  project.name = 'Incident fan-out'
  project.modelingMode = 'business-aware'
  const monitors = createRegisteredNode('traffic', 'incident-monitors', { x: 20, y: 190 }, 'incident-alert-load')
  const alertManager = createRegisteredNode('service', 'alert-manager', { x: 260, y: 190 })
  const topic = createRegisteredNode('topic', 'incident-topic', { x: 510, y: 190 })
  const pager = createRegisteredNode('service', 'pager-subscription', { x: 800, y: 30 })
  const chat = createRegisteredNode('service', 'chat-subscription', { x: 800, y: 190 })
  const audit = createRegisteredNode('service', 'audit-subscription', { x: 800, y: 350 })
  monitors.name = 'Monitoring signals'
  alertManager.name = 'Alert manager'
  topic.name = 'Incident topic'
  pager.name = 'Pager subscription'
  chat.name = 'Chat subscription'
  audit.name = 'Audit subscription'
  alertManager.config = { ...alertManager.config, replicas: 2, concurrencyPerReplica: 20, serviceTimeMs: 2, jitterMs: 0, errorRate: 0 }
  topic.config = { ...topic.config, subscriptionCount: 3, maxRetainedMessages: 1_000, retentionMs: 250, batchSize: 10, acknowledgement: 'explicit', publishCapacity: 100, publishTimeMs: 1, deliveryTimeMs: 5, jitterMs: 0, maxQueueSize: 1_000, errorRate: 0 }
  pager.config = { ...pager.config, replicas: 1, concurrencyPerReplica: 4, serviceTimeMs: 5, jitterMs: 0, errorRate: 0 }
  chat.config = { ...chat.config, replicas: 1, concurrencyPerReplica: 4, serviceTimeMs: 7, jitterMs: 0, errorRate: 0 }
  audit.config = { ...audit.config, replicas: 1, concurrencyPerReplica: 1, serviceTimeMs: 10, jitterMs: 0, errorRate: 0 }
  project.topology.nodes = [monitors, alertManager, topic, pager, chat, audit]
  project.topology.edges = [
    connection('monitors-to-alert-manager', 'incident-monitors', 'alert-manager'),
    asyncConnection('alert-manager-to-topic', 'alert-manager', 'incident-topic'),
    asyncConnection('topic-to-pager', 'incident-topic', 'pager-subscription'),
    asyncConnection('topic-to-chat', 'incident-topic', 'chat-subscription'),
    asyncConnection('topic-to-audit', 'incident-topic', 'audit-subscription'),
  ]
  project.definitions = {
    schemaVersion: 1,
    jsonSchemas: [{ id: 'schema.Incident', version: 1, name: 'Incident', dialect: 'https://json-schema.org/draft/2020-12/schema', schema: { type: 'object', required: ['incidentId'], properties: { incidentId: { type: 'string' }, severity: { type: 'string' } } } }],
    apis: [{ id: 'incident-api', version: 1, name: 'Incident API', ownerNodeId: 'alert-manager', operations: [{ id: 'trigger-incident', name: 'Trigger incident', method: 'POST', path: '/incidents', request: { schema: { schemaId: 'schema.Incident', schemaVersion: 1 }, estimatedBytes: 512 }, responses: [{ statusCode: '202' }], handlerTimeMs: 2 }] }],
    dataModels: [], cacheKeys: [], workflows: [],
    events: [{ id: 'incident-triggered', version: 1, name: 'IncidentTriggered', payloadSchema: { schemaId: 'schema.Incident', schemaVersion: 1 }, estimatedPayloadBytes: 512, partitionKey: '/incidentId', ordering: 'partition-key', delivery: 'at-least-once', producerNodeId: 'alert-manager', consumerNodeIds: ['pager-subscription', 'chat-subscription', 'audit-subscription'] }],
    interactions: [{
      id: 'incident-fan-out-flow', version: 1, name: 'Incident fan-out', entryOperation: { apiId: 'incident-api', apiVersion: 1, operationId: 'trigger-incident' },
      actions: [
        { id: 'accept-incident', kind: 'api-call', dependsOn: [], sourceNodeId: 'incident-monitors', targetNodeId: 'alert-manager', operation: { apiId: 'incident-api', apiVersion: 1, operationId: 'trigger-incident' } },
        { id: 'publish-incident', kind: 'event-publish', dependsOn: ['accept-incident'], producerNodeId: 'alert-manager', brokerNodeId: 'incident-topic', event: { eventId: 'incident-triggered', eventVersion: 1 } },
        { id: 'consume-pager', kind: 'event-consume', dependsOn: ['publish-incident'], consumerNodeId: 'pager-subscription', brokerNodeId: 'incident-topic', event: { eventId: 'incident-triggered', eventVersion: 1 } },
        { id: 'consume-chat', kind: 'event-consume', dependsOn: ['publish-incident'], consumerNodeId: 'chat-subscription', brokerNodeId: 'incident-topic', event: { eventId: 'incident-triggered', eventVersion: 1 } },
        { id: 'consume-audit', kind: 'event-consume', dependsOn: ['publish-incident'], consumerNodeId: 'audit-subscription', brokerNodeId: 'incident-topic', event: { eventId: 'incident-triggered', eventVersion: 1 } },
      ],
    }],
  }
  const experiment = project.experiments[0]!
  experiment.seed = 'incident-fan-out'
  experiment.simulation = { durationSeconds: 3, sampleIntervalMs: 100, maxRequests: 500, traceLimit: 100, maxHops: 16 }
  experiment.workloads = [{ id: 'incident-alert-load', name: 'Compatibility load', sourceNodeId: 'incident-monitors', requestsPerSecond: 1, startAtSeconds: 0, durationSeconds: 1, pattern: 'constant', requestBytes: 512 }]
  experiment.operationWorkloads = [{ id: 'incident-operations', name: 'Triggered incidents', sourceNodeId: 'incident-monitors', phases: [{ id: 'steady', startAtSeconds: 0, durationSeconds: 2, requestsPerSecond: 10, pattern: 'constant' }], operationMix: [{ operation: { apiId: 'incident-api', apiVersion: 1, operationId: 'trigger-incident' }, interaction: { interactionId: 'incident-fan-out-flow', interactionVersion: 1 }, weight: 1, requestBytes: 512, responseBytes: 128, keyDistribution: { kind: 'hotspot', keySpaceSize: 100_000, hotKeyCount: 10, hotTrafficFraction: 0.4 }, valueSizeDistribution: { kind: 'fixed', bytes: 512 } }] }]
  experiment.faults = [{ id: 'audit-outage', type: 'node-down', target: { kind: 'node', id: 'audit-subscription' }, startAtSeconds: 0, durationSeconds: 3, enabled: true }]
  return projectFileV3Schema.parse(project)
}

export const createRealtimeChatExample = (): ProjectFile => {
  const project = createEmptyProject('realtime-chat')
  project.name = 'Realtime chat'
  project.modelingMode = 'business-aware'
  const clients = createRegisteredNode('traffic', 'chat-clients', { x: 30, y: 180 }, 'chat-compatibility-load')
  const api = createRegisteredNode('service', 'chat-api', { x: 330, y: 180 })
  const gateway = createRegisteredNode('realtime-gateway', 'chat-realtime-gateway', { x: 650, y: 180 })
  clients.name = 'Chat clients'
  api.name = 'Chat API'
  gateway.name = 'Chat realtime gateway'
  api.config = { ...api.config, replicas: 3, concurrencyPerReplica: 30, serviceTimeMs: 2, jitterMs: 0, errorRate: 0 }
  gateway.config = {
    ...gateway.config, maxConnections: 25_000, connectionDurationMs: 30_000, maxChannelsPerConnection: 8, defaultChannelCount: 200,
    maxConcurrentMessages: 500, handshakeTimeMs: 1, broadcastBaseTimeMs: 0.5, fanOutTimePerConnectionMs: 0.005,
    defaultMessageBytes: 512, outboundBandwidthMbps: 2, slowConnectionFraction: 0.1, slowConnectionBandwidthMbps: 0.02,
    maxPendingBytesPerConnection: 4_096, overflowPolicy: 'drop-message', jitterMs: 0, errorRate: 0, maxQueueSize: 10_000,
  }
  project.topology.nodes = [clients, api, gateway]
  project.topology.edges = [
    connection('chat-clients-to-api', 'chat-clients', 'chat-api'),
    connection('chat-api-to-realtime', 'chat-api', 'chat-realtime-gateway'),
  ]
  project.definitions = {
    schemaVersion: 1,
    jsonSchemas: [{
      id: 'schema.ChatMessage', version: 1, name: 'Chat message', dialect: 'https://json-schema.org/draft/2020-12/schema',
      schema: { type: 'object', required: ['roomId', 'senderId', 'body'], properties: { roomId: { type: 'string' }, senderId: { type: 'string' }, body: { type: 'string' } } },
    }],
    apis: [{
      id: 'chat-api-contract', version: 1, name: 'Chat API', ownerNodeId: 'chat-api', operations: [{
        id: 'send-chat-message', name: 'Send chat message', method: 'POST', path: '/rooms/{roomId}/messages',
        request: { schema: { schemaId: 'schema.ChatMessage', schemaVersion: 1 }, estimatedBytes: 512 }, responses: [{ statusCode: '202' }],
        handlerTimeMs: 2, slo: { latencyP95Ms: 100, availability: 0.999 },
      }],
    }],
    dataModels: [], events: [], cacheKeys: [], workflows: [],
    interactions: [{
      id: 'chat-message-flow', version: 1, name: 'Connect and broadcast a chat message',
      entryOperation: { apiId: 'chat-api-contract', apiVersion: 1, operationId: 'send-chat-message' },
      actions: [
        { id: 'accept-chat-message', kind: 'api-call', dependsOn: [], sourceNodeId: 'chat-clients', targetNodeId: 'chat-api', operation: { apiId: 'chat-api-contract', apiVersion: 1, operationId: 'send-chat-message' } },
        { id: 'connect-chat-client', kind: 'realtime', dependsOn: ['accept-chat-message'], nodeId: 'chat-realtime-gateway', operation: 'connect', connectionPattern: 'chat-client:{request}', channelPattern: 'room:shared' },
        { id: 'broadcast-chat-message', kind: 'realtime', dependsOn: ['connect-chat-client'], nodeId: 'chat-realtime-gateway', operation: 'broadcast', connectionPattern: 'chat-client:{request}', channelPattern: 'room:shared', messageBytes: 512 },
      ],
    }],
  }
  const experiment = project.experiments[0]!
  experiment.seed = 'realtime-chat'
  experiment.simulation = { durationSeconds: 4, sampleIntervalMs: 100, maxRequests: 1_000, traceLimit: 100, maxHops: 12 }
  experiment.workloads = [{ id: 'chat-compatibility-load', name: 'Compatibility load', sourceNodeId: 'chat-clients', requestsPerSecond: 1, startAtSeconds: 0, durationSeconds: 1, pattern: 'constant', requestBytes: 512 }]
  experiment.operationWorkloads = [{
    id: 'chat-message-operations', name: 'Room messages', sourceNodeId: 'chat-clients',
    phases: [{ id: 'chat-steady', startAtSeconds: 0, durationSeconds: 3, requestsPerSecond: 30, pattern: 'constant' }],
    operationMix: [{
      operation: { apiId: 'chat-api-contract', apiVersion: 1, operationId: 'send-chat-message' }, interaction: { interactionId: 'chat-message-flow', interactionVersion: 1 },
      weight: 1, requestBytes: 512, responseBytes: 64, keyDistribution: { kind: 'hotspot', keySpaceSize: 200, hotKeyCount: 2, hotTrafficFraction: 0.8 },
      valueSizeDistribution: { kind: 'fixed', bytes: 512 },
    }],
  }]
  return projectFileV3Schema.parse(project)
}

export const createCollaborativeEditingExample = (): ProjectFile => {
  const project = createEmptyProject('collaborative-editing')
  project.name = 'Collaborative editing'
  project.modelingMode = 'business-aware'
  const editors = createRegisteredNode('traffic', 'document-editors', { x: 30, y: 180 }, 'editing-compatibility-load')
  const api = createRegisteredNode('service', 'collaboration-api', { x: 330, y: 180 })
  const gateway = createRegisteredNode('realtime-gateway', 'editing-realtime-gateway', { x: 650, y: 180 })
  editors.name = 'Document editors'
  api.name = 'Collaboration API'
  gateway.name = 'Editing realtime gateway'
  api.config = { ...api.config, replicas: 4, concurrencyPerReplica: 40, serviceTimeMs: 1, jitterMs: 0, errorRate: 0 }
  gateway.config = {
    ...gateway.config, maxConnections: 5_000, connectionDurationMs: 60_000, maxChannelsPerConnection: 3, defaultChannelCount: 1_000,
    maxConcurrentMessages: 1_000, handshakeTimeMs: 0.8, broadcastBaseTimeMs: 0.2, fanOutTimePerConnectionMs: 0.002,
    defaultMessageBytes: 256, outboundBandwidthMbps: 5, slowConnectionFraction: 0.25, slowConnectionBandwidthMbps: 0.005,
    maxPendingBytesPerConnection: 512, overflowPolicy: 'disconnect', jitterMs: 0, errorRate: 0, maxQueueSize: 20_000,
  }
  project.topology.nodes = [editors, api, gateway]
  project.topology.edges = [
    connection('editors-to-collaboration-api', 'document-editors', 'collaboration-api'),
    connection('collaboration-api-to-realtime', 'collaboration-api', 'editing-realtime-gateway'),
  ]
  project.definitions = {
    schemaVersion: 1,
    jsonSchemas: [{
      id: 'schema.DocumentOperation', version: 1, name: 'Document operation', dialect: 'https://json-schema.org/draft/2020-12/schema',
      schema: { type: 'object', required: ['documentId', 'editorId', 'operation'], properties: { documentId: { type: 'string' }, editorId: { type: 'string' }, operation: { type: 'object' }, revision: { type: 'integer' } } },
    }],
    apis: [{
      id: 'collaboration-api-contract', version: 1, name: 'Collaboration API', ownerNodeId: 'collaboration-api', operations: [{
        id: 'apply-document-operation', name: 'Apply document operation', method: 'POST', path: '/documents/{documentId}/operations',
        request: { schema: { schemaId: 'schema.DocumentOperation', schemaVersion: 1 }, estimatedBytes: 256 }, responses: [{ statusCode: '202' }],
        handlerTimeMs: 1, slo: { latencyP95Ms: 50, availability: 0.9999 },
      }],
    }],
    dataModels: [], events: [], cacheKeys: [], workflows: [],
    interactions: [{
      id: 'document-operation-flow', version: 1, name: 'Connect and broadcast a document operation',
      entryOperation: { apiId: 'collaboration-api-contract', apiVersion: 1, operationId: 'apply-document-operation' },
      actions: [
        { id: 'accept-document-operation', kind: 'api-call', dependsOn: [], sourceNodeId: 'document-editors', targetNodeId: 'collaboration-api', operation: { apiId: 'collaboration-api-contract', apiVersion: 1, operationId: 'apply-document-operation' } },
        { id: 'connect-document-editor', kind: 'realtime', dependsOn: ['accept-document-operation'], nodeId: 'editing-realtime-gateway', operation: 'connect', connectionPattern: 'editor:{request}', channelPattern: 'document:shared' },
        { id: 'broadcast-document-operation', kind: 'realtime', dependsOn: ['connect-document-editor'], nodeId: 'editing-realtime-gateway', operation: 'broadcast', connectionPattern: 'editor:{request}', channelPattern: 'document:shared', messageBytes: 256 },
      ],
    }],
  }
  const experiment = project.experiments[0]!
  experiment.seed = 'collaborative-editing'
  experiment.simulation = { durationSeconds: 4, sampleIntervalMs: 100, maxRequests: 1_500, traceLimit: 100, maxHops: 12 }
  experiment.workloads = [{ id: 'editing-compatibility-load', name: 'Compatibility load', sourceNodeId: 'document-editors', requestsPerSecond: 1, startAtSeconds: 0, durationSeconds: 1, pattern: 'constant', requestBytes: 256 }]
  experiment.operationWorkloads = [{
    id: 'document-operation-workload', name: 'Collaborative document edits', sourceNodeId: 'document-editors',
    phases: [{ id: 'editing-steady', startAtSeconds: 0, durationSeconds: 3, requestsPerSecond: 50, pattern: 'constant' }],
    operationMix: [{
      operation: { apiId: 'collaboration-api-contract', apiVersion: 1, operationId: 'apply-document-operation' }, interaction: { interactionId: 'document-operation-flow', interactionVersion: 1 },
      weight: 1, requestBytes: 256, responseBytes: 64, keyDistribution: { kind: 'hotspot', keySpaceSize: 1_000, hotKeyCount: 20, hotTrafficFraction: 0.7 },
      valueSizeDistribution: { kind: 'fixed', bytes: 256 },
    }],
  }]
  return projectFileV3Schema.parse(project)
}

const workflowRetry = (maxAttempts: number, baseDelayMs: number, backoff: 'fixed' | 'exponential' = 'exponential') => ({
  maxAttempts, backoff, baseDelayMs, maxDelayMs: backoff === 'exponential' ? baseDelayMs * 4 : baseDelayMs, jitterRatio: 0,
})

export const createPaymentCheckoutWorkflowExample = (): ProjectFile => {
  const project = createEmptyProject('payment-checkout-workflow')
  project.name = 'Payment checkout workflow'
  project.modelingMode = 'business-aware'
  const clients = createRegisteredNode('traffic', 'checkout-clients', { x: 20, y: 180 }, 'checkout-compatibility-load')
  const api = createRegisteredNode('service', 'checkout-api', { x: 270, y: 180 })
  const workflow = createRegisteredNode('workflow', 'checkout-coordinator', { x: 520, y: 180 })
  const inventory = createRegisteredNode('service', 'inventory-service', { x: 800, y: 40 })
  const payment = createRegisteredNode('service', 'payment-service', { x: 800, y: 180 })
  const confirmation = createRegisteredNode('service', 'confirmation-service', { x: 800, y: 320 })
  clients.name = 'Checkout clients'
  api.name = 'Checkout API'
  workflow.name = 'Checkout coordinator'
  inventory.name = 'Inventory service'
  payment.name = 'Payment service'
  confirmation.name = 'Confirmation service'
  for (const node of [api, inventory, payment, confirmation]) if (node.type === 'service') node.config = {
    ...node.config, replicas: 2, concurrencyPerReplica: 20, serviceTimeMs: 3, jitterMs: 0, errorRate: 0, maxQueueSize: 1_000,
  }
  if (workflow.type !== 'workflow') throw new Error('Expected a Workflow node.')
  workflow.config = { ...workflow.config, maxConcurrentInstances: 500, persistenceTimeMs: 1, defaultStepTimeMs: 5, jitterMs: 0, errorRate: 0, maxQueueSize: 2_000 }
  project.topology.nodes = [clients, api, workflow, inventory, payment, confirmation]
  project.topology.edges = [
    connection('checkout-clients-api', 'checkout-clients', 'checkout-api'),
    connection('checkout-api-workflow', 'checkout-api', 'checkout-coordinator'),
    connection('checkout-workflow-inventory', 'checkout-coordinator', 'inventory-service'),
    connection('checkout-workflow-payment', 'checkout-coordinator', 'payment-service'),
    connection('checkout-workflow-confirmation', 'checkout-coordinator', 'confirmation-service'),
  ]
  project.definitions = {
    schemaVersion: 1, jsonSchemas: [], dataModels: [], events: [], cacheKeys: [],
    apis: [{ id: 'checkout-contract', version: 1, name: 'Checkout API', ownerNodeId: 'checkout-api', operations: [{ id: 'submit-checkout', name: 'Submit checkout', method: 'POST', path: '/checkouts', responses: [{ statusCode: '202' }], handlerTimeMs: 2 }] }],
    workflows: [{ id: 'checkout', version: 1, name: 'Checkout', ownerNodeId: 'checkout-coordinator', steps: [
      { id: 'reserve-inventory', name: 'Reserve inventory', targetNodeId: 'inventory-service', timeoutMs: 100, retry: workflowRetry(2, 5), compensation: { targetNodeId: 'inventory-service', timeoutMs: 100, retry: workflowRetry(2, 5, 'fixed') } },
      { id: 'capture-payment', name: 'Capture payment', targetNodeId: 'payment-service', timeoutMs: 100, retry: workflowRetry(3, 5), compensation: { targetNodeId: 'payment-service', timeoutMs: 100, retry: workflowRetry(2, 5, 'fixed') } },
      { id: 'send-confirmation', name: 'Send confirmation', targetNodeId: 'confirmation-service', timeoutMs: 100, retry: workflowRetry(2, 5) },
    ] }],
    interactions: [{ id: 'checkout-flow', version: 1, name: 'Durable checkout', entryOperation: { apiId: 'checkout-contract', apiVersion: 1, operationId: 'submit-checkout' }, actions: [
      { id: 'accept-checkout', kind: 'api-call', dependsOn: [], sourceNodeId: 'checkout-clients', targetNodeId: 'checkout-api', operation: { apiId: 'checkout-contract', apiVersion: 1, operationId: 'submit-checkout' } },
      { id: 'coordinate-checkout', kind: 'workflow', dependsOn: ['accept-checkout'], nodeId: 'checkout-coordinator', workflow: { workflowId: 'checkout', workflowVersion: 1 }, idempotencyKeyPattern: 'checkout:{key}' },
    ] }],
  }
  const experiment = project.experiments[0]!
  experiment.seed = 'payment-checkout-workflow'
  experiment.simulation = { durationSeconds: 4, sampleIntervalMs: 100, maxRequests: 500, traceLimit: 100, maxHops: 20 }
  experiment.workloads = [{ id: 'checkout-compatibility-load', name: 'Compatibility load', sourceNodeId: 'checkout-clients', requestsPerSecond: 1, startAtSeconds: 3, durationSeconds: 1, pattern: 'constant', requestBytes: 256 }]
  experiment.operationWorkloads = [{ id: 'checkout-operations', name: 'Checkout submissions', sourceNodeId: 'checkout-clients', phases: [{ id: 'steady', startAtSeconds: 0, durationSeconds: 2, requestsPerSecond: 8, pattern: 'constant' }], operationMix: [{ operation: { apiId: 'checkout-contract', apiVersion: 1, operationId: 'submit-checkout' }, interaction: { interactionId: 'checkout-flow', interactionVersion: 1 }, weight: 1, requestBytes: 1_024, responseBytes: 128, keyDistribution: { kind: 'uniform', keySpaceSize: 100_000 } }] }]
  return projectFileV3Schema.parse(project)
}

export const createOrderFulfillmentWorkflowExample = (): ProjectFile => {
  const project = createEmptyProject('order-fulfillment-workflow')
  project.name = 'Compensating order fulfillment'
  project.modelingMode = 'business-aware'
  const clients = createRegisteredNode('traffic', 'order-clients', { x: 20, y: 210 }, 'fulfillment-compatibility-load')
  const api = createRegisteredNode('service', 'orders-api', { x: 250, y: 210 })
  const workflow = createRegisteredNode('workflow', 'fulfillment-coordinator', { x: 480, y: 210 })
  const inventory = createRegisteredNode('service', 'inventory-allocation', { x: 760, y: 20 })
  const warehouse = createRegisteredNode('service', 'warehouse-service', { x: 760, y: 145 })
  const carrier = createRegisteredNode('service', 'carrier-service', { x: 760, y: 275 })
  const notification = createRegisteredNode('service', 'notification-service', { x: 760, y: 400 })
  clients.name = 'Order clients'
  api.name = 'Orders API'
  workflow.name = 'Fulfillment coordinator'
  inventory.name = 'Inventory allocation'
  warehouse.name = 'Warehouse service'
  carrier.name = 'Carrier service'
  notification.name = 'Notification service (unavailable)'
  for (const node of [api, inventory, warehouse, carrier, notification]) if (node.type === 'service') node.config = {
    ...node.config, replicas: 2, concurrencyPerReplica: 15, serviceTimeMs: 4, jitterMs: 0, errorRate: node.id === 'notification-service' ? 1 : 0, maxQueueSize: 1_000,
  }
  if (workflow.type !== 'workflow') throw new Error('Expected a Workflow node.')
  workflow.config = { ...workflow.config, maxConcurrentInstances: 200, persistenceTimeMs: 2, defaultStepTimeMs: 5, jitterMs: 0, errorRate: 0, maxQueueSize: 1_000 }
  project.topology.nodes = [clients, api, workflow, inventory, warehouse, carrier, notification]
  project.topology.edges = [
    connection('orders-to-api', 'order-clients', 'orders-api'), connection('api-to-fulfillment', 'orders-api', 'fulfillment-coordinator'),
    connection('fulfillment-to-inventory', 'fulfillment-coordinator', 'inventory-allocation'), connection('fulfillment-to-warehouse', 'fulfillment-coordinator', 'warehouse-service'),
    connection('fulfillment-to-carrier', 'fulfillment-coordinator', 'carrier-service'), connection('fulfillment-to-notification', 'fulfillment-coordinator', 'notification-service'),
  ]
  project.definitions = {
    schemaVersion: 1, jsonSchemas: [], dataModels: [], events: [], cacheKeys: [],
    apis: [{ id: 'fulfillment-contract', version: 1, name: 'Fulfillment API', ownerNodeId: 'orders-api', operations: [{ id: 'fulfill-order', name: 'Fulfill order', method: 'POST', path: '/orders/{id}/fulfillment', responses: [{ statusCode: '202' }], handlerTimeMs: 3 }] }],
    workflows: [{ id: 'order-fulfillment', version: 1, name: 'Order fulfillment', ownerNodeId: 'fulfillment-coordinator', steps: [
      { id: 'allocate-inventory', name: 'Allocate inventory', targetNodeId: 'inventory-allocation', timeoutMs: 120, retry: workflowRetry(3, 5), compensation: { targetNodeId: 'inventory-allocation', timeoutMs: 100, retry: workflowRetry(2, 5, 'fixed') } },
      { id: 'pick-and-pack', name: 'Pick and pack', targetNodeId: 'warehouse-service', timeoutMs: 150, retry: workflowRetry(2, 10), compensation: { targetNodeId: 'warehouse-service', timeoutMs: 100, retry: workflowRetry(2, 5, 'fixed') } },
      { id: 'book-carrier', name: 'Book carrier', targetNodeId: 'carrier-service', timeoutMs: 150, retry: workflowRetry(2, 10), compensation: { targetNodeId: 'carrier-service', timeoutMs: 100, retry: workflowRetry(2, 5, 'fixed') } },
      { id: 'notify-customer', name: 'Notify customer', targetNodeId: 'notification-service', timeoutMs: 100, retry: workflowRetry(3, 10, 'fixed') },
    ] }],
    interactions: [{ id: 'fulfillment-flow', version: 1, name: 'Compensating order fulfillment', entryOperation: { apiId: 'fulfillment-contract', apiVersion: 1, operationId: 'fulfill-order' }, actions: [
      { id: 'accept-fulfillment', kind: 'api-call', dependsOn: [], sourceNodeId: 'order-clients', targetNodeId: 'orders-api', operation: { apiId: 'fulfillment-contract', apiVersion: 1, operationId: 'fulfill-order' } },
      { id: 'coordinate-fulfillment', kind: 'workflow', dependsOn: ['accept-fulfillment'], nodeId: 'fulfillment-coordinator', workflow: { workflowId: 'order-fulfillment', workflowVersion: 1 }, idempotencyKeyPattern: 'fulfillment:{key}' },
    ] }],
  }
  const experiment = project.experiments[0]!
  experiment.seed = 'order-fulfillment-workflow'
  experiment.simulation = { durationSeconds: 5, sampleIntervalMs: 100, maxRequests: 500, traceLimit: 100, maxHops: 20 }
  experiment.workloads = [{ id: 'fulfillment-compatibility-load', name: 'Compatibility load', sourceNodeId: 'order-clients', requestsPerSecond: 1, startAtSeconds: 4, durationSeconds: 1, pattern: 'constant', requestBytes: 512 }]
  experiment.operationWorkloads = [{ id: 'fulfillment-operations', name: 'Order fulfillment', sourceNodeId: 'order-clients', phases: [{ id: 'steady', startAtSeconds: 0, durationSeconds: 2, requestsPerSecond: 6, pattern: 'constant' }], operationMix: [{ operation: { apiId: 'fulfillment-contract', apiVersion: 1, operationId: 'fulfill-order' }, interaction: { interactionId: 'fulfillment-flow', interactionVersion: 1 }, weight: 1, requestBytes: 768, responseBytes: 128, keyDistribution: { kind: 'uniform', keySpaceSize: 1_000_000 } }] }]
  return projectFileV3Schema.parse(project)
}

export const createGlobalStorefrontExample = (): ProjectFile => {
  const project = createEmptyProject('global-storefront')
  project.name = 'Global storefront'
  const northAmericaClients = createRegisteredNode('traffic', 'north-america-shoppers', { x: 20, y: 80 }, 'north-america-shopping')
  const europeClients = createRegisteredNode('traffic', 'europe-shoppers', { x: 20, y: 300 }, 'europe-shopping')
  const router = createRegisteredNode('global-router', 'storefront-global-router', { x: 310, y: 190 })
  const northAmericaApi = createRegisteredNode('service', 'north-america-storefront', { x: 610, y: 80 })
  const europeApi = createRegisteredNode('service', 'europe-storefront', { x: 610, y: 300 })
  const northAmericaCatalog = createRegisteredNode('database', 'north-america-catalog', { x: 900, y: 80 })
  const europeCatalog = createRegisteredNode('database', 'europe-catalog', { x: 900, y: 300 })
  northAmericaClients.name = 'North America shoppers'
  europeClients.name = 'Europe shoppers'
  router.name = 'Storefront global router'
  northAmericaApi.name = 'North America storefront'
  europeApi.name = 'Europe storefront'
  northAmericaCatalog.name = 'North America catalog'
  europeCatalog.name = 'Europe catalog'
  if (router.type !== 'global-router' || northAmericaApi.type !== 'service' || europeApi.type !== 'service') throw new Error('Expected a Global Router and regional Services.')
  router.config = {
    ...router.config, routingPolicy: 'geo', capacity: 20_000, lookupTimeMs: 0.4, jitterMs: 0, maxQueueSize: 20_000,
    decisionTtlMs: 500, healthCheckIntervalMs: 100, unhealthyThreshold: 2, healthyThreshold: 2, failoverDelayMs: 250,
  }
  northAmericaApi.config = { ...northAmericaApi.config, replicas: 3, concurrencyPerReplica: 40, serviceTimeMs: 4, jitterMs: 0, errorRate: 0 }
  europeApi.config = { ...europeApi.config, replicas: 2, concurrencyPerReplica: 40, serviceTimeMs: 5, jitterMs: 0, errorRate: 0 }
  project.topology.nodes = [northAmericaClients, europeClients, router, northAmericaApi, europeApi, northAmericaCatalog, europeCatalog]
  project.topology.edges = [
    connection('north-america-entry', northAmericaClients.id, router.id),
    connection('europe-entry', europeClients.id, router.id),
    connection('north-america-route', router.id, northAmericaApi.id),
    connection('europe-route', router.id, europeApi.id),
    connection('north-america-catalog-read', northAmericaApi.id, northAmericaCatalog.id),
    connection('europe-catalog-read', europeApi.id, europeCatalog.id),
  ]
  project.topology.groups = [
    { id: 'region-north-america', name: 'North America', kind: 'region', nodeIds: [northAmericaClients.id, northAmericaApi.id, northAmericaCatalog.id] },
    { id: 'region-europe', name: 'Europe', kind: 'region', nodeIds: [europeClients.id, europeApi.id, europeCatalog.id] },
  ]
  const experiment = project.experiments[0]!
  experiment.seed = 'global-storefront'
  experiment.simulation = { durationSeconds: 3, sampleIntervalMs: 100, maxRequests: 500, traceLimit: 200, maxHops: 12 }
  experiment.workloads = [
    { id: 'north-america-shopping', name: 'North America shopping', sourceNodeId: northAmericaClients.id, requestsPerSecond: 12, startAtSeconds: 0, durationSeconds: 2, pattern: 'constant', requestBytes: 1_024 },
    { id: 'europe-shopping', name: 'Europe shopping', sourceNodeId: europeClients.id, requestsPerSecond: 8, startAtSeconds: 0, durationSeconds: 2, pattern: 'constant', requestBytes: 1_024 },
  ]
  return projectFileV3Schema.parse(project)
}

export const createMultiRegionFailoverExample = (): ProjectFile => {
  const project = createEmptyProject('multi-region-failover')
  project.name = 'Multi-region failover'
  const clients = createRegisteredNode('traffic', 'primary-region-clients', { x: 20, y: 190 }, 'failover-traffic')
  const router = createRegisteredNode('global-router', 'failover-global-router', { x: 310, y: 190 })
  const primaryApi = createRegisteredNode('service', 'primary-api', { x: 620, y: 80 })
  const standbyApi = createRegisteredNode('service', 'standby-api', { x: 620, y: 300 })
  const primaryDatabase = createRegisteredNode('database', 'primary-database', { x: 910, y: 80 })
  const standbyDatabase = createRegisteredNode('database', 'standby-database', { x: 910, y: 300 })
  clients.name = 'Primary-region clients'
  router.name = 'Failover global router'
  primaryApi.name = 'Primary API'
  standbyApi.name = 'Standby API'
  primaryDatabase.name = 'Primary database'
  standbyDatabase.name = 'Standby database'
  if (router.type !== 'global-router' || primaryApi.type !== 'service' || standbyApi.type !== 'service') throw new Error('Expected a Global Router and regional Services.')
  router.config = {
    ...router.config, routingPolicy: 'health-aware', capacity: 20_000, lookupTimeMs: 0.5, jitterMs: 0, maxQueueSize: 20_000,
    decisionTtlMs: 400, healthCheckIntervalMs: 100, unhealthyThreshold: 1, healthyThreshold: 1, failoverDelayMs: 300,
  }
  primaryApi.config = { ...primaryApi.config, replicas: 3, concurrencyPerReplica: 40, serviceTimeMs: 4, jitterMs: 0, errorRate: 0 }
  standbyApi.config = { ...standbyApi.config, replicas: 2, concurrencyPerReplica: 30, serviceTimeMs: 6, jitterMs: 0, errorRate: 0 }
  project.topology.nodes = [clients, router, primaryApi, standbyApi, primaryDatabase, standbyDatabase]
  project.topology.edges = [
    connection('failover-entry', clients.id, router.id),
    { ...connection('primary-route', router.id, primaryApi.id), weight: 1_000_000 },
    connection('standby-route', router.id, standbyApi.id),
    connection('primary-data', primaryApi.id, primaryDatabase.id),
    connection('standby-data', standbyApi.id, standbyDatabase.id),
  ]
  project.topology.groups = [
    { id: 'region-primary', name: 'Primary region', kind: 'region', nodeIds: [clients.id, primaryApi.id, primaryDatabase.id] },
    { id: 'region-standby', name: 'Standby region', kind: 'region', nodeIds: [standbyApi.id, standbyDatabase.id] },
    { id: 'primary-service-zone', name: 'Primary service zone', kind: 'zone', nodeIds: [primaryApi.id, primaryDatabase.id] },
  ]
  const experiment = project.experiments[0]!
  experiment.seed = 'multi-region-failover'
  experiment.simulation = { durationSeconds: 4, sampleIntervalMs: 100, maxRequests: 500, traceLimit: 200, maxHops: 12 }
  experiment.workloads = [{ id: 'failover-traffic', name: 'Primary-region requests', sourceNodeId: clients.id, requestsPerSecond: 10, startAtSeconds: 0, durationSeconds: 3, pattern: 'constant', requestBytes: 1_024 }]
  experiment.faults = [{ id: 'primary-region-outage', type: 'region-outage', target: { kind: 'group', id: 'primary-service-zone' }, startAtSeconds: 0.6, durationSeconds: 1.2, enabled: true }]
  return projectFileV3Schema.parse(project)
}

/** A normal ProjectFile v3 fixture: the editor and runtime contain no order-specific branches. */
export const createOrderSystemExample = (): ProjectFile => createOrderSystemContractFixture()
