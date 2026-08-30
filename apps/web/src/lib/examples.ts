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
    events: [], cacheKeys: [],
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
    cacheKeys: [],
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

/** A normal ProjectFile v3 fixture: the editor and runtime contain no order-specific branches. */
export const createOrderSystemExample = (): ProjectFile => createOrderSystemContractFixture()
