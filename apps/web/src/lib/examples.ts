import { createRegisteredNode } from '@system-design/components'
import { createEmptyProject, createOrderSystemContractFixture, type ProjectFile } from '@system-design/model'

const connection = (id: string, source: string, target: string) => ({
  id, source, target, sourcePort: 'out', targetPort: 'in', weight: 1,
  sourceSemantic: 'request' as const, targetSemantic: 'request' as const, routingMode: 'weighted-one' as const,
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

/** A normal ProjectFile v3 fixture: the editor and runtime contain no order-specific branches. */
export const createOrderSystemExample = (): ProjectFile => createOrderSystemContractFixture()
