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

export const createJobSchedulerExample = (): ProjectFile => {
  const project = createEmptyProject('job-scheduler')
  project.name = 'Scheduled, recurring and on-demand jobs'
  project.modelingMode = 'business-aware'

  const clients = createRegisteredNode('traffic', 'job-clients', { x: 20, y: 20 }, 'job-submission-compatibility-load')
  const jobService = createRegisteredNode('service', 'job-service', { x: 280, y: 20 })
  const recurrenceScheduler = createRegisteredNode('scheduler', 'recurrence-scheduler', { x: 20, y: 220 })
  const recurrenceMaterializer = createRegisteredNode('service', 'recurrence-materializer', { x: 280, y: 220 })
  const dueScheduler = createRegisteredNode('scheduler', 'due-scan-scheduler', { x: 20, y: 420 })
  const coordinator = createRegisteredNode('service', 'job-coordinator', { x: 280, y: 420 })
  const publisher = createRegisteredNode('service', 'outbox-publisher', { x: 540, y: 420 })
  const queue = createRegisteredNode('queue', 'execution-queue', { x: 800, y: 420 })
  const workers = createRegisteredNode('service', 'job-workers', { x: 1_060, y: 420 })
  const reaperScheduler = createRegisteredNode('scheduler', 'lease-reaper-scheduler', { x: 20, y: 620 })
  const reaper = createRegisteredNode('service', 'lease-reaper', { x: 280, y: 620 })
  const store = createRegisteredNode('database', 'job-store', { x: 1_060, y: 20 })

  clients.name = 'Job clients'
  jobService.name = 'Job Service'
  recurrenceScheduler.name = 'Recurring schedule clock'
  recurrenceMaterializer.name = 'Occurrence Materializer'
  dueScheduler.name = 'Due scan clock'
  coordinator.name = 'Coordinator'
  publisher.name = 'Outbox Publisher'
  queue.name = 'Execution queue'
  workers.name = 'Workers'
  reaperScheduler.name = 'Lease reaper clock'
  reaper.name = 'Lease Reaper'
  store.name = 'Authoritative Job Store'

  for (const node of [jobService, recurrenceMaterializer, coordinator, publisher, reaper]) if (node.type === 'service') node.config = {
    ...node.config, replicas: 2, concurrencyPerReplica: 12, serviceTimeMs: 3, jitterMs: 0, errorRate: 0, maxQueueSize: 2_000,
  }
  if (workers.type !== 'service' || recurrenceScheduler.type !== 'scheduler' || dueScheduler.type !== 'scheduler' || reaperScheduler.type !== 'scheduler' || queue.type !== 'queue' || store.type !== 'database') {
    throw new Error('Expected Scheduler, Service, Queue and Database nodes.')
  }
  workers.config = { ...workers.config, replicas: 4, concurrencyPerReplica: 8, serviceTimeMs: 25, jitterMs: 2, errorRate: 0, maxQueueSize: 5_000 }
  recurrenceScheduler.config = { ...recurrenceScheduler.config, scheduleMode: 'periodic', intervalMs: 1_000, jitterMs: 10, missedRunPolicy: 'catch-up', concurrencyLimit: 1, maxPendingRuns: 10, requestBytes: 256 }
  dueScheduler.config = { ...dueScheduler.config, scheduleMode: 'periodic', intervalMs: 500, jitterMs: 25, missedRunPolicy: 'catch-up', concurrencyLimit: 2, maxPendingRuns: 20, requestBytes: 256 }
  reaperScheduler.config = { ...reaperScheduler.config, scheduleMode: 'periodic', intervalMs: 2_000, startAtMs: 1_000, jitterMs: 0, missedRunPolicy: 'skip', concurrencyLimit: 1, maxPendingRuns: 1, requestBytes: 128 }
  queue.config = { ...queue.config, consumers: 8, deliveryTimeMs: 8, jitterMs: 1, maxDepth: 10_000, errorRate: 0 }
  store.config = { ...store.config, maxConnections: 80, queryTimeMs: 4, jitterMs: 1, errorRate: 0, maxQueueSize: 10_000, shardCount: 4, replicasPerShard: 1, readPreference: 'primary', replicationDelayMs: 20, writeRatio: 0.75, keySpaceSize: 1_000_000, hotKeyProbability: 0 }

  project.topology.nodes = [clients, jobService, recurrenceScheduler, recurrenceMaterializer, dueScheduler, coordinator, publisher, queue, workers, reaperScheduler, reaper, store]
  project.topology.edges = [
    connection('clients-to-job-service', clients.id, jobService.id),
    connection('job-service-to-store', jobService.id, store.id),
    connection('recurrence-clock-to-materializer', recurrenceScheduler.id, recurrenceMaterializer.id),
    connection('materializer-to-store', recurrenceMaterializer.id, store.id),
    connection('due-clock-to-coordinator', dueScheduler.id, coordinator.id),
    connection('coordinator-to-store', coordinator.id, store.id),
    connection('coordinator-to-publisher', coordinator.id, publisher.id),
    connection('publisher-to-store', publisher.id, store.id),
    asyncConnection('publisher-to-queue', publisher.id, queue.id),
    asyncConnection('queue-to-workers', queue.id, workers.id),
    connection('workers-to-store', workers.id, store.id),
    connection('reaper-clock-to-reaper', reaperScheduler.id, reaper.id),
    connection('reaper-to-store', reaper.id, store.id),
  ]

  project.definitions = {
    schemaVersion: 1,
    jsonSchemas: [
      {
        id: 'schema.CreateJob', version: 1, name: 'Create one-time scheduled job', dialect: 'https://json-schema.org/draft/2020-12/schema',
        schema: { type: 'object', required: ['idempotencyKey', 'runAt', 'payload'], properties: { idempotencyKey: { type: 'string' }, runAt: { type: 'string', format: 'date-time' }, payload: { type: 'object' } } },
      },
      {
        id: 'schema.CreateRecurringJob', version: 1, name: 'Create recurring job', dialect: 'https://json-schema.org/draft/2020-12/schema',
        schema: { type: 'object', required: ['idempotencyKey', 'scheduleExpression', 'timeZone', 'misfirePolicy', 'overlapPolicy', 'payload'], properties: { idempotencyKey: { type: 'string' }, scheduleExpression: { type: 'string' }, timeZone: { type: 'string' }, misfirePolicy: { type: 'string', enum: ['skip', 'fire-once', 'catch-up'] }, overlapPolicy: { type: 'string', enum: ['allow', 'queue', 'skip'] }, payload: { type: 'object' } } },
      },
      {
        id: 'schema.RunJobNow', version: 1, name: 'Run job on demand', dialect: 'https://json-schema.org/draft/2020-12/schema',
        schema: { type: 'object', required: ['idempotencyKey'], properties: { idempotencyKey: { type: 'string' }, payloadOverride: { type: 'object' } } },
      },
      {
        id: 'schema.JobAccepted', version: 1, name: 'Accepted job', dialect: 'https://json-schema.org/draft/2020-12/schema',
        schema: { type: 'object', required: ['jobId', 'executionId'], properties: { jobId: { type: 'string' }, executionId: { type: 'string' } } },
      },
      {
        id: 'schema.RecurringJobAccepted', version: 1, name: 'Accepted recurring job', dialect: 'https://json-schema.org/draft/2020-12/schema',
        schema: { type: 'object', required: ['jobId', 'scheduleVersion'], properties: { jobId: { type: 'string' }, scheduleVersion: { type: 'integer' } } },
      },
      {
        id: 'schema.ExecutionReady', version: 1, name: 'Execution ready message', dialect: 'https://json-schema.org/draft/2020-12/schema',
        schema: { type: 'object', required: ['executionId', 'shardId'], properties: { executionId: { type: 'string' }, shardId: { type: 'integer' } } },
      },
    ],
    apis: [
      {
        id: 'job-api', version: 1, name: 'Job API', ownerNodeId: jobService.id,
        operations: [
          { id: 'create-job', name: 'Create a one-time scheduled job', method: 'POST', path: '/jobs', request: { schema: { schemaId: 'schema.CreateJob', schemaVersion: 1 }, estimatedBytes: 1_024 }, responses: [{ statusCode: '202', body: { schema: { schemaId: 'schema.JobAccepted', schemaVersion: 1 }, estimatedBytes: 256 } }], handlerTimeMs: 3, slo: { latencyP95Ms: 150, availability: 0.999 } },
          { id: 'create-recurring-job', name: 'Create a recurring job', method: 'POST', path: '/recurring-jobs', request: { schema: { schemaId: 'schema.CreateRecurringJob', schemaVersion: 1 }, estimatedBytes: 1_152 }, responses: [{ statusCode: '202', body: { schema: { schemaId: 'schema.RecurringJobAccepted', schemaVersion: 1 }, estimatedBytes: 192 } }], handlerTimeMs: 3, slo: { latencyP95Ms: 150, availability: 0.999 } },
          { id: 'run-job-now', name: 'Run a job on demand', method: 'POST', path: '/jobs/{jobId}/executions', request: { schema: { schemaId: 'schema.RunJobNow', schemaVersion: 1 }, estimatedBytes: 512 }, responses: [{ statusCode: '202', body: { schema: { schemaId: 'schema.JobAccepted', schemaVersion: 1 }, estimatedBytes: 256 } }], handlerTimeMs: 2, slo: { latencyP95Ms: 100, availability: 0.999 } },
        ],
      },
      {
        id: 'recurrence-api', version: 1, name: 'Recurrence Materializer API', ownerNodeId: recurrenceMaterializer.id,
        operations: [{ id: 'materialize-recurring-executions', name: 'Materialize due recurring occurrences', method: 'POST', path: '/internal/recurrences/materialize-due', responses: [{ statusCode: '202' }], handlerTimeMs: 2 }],
      },
      {
        id: 'coordinator-api', version: 1, name: 'Coordinator API', ownerNodeId: coordinator.id,
        operations: [{ id: 'dispatch-due-executions', name: 'Scan and dispatch due executions', method: 'POST', path: '/internal/executions/dispatch-due', responses: [{ statusCode: '202' }], handlerTimeMs: 2 }],
      },
      {
        id: 'outbox-api', version: 1, name: 'Outbox Publisher API', ownerNodeId: publisher.id,
        operations: [{ id: 'publish-pending-outbox', name: 'Publish pending outbox records', method: 'POST', path: '/internal/outbox/publish', responses: [{ statusCode: '202' }], handlerTimeMs: 2 }],
      },
      {
        id: 'lease-reaper-api', version: 1, name: 'Lease Reaper API', ownerNodeId: reaper.id,
        operations: [{ id: 'reap-expired-leases', name: 'Reap expired leases', method: 'POST', path: '/internal/leases/reap', responses: [{ statusCode: '202' }], handlerTimeMs: 2 }],
      },
    ],
    dataModels: [{
      id: 'job-store-model', version: 1, name: 'Co-located scheduler state', ownerNodeId: store.id, kind: 'relational',
      tables: [
        {
          id: 'jobs', name: 'jobs', columns: [
            { id: 'job-id', name: 'job_id', type: { kind: 'uuid' }, nullable: false },
            { id: 'idempotency-key', name: 'idempotency_key', type: { kind: 'string', maxLength: 160 }, nullable: false },
            { id: 'job-trigger-kind', name: 'trigger_kind', type: { kind: 'string', maxLength: 24 }, nullable: false },
            { id: 'payload', name: 'payload', type: { kind: 'json' }, nullable: false },
            { id: 'schedule-expression', name: 'schedule_expression', type: { kind: 'string', maxLength: 160 }, nullable: true },
            { id: 'schedule-time-zone', name: 'schedule_time_zone', type: { kind: 'string', maxLength: 64 }, nullable: true },
            { id: 'schedule-version', name: 'schedule_version', type: { kind: 'integer', bits: 64 }, nullable: false },
            { id: 'next-run-at', name: 'next_run_at', type: { kind: 'datetime' }, nullable: true },
            { id: 'misfire-policy', name: 'misfire_policy', type: { kind: 'string', maxLength: 24 }, nullable: true },
            { id: 'overlap-policy', name: 'overlap_policy', type: { kind: 'string', maxLength: 24 }, nullable: true },
            { id: 'created-at', name: 'created_at', type: { kind: 'datetime' }, nullable: false },
          ], primaryKey: { id: 'pk-jobs', name: 'jobs_pk', columnIds: ['job-id'] }, uniqueKeys: [{ id: 'uk-job-idempotency', name: 'jobs_idempotency_uk', columnIds: ['idempotency-key'] }], foreignKeys: [], indexes: [{ id: 'ix-recurring-jobs-due', name: 'jobs_recurring_due', columnIds: ['job-trigger-kind', 'next-run-at'], includedColumnIds: ['job-id', 'schedule-version'], kind: 'btree', unique: false }], estimatedRows: 100_000_000, estimatedRowBytes: 1_280,
        },
        {
          id: 'executions', name: 'executions', columns: [
            { id: 'execution-id', name: 'execution_id', type: { kind: 'uuid' }, nullable: false },
            { id: 'execution-job-id', name: 'job_id', type: { kind: 'uuid' }, nullable: false },
            { id: 'execution-trigger-kind', name: 'trigger_kind', type: { kind: 'string', maxLength: 24 }, nullable: false },
            { id: 'execution-schedule-version', name: 'schedule_version', type: { kind: 'integer', bits: 64 }, nullable: false },
            { id: 'execution-status', name: 'status', type: { kind: 'string', maxLength: 32 }, nullable: false },
            { id: 'run-at', name: 'run_at', type: { kind: 'datetime' }, nullable: false },
            { id: 'current-attempt', name: 'current_attempt', type: { kind: 'integer', bits: 32 }, nullable: false },
            { id: 'execution-version', name: 'version', type: { kind: 'integer', bits: 64 }, nullable: false },
          ], primaryKey: { id: 'pk-executions', name: 'executions_pk', columnIds: ['execution-id'] }, uniqueKeys: [{ id: 'uk-execution-occurrence', name: 'executions_occurrence_uk', columnIds: ['execution-job-id', 'execution-schedule-version', 'run-at'] }], foreignKeys: [{ id: 'fk-execution-job', name: 'executions_job_fk', columnIds: ['execution-job-id'], referencedTableId: 'jobs', referencedColumnIds: ['job-id'] }], indexes: [{ id: 'ix-due-executions', name: 'executions_due', columnIds: ['execution-status', 'run-at'], includedColumnIds: ['execution-id', 'execution-version'], kind: 'btree', unique: false }], estimatedRows: 100_000_000, estimatedRowBytes: 448,
        },
        {
          id: 'attempts', name: 'attempts', columns: [
            { id: 'attempt-id', name: 'attempt_id', type: { kind: 'uuid' }, nullable: false },
            { id: 'attempt-execution-id', name: 'execution_id', type: { kind: 'uuid' }, nullable: false },
            { id: 'attempt-number', name: 'attempt_number', type: { kind: 'integer', bits: 32 }, nullable: false },
            { id: 'attempt-status', name: 'status', type: { kind: 'string', maxLength: 32 }, nullable: false },
            { id: 'lease-until', name: 'lease_until', type: { kind: 'datetime' }, nullable: false },
            { id: 'fencing-token', name: 'fencing_token', type: { kind: 'integer', bits: 64 }, nullable: false },
          ], primaryKey: { id: 'pk-attempts', name: 'attempts_pk', columnIds: ['attempt-id'] }, uniqueKeys: [{ id: 'uk-execution-attempt', name: 'attempts_execution_number_uk', columnIds: ['attempt-execution-id', 'attempt-number'] }], foreignKeys: [{ id: 'fk-attempt-execution', name: 'attempts_execution_fk', columnIds: ['attempt-execution-id'], referencedTableId: 'executions', referencedColumnIds: ['execution-id'] }], indexes: [{ id: 'ix-expired-leases', name: 'attempts_expired_lease', columnIds: ['attempt-status', 'lease-until'], includedColumnIds: ['attempt-execution-id', 'fencing-token'], kind: 'btree', unique: false }], estimatedRows: 140_000_000, estimatedRowBytes: 320,
        },
        {
          id: 'outbox', name: 'outbox', columns: [
            { id: 'outbox-id', name: 'outbox_id', type: { kind: 'uuid' }, nullable: false },
            { id: 'outbox-execution-id', name: 'execution_id', type: { kind: 'uuid' }, nullable: false },
            { id: 'outbox-status', name: 'status', type: { kind: 'string', maxLength: 16 }, nullable: false },
            { id: 'outbox-created-at', name: 'created_at', type: { kind: 'datetime' }, nullable: false },
            { id: 'published-at', name: 'published_at', type: { kind: 'datetime' }, nullable: true },
          ], primaryKey: { id: 'pk-outbox', name: 'outbox_pk', columnIds: ['outbox-id'] }, uniqueKeys: [{ id: 'uk-outbox-execution', name: 'outbox_execution_uk', columnIds: ['outbox-execution-id'] }], foreignKeys: [{ id: 'fk-outbox-execution', name: 'outbox_execution_fk', columnIds: ['outbox-execution-id'], referencedTableId: 'executions', referencedColumnIds: ['execution-id'] }], indexes: [{ id: 'ix-pending-outbox', name: 'outbox_pending', columnIds: ['outbox-status', 'outbox-created-at'], includedColumnIds: ['outbox-id', 'outbox-execution-id'], kind: 'btree', unique: false }], estimatedRows: 100_000_000, estimatedRowBytes: 256,
        },
      ],
    }],
    events: [{ id: 'execution-ready', version: 1, name: 'ExecutionReady', payloadSchema: { schemaId: 'schema.ExecutionReady', schemaVersion: 1 }, estimatedPayloadBytes: 256, partitionKey: '/executionId', ordering: 'partition-key', delivery: 'at-least-once', producerNodeId: publisher.id, consumerNodeIds: [workers.id] }],
    cacheKeys: [], workflows: [],
    interactions: [
      {
        id: 'create-job-flow', version: 1, name: 'Idempotent job creation', entryOperation: { apiId: 'job-api', apiVersion: 1, operationId: 'create-job' },
        actions: [
          { id: 'accept-job', kind: 'api-call', dependsOn: [], sourceNodeId: clients.id, targetNodeId: jobService.id, operation: { apiId: 'job-api', apiVersion: 1, operationId: 'create-job' } },
          { id: 'insert-job', kind: 'data-access', dependsOn: ['accept-job'], nodeId: store.id, model: { modelId: 'job-store-model', modelVersion: 1 }, objectId: 'jobs', operation: 'insert', estimatedRows: 1 },
          { id: 'insert-execution', kind: 'data-access', dependsOn: ['insert-job'], nodeId: store.id, model: { modelId: 'job-store-model', modelVersion: 1 }, objectId: 'executions', operation: 'insert', estimatedRows: 1 },
        ],
      },
      {
        id: 'create-recurring-job-flow', version: 1, name: 'Recurring schedule creation', entryOperation: { apiId: 'job-api', apiVersion: 1, operationId: 'create-recurring-job' },
        actions: [
          { id: 'accept-recurring-job', kind: 'api-call', dependsOn: [], sourceNodeId: clients.id, targetNodeId: jobService.id, operation: { apiId: 'job-api', apiVersion: 1, operationId: 'create-recurring-job' } },
          { id: 'insert-recurring-job', kind: 'data-access', dependsOn: ['accept-recurring-job'], nodeId: store.id, model: { modelId: 'job-store-model', modelVersion: 1 }, objectId: 'jobs', operation: 'insert', estimatedRows: 1 },
        ],
      },
      {
        id: 'run-job-now-flow', version: 1, name: 'On-demand execution creation', entryOperation: { apiId: 'job-api', apiVersion: 1, operationId: 'run-job-now' },
        actions: [
          { id: 'accept-on-demand-run', kind: 'api-call', dependsOn: [], sourceNodeId: clients.id, targetNodeId: jobService.id, operation: { apiId: 'job-api', apiVersion: 1, operationId: 'run-job-now' } },
          { id: 'insert-on-demand-execution', kind: 'data-access', dependsOn: ['accept-on-demand-run'], nodeId: store.id, model: { modelId: 'job-store-model', modelVersion: 1 }, objectId: 'executions', operation: 'insert', estimatedRows: 1 },
        ],
      },
      {
        id: 'materialize-recurring-flow', version: 1, name: 'Recurring occurrence materialization', entryOperation: { apiId: 'recurrence-api', apiVersion: 1, operationId: 'materialize-recurring-executions' },
        actions: [
          { id: 'trigger-recurrence-scan', kind: 'api-call', dependsOn: [], sourceNodeId: recurrenceScheduler.id, targetNodeId: recurrenceMaterializer.id, operation: { apiId: 'recurrence-api', apiVersion: 1, operationId: 'materialize-recurring-executions' } },
          { id: 'scan-due-recurring-jobs', kind: 'data-access', dependsOn: ['trigger-recurrence-scan'], nodeId: store.id, model: { modelId: 'job-store-model', modelVersion: 1 }, objectId: 'jobs', operation: 'index-read', indexId: 'ix-recurring-jobs-due', estimatedRows: 16 },
          { id: 'insert-recurring-occurrence', kind: 'data-access', dependsOn: ['scan-due-recurring-jobs'], nodeId: store.id, model: { modelId: 'job-store-model', modelVersion: 1 }, objectId: 'executions', operation: 'insert', estimatedRows: 1 },
          { id: 'advance-recurring-schedule', kind: 'data-access', dependsOn: ['insert-recurring-occurrence'], nodeId: store.id, model: { modelId: 'job-store-model', modelVersion: 1 }, objectId: 'jobs', operation: 'update', estimatedRows: 1 },
        ],
      },
      {
        id: 'dispatch-due-flow', version: 1, name: 'Due scan, outbox dispatch and worker claim', entryOperation: { apiId: 'coordinator-api', apiVersion: 1, operationId: 'dispatch-due-executions' },
        actions: [
          { id: 'trigger-due-scan', kind: 'api-call', dependsOn: [], sourceNodeId: dueScheduler.id, targetNodeId: coordinator.id, operation: { apiId: 'coordinator-api', apiVersion: 1, operationId: 'dispatch-due-executions' } },
          { id: 'scan-due-candidates', kind: 'data-access', dependsOn: ['trigger-due-scan'], nodeId: store.id, model: { modelId: 'job-store-model', modelVersion: 1 }, objectId: 'executions', operation: 'index-read', indexId: 'ix-due-executions', estimatedRows: 32 },
          { id: 'claim-scheduled-execution', kind: 'data-access', dependsOn: ['scan-due-candidates'], nodeId: store.id, model: { modelId: 'job-store-model', modelVersion: 1 }, objectId: 'executions', operation: 'update', estimatedRows: 1 },
          { id: 'insert-outbox-record', kind: 'data-access', dependsOn: ['claim-scheduled-execution'], nodeId: store.id, model: { modelId: 'job-store-model', modelVersion: 1 }, objectId: 'outbox', operation: 'insert', estimatedRows: 1 },
          { id: 'wake-outbox-publisher', kind: 'service-call', dependsOn: ['insert-outbox-record'], sourceNodeId: coordinator.id, targetNodeId: publisher.id, operation: { apiId: 'outbox-api', apiVersion: 1, operationId: 'publish-pending-outbox' } },
          { id: 'read-pending-outbox', kind: 'data-access', dependsOn: ['wake-outbox-publisher'], nodeId: store.id, model: { modelId: 'job-store-model', modelVersion: 1 }, objectId: 'outbox', operation: 'index-read', indexId: 'ix-pending-outbox', estimatedRows: 32 },
          { id: 'publish-execution-ready', kind: 'event-publish', dependsOn: ['read-pending-outbox'], producerNodeId: publisher.id, brokerNodeId: queue.id, event: { eventId: 'execution-ready', eventVersion: 1 } },
          { id: 'mark-outbox-sent', kind: 'data-access', dependsOn: ['publish-execution-ready'], nodeId: store.id, model: { modelId: 'job-store-model', modelVersion: 1 }, objectId: 'outbox', operation: 'update', estimatedRows: 1 },
          { id: 'consume-execution-ready', kind: 'event-consume', dependsOn: ['publish-execution-ready'], consumerNodeId: workers.id, brokerNodeId: queue.id, event: { eventId: 'execution-ready', eventVersion: 1 } },
          { id: 'claim-execution-attempt', kind: 'data-access', dependsOn: ['consume-execution-ready'], nodeId: store.id, model: { modelId: 'job-store-model', modelVersion: 1 }, objectId: 'executions', operation: 'update', estimatedRows: 1 },
          { id: 'insert-attempt-with-lease', kind: 'data-access', dependsOn: ['claim-execution-attempt'], nodeId: store.id, model: { modelId: 'job-store-model', modelVersion: 1 }, objectId: 'attempts', operation: 'insert', estimatedRows: 1 },
          { id: 'complete-execution', kind: 'data-access', dependsOn: ['insert-attempt-with-lease'], nodeId: store.id, model: { modelId: 'job-store-model', modelVersion: 1 }, objectId: 'executions', operation: 'update', estimatedRows: 1 },
        ],
      },
      {
        id: 'reap-expired-leases-flow', version: 1, name: 'Expired lease recovery', entryOperation: { apiId: 'lease-reaper-api', apiVersion: 1, operationId: 'reap-expired-leases' },
        actions: [
          { id: 'trigger-lease-reaper', kind: 'api-call', dependsOn: [], sourceNodeId: reaperScheduler.id, targetNodeId: reaper.id, operation: { apiId: 'lease-reaper-api', apiVersion: 1, operationId: 'reap-expired-leases' } },
          { id: 'scan-expired-leases', kind: 'data-access', dependsOn: ['trigger-lease-reaper'], nodeId: store.id, model: { modelId: 'job-store-model', modelVersion: 1 }, objectId: 'attempts', operation: 'index-read', indexId: 'ix-expired-leases', estimatedRows: 16 },
          { id: 'close-expired-attempt', kind: 'data-access', dependsOn: ['scan-expired-leases'], nodeId: store.id, model: { modelId: 'job-store-model', modelVersion: 1 }, objectId: 'attempts', operation: 'update', estimatedRows: 1 },
          { id: 'return-execution-to-retry', kind: 'data-access', dependsOn: ['close-expired-attempt'], nodeId: store.id, model: { modelId: 'job-store-model', modelVersion: 1 }, objectId: 'executions', operation: 'update', estimatedRows: 1 },
        ],
      },
    ],
  }

  const experiment = project.experiments[0]!
  experiment.seed = 'mixed-job-scheduler'
  experiment.simulation = { durationSeconds: 6, sampleIntervalMs: 250, maxRequests: 2_000, traceLimit: 200, maxHops: 32 }
  experiment.workloads = [{ id: 'job-submission-compatibility-load', name: 'Superseded capacity load', sourceNodeId: clients.id, requestsPerSecond: 1, startAtSeconds: 5, durationSeconds: 1, pattern: 'constant', requestBytes: 1_024 }]
  experiment.operationWorkloads = [
    {
      id: 'job-commands', name: 'Scheduled and on-demand job commands', sourceNodeId: clients.id,
      phases: [{ id: 'submission-steady', startAtSeconds: 0, durationSeconds: 5, requestsPerSecond: 15, pattern: 'poisson' }],
      operationMix: [
        { operation: { apiId: 'job-api', apiVersion: 1, operationId: 'create-job' }, interaction: { interactionId: 'create-job-flow', interactionVersion: 1 }, weight: 0.4, requestBytes: 1_024, responseBytes: 256, keyDistribution: { kind: 'uniform', keySpaceSize: 1_000_000 }, valueSizeDistribution: { kind: 'fixed', bytes: 1_024 } },
        { operation: { apiId: 'job-api', apiVersion: 1, operationId: 'create-recurring-job' }, interaction: { interactionId: 'create-recurring-job-flow', interactionVersion: 1 }, weight: 0.2, requestBytes: 1_152, responseBytes: 192, keyDistribution: { kind: 'uniform', keySpaceSize: 100_000 }, valueSizeDistribution: { kind: 'fixed', bytes: 1_024 } },
        { operation: { apiId: 'job-api', apiVersion: 1, operationId: 'run-job-now' }, interaction: { interactionId: 'run-job-now-flow', interactionVersion: 1 }, weight: 0.4, requestBytes: 512, responseBytes: 256, keyDistribution: { kind: 'uniform', keySpaceSize: 1_000_000 }, valueSizeDistribution: { kind: 'fixed', bytes: 512 } },
      ],
    },
    {
      id: 'recurring-materialization-cycle', name: 'Recurring occurrence materialization', sourceNodeId: recurrenceScheduler.id,
      phases: [{ id: 'scheduler-owned', startAtSeconds: 0, durationSeconds: 6, requestsPerSecond: 1, pattern: 'constant' }],
      operationMix: [{ operation: { apiId: 'recurrence-api', apiVersion: 1, operationId: 'materialize-recurring-executions' }, interaction: { interactionId: 'materialize-recurring-flow', interactionVersion: 1 }, weight: 1, requestBytes: 256, responseBytes: 64, keyDistribution: { kind: 'uniform', keySpaceSize: 100_000 } }],
    },
    {
      id: 'due-dispatch-cycle', name: 'Due execution dispatch', sourceNodeId: dueScheduler.id,
      phases: [{ id: 'scheduler-owned', startAtSeconds: 0, durationSeconds: 6, requestsPerSecond: 1, pattern: 'constant' }],
      operationMix: [{ operation: { apiId: 'coordinator-api', apiVersion: 1, operationId: 'dispatch-due-executions' }, interaction: { interactionId: 'dispatch-due-flow', interactionVersion: 1 }, weight: 1, requestBytes: 256, responseBytes: 64, keyDistribution: { kind: 'uniform', keySpaceSize: 1_000_000 } }],
    },
    {
      id: 'lease-recovery-cycle', name: 'Expired lease recovery', sourceNodeId: reaperScheduler.id,
      phases: [{ id: 'scheduler-owned', startAtSeconds: 0, durationSeconds: 6, requestsPerSecond: 1, pattern: 'constant' }],
      operationMix: [{ operation: { apiId: 'lease-reaper-api', apiVersion: 1, operationId: 'reap-expired-leases' }, interaction: { interactionId: 'reap-expired-leases-flow', interactionVersion: 1 }, weight: 1, requestBytes: 128, responseBytes: 64, keyDistribution: { kind: 'uniform', keySpaceSize: 1_000_000 } }],
    },
  ]
  return projectFileV3Schema.parse(project)
}

export const createVideoDeliveryExample = (): ProjectFile => {
  const project = createEmptyProject('video-delivery')
  project.name = 'Video delivery'
  project.modelingMode = 'business-aware'
  const uploadStreams = createRegisteredNode('traffic', 'video-upload-streams', { x: 20, y: 125 }, 'video-upload-chunks')
  const creators = createRegisteredNode('traffic', 'video-creators', { x: 20, y: 230 }, 'upload-compatibility-load')
  const rawUploads = createRegisteredNode('object-storage', 'raw-video-storage', { x: 250, y: 20 })
  const uploadApi = createRegisteredNode('service', 'video-upload-api', { x: 480, y: 20 })
  const transcodeQueue = createRegisteredNode('queue', 'transcode-queue', { x: 710, y: 20 })
  const transcoders = createRegisteredNode('service', 'transcoder-workers', { x: 940, y: 20 })
  const renditions = createRegisteredNode('object-storage', 'video-rendition-storage', { x: 940, y: 250 })
  const metadata = createRegisteredNode('database', 'video-metadata-db', { x: 710, y: 250 })
  const viewers = createRegisteredNode('traffic', 'video-viewers', { x: 20, y: 335 }, 'playback-compatibility-load')
  const playbackApi = createRegisteredNode('service', 'playback-api', { x: 250, y: 250 })
  const metadataCache = createRegisteredNode('cache', 'video-metadata-cache', { x: 480, y: 250 })
  const segmentStreams = createRegisteredNode('traffic', 'segment-streams', { x: 20, y: 500 }, 'video-segment-requests')
  const cdn = createRegisteredNode('cdn', 'video-cdn', { x: 360, y: 480 })
  const edgeResponse = createRegisteredNode('service', 'edge-stream-response', { x: 710, y: 480 })
  uploadStreams.name = 'Multipart uploader'
  creators.name = 'Creator Studio'
  rawUploads.name = 'Raw upload storage'
  uploadApi.name = 'Video upload API'
  transcodeQueue.name = 'Transcode queue'
  transcoders.name = 'Transcoder workers'
  renditions.name = 'Encoded renditions'
  metadata.name = 'Video metadata DB'
  viewers.name = 'Video viewers'
  playbackApi.name = 'Playback API'
  metadataCache.name = 'Metadata cache'
  segmentStreams.name = 'Adaptive streaming sessions'
  cdn.name = 'Video CDN'
  edgeResponse.name = 'Edge segment response'
  rawUploads.config = { ...rawUploads.config, maxConcurrentRequests: 200, defaultObjectSizeBytes: 67_108_864, readRatio: 0.1, baseLatencyMs: 20, jitterMs: 2, readThroughputMbps: 2_000, writeThroughputMbps: 1_000, errorRate: 0, maxQueueSize: 2_000 }
  uploadApi.config = { ...uploadApi.config, replicas: 4, concurrencyPerReplica: 25, serviceTimeMs: 8, jitterMs: 1, errorRate: 0, maxQueueSize: 2_000 }
  transcodeQueue.config = { ...transcodeQueue.config, consumers: 24, deliveryTimeMs: 5, jitterMs: 1, maxDepth: 20_000, errorRate: 0 }
  transcoders.config = { ...transcoders.config, replicas: 24, concurrencyPerReplica: 2, serviceTimeMs: 450, jitterMs: 25, errorRate: 0, maxQueueSize: 5_000 }
  renditions.config = { ...renditions.config, maxConcurrentRequests: 2_000, defaultObjectSizeBytes: 2_097_152, readRatio: 0.98, baseLatencyMs: 8, jitterMs: 1, readThroughputMbps: 10_000, writeThroughputMbps: 2_000, errorRate: 0, maxQueueSize: 20_000 }
  metadata.config = { ...metadata.config, maxConnections: 300, queryTimeMs: 4, jitterMs: 1, errorRate: 0, maxQueueSize: 5_000, shardCount: 8, replicasPerShard: 2, readPreference: 'replica-preferred', replicationDelayMs: 50, writeRatio: 0.15, keySpaceSize: 10_000_000, hotKeyProbability: 0.15 }
  playbackApi.config = { ...playbackApi.config, replicas: 8, concurrencyPerReplica: 100, serviceTimeMs: 3, jitterMs: 0.5, errorRate: 0, maxQueueSize: 10_000 }
  metadataCache.config = { ...metadataCache.config, capacityEntries: 1_000_000, ttlMs: 300_000, keySpaceSize: 10_000_000, hotKeyProbability: 0.7, maxConcurrentRequests: 5_000, operationTimeMs: 0.4, jitterMs: 0.1, errorRate: 0, maxQueueSize: 20_000 }
  cdn.config = { ...cdn.config, popCount: 12, popSelection: 'consistent-hash', capacityEntriesPerPop: 50_000, ttlMs: 300_000, keySpaceSize: 50_000, hotKeyProbability: 0.7, maxConcurrentRequests: 20_000, lookupTimeMs: 0.2, edgeLatencyMs: 8, edgeBandwidthMbps: 10_000, originRoundTripMs: 75, originBandwidthMbps: 2_000, defaultObjectSizeBytes: 2_097_152, jitterMs: 0.5, errorRate: 0, maxQueueSize: 100_000 }
  edgeResponse.config = { ...edgeResponse.config, replicas: 20, concurrencyPerReplica: 200, serviceTimeMs: 0.5, jitterMs: 0.1, errorRate: 0, maxQueueSize: 50_000 }
  project.topology.nodes = [uploadStreams, creators, rawUploads, uploadApi, transcodeQueue, transcoders, renditions, metadata, viewers, playbackApi, metadataCache, segmentStreams, cdn, edgeResponse]
  project.topology.edges = [
    connection('upload-streams-to-raw-storage', 'video-upload-streams', 'raw-video-storage'),
    connection('creator-to-upload-api', 'video-creators', 'video-upload-api'),
    connection('upload-api-to-metadata', 'video-upload-api', 'video-metadata-db'),
    asyncConnection('upload-api-to-transcode-queue', 'video-upload-api', 'transcode-queue'),
    asyncConnection('queue-to-transcoders', 'transcode-queue', 'transcoder-workers'),
    connection('transcoders-to-renditions', 'transcoder-workers', 'video-rendition-storage'),
    connection('renditions-to-metadata', 'video-rendition-storage', 'video-metadata-db'),
    connection('viewers-to-playback-api', 'video-viewers', 'playback-api'),
    connection('playback-api-to-cache', 'playback-api', 'video-metadata-cache'),
    { ...connection('metadata-cache-miss', 'video-metadata-cache', 'video-metadata-db'), sourcePort: 'miss', sourceSemantic: 'miss' },
    connection('segments-to-cdn', 'segment-streams', 'video-cdn'),
    { ...connection('cdn-cache-hit', 'video-cdn', 'edge-stream-response'), sourcePort: 'hit', sourceSemantic: 'hit' },
    { ...connection('cdn-origin-fetch', 'video-cdn', 'video-rendition-storage'), sourcePort: 'miss', sourceSemantic: 'miss' },
  ]
  project.definitions = {
    schemaVersion: 1,
    jsonSchemas: [
      { id: 'schema.VideoUpload', version: 1, name: 'Video upload completion', dialect: 'https://json-schema.org/draft/2020-12/schema', schema: { type: 'object', required: ['videoId', 'creatorId', 'title', 'sourceObjectKey'], properties: { videoId: { type: 'string', format: 'uuid' }, creatorId: { type: 'string', format: 'uuid' }, title: { type: 'string' }, sourceObjectKey: { type: 'string' } } } },
      { id: 'schema.PlaybackManifest', version: 1, name: 'Adaptive playback manifest', dialect: 'https://json-schema.org/draft/2020-12/schema', schema: { type: 'object', required: ['videoId', 'manifestUrl', 'profiles'], properties: { videoId: { type: 'string', format: 'uuid' }, manifestUrl: { type: 'string', format: 'uri' }, profiles: { type: 'array', items: { type: 'string', enum: ['360p', '720p', '1080p', '4k'] } } } } },
      { id: 'schema.TranscodeRequested', version: 1, name: 'Transcode requested event', dialect: 'https://json-schema.org/draft/2020-12/schema', schema: { type: 'object', required: ['videoId', 'sourceObjectKey'], properties: { videoId: { type: 'string', format: 'uuid' }, sourceObjectKey: { type: 'string' }, profiles: { type: 'array', items: { type: 'string' } } } } },
    ],
    apis: [
      { id: 'video-upload-contract', version: 1, name: 'Video upload API', ownerNodeId: 'video-upload-api', operations: [{ id: 'complete-video-upload', name: 'Complete direct video upload', method: 'POST', path: '/videos/{videoId}/uploads/complete', request: { schema: { schemaId: 'schema.VideoUpload', schemaVersion: 1 }, estimatedBytes: 2_048 }, responses: [{ statusCode: '202' }], handlerTimeMs: 8, slo: { latencyP95Ms: 250, availability: 0.999 } }] },
      { id: 'playback-contract', version: 1, name: 'Playback API', ownerNodeId: 'playback-api', operations: [{ id: 'get-playback-manifest', name: 'Get adaptive playback manifest', method: 'GET', path: '/videos/{videoId}/playback', responses: [{ statusCode: '200', body: { schema: { schemaId: 'schema.PlaybackManifest', schemaVersion: 1 }, estimatedBytes: 4_096 } }], handlerTimeMs: 3, slo: { latencyP95Ms: 100, availability: 0.9999 } }] },
    ],
    dataModels: [{
      id: 'video-metadata-model', version: 1, name: 'Video metadata', ownerNodeId: 'video-metadata-db', kind: 'relational', tables: [{
        id: 'videos', name: 'videos',
        columns: [
          { id: 'id', name: 'id', type: { kind: 'uuid' }, nullable: false },
          { id: 'creator-id', name: 'creator_id', type: { kind: 'uuid' }, nullable: false },
          { id: 'title', name: 'title', type: { kind: 'string', maxLength: 200 }, nullable: false },
          { id: 'status', name: 'status', type: { kind: 'string', maxLength: 24 }, nullable: false },
          { id: 'source-key', name: 'source_object_key', type: { kind: 'string', maxLength: 500 }, nullable: false },
          { id: 'manifest-key', name: 'manifest_object_key', type: { kind: 'string', maxLength: 500 }, nullable: true },
          { id: 'duration-seconds', name: 'duration_seconds', type: { kind: 'integer', bits: 32 }, nullable: true },
          { id: 'published-at', name: 'published_at', type: { kind: 'datetime' }, nullable: true },
        ],
        primaryKey: { id: 'pk-videos', name: 'videos_pk', columnIds: ['id'] },
        uniqueKeys: [], foreignKeys: [],
        indexes: [
          { id: 'ix-videos-creator', name: 'videos_creator_idx', columnIds: ['creator-id'], kind: 'btree', unique: false, includedColumnIds: ['title', 'status'] },
          { id: 'ix-videos-status', name: 'videos_status_idx', columnIds: ['status'], kind: 'btree', unique: false, includedColumnIds: ['published-at'] },
        ],
        estimatedRows: 10_000_000, estimatedRowBytes: 1_024,
      }],
    }],
    events: [{ id: 'transcode-requested', version: 1, name: 'Transcode requested', payloadSchema: { schemaId: 'schema.TranscodeRequested', schemaVersion: 1 }, estimatedPayloadBytes: 1_024, partitionKey: '/videoId', ordering: 'partition-key', delivery: 'at-least-once', producerNodeId: 'video-upload-api', consumerNodeIds: ['transcoder-workers'] }],
    cacheKeys: [{ id: 'playback-metadata-key', version: 1, name: 'Playback metadata by video', pattern: 'playback:{videoId}', valueSchema: { schemaId: 'schema.PlaybackManifest', schemaVersion: 1 }, estimatedValueBytes: 4_096, ttlSeconds: 300 }],
    workflows: [],
    interactions: [
      {
        id: 'video-upload-flow', version: 1, name: 'Upload, transcode and publish video', entryOperation: { apiId: 'video-upload-contract', apiVersion: 1, operationId: 'complete-video-upload' }, actions: [
          { id: 'complete-upload', kind: 'api-call', dependsOn: [], sourceNodeId: 'video-creators', targetNodeId: 'video-upload-api', operation: { apiId: 'video-upload-contract', apiVersion: 1, operationId: 'complete-video-upload' } },
          { id: 'insert-processing-metadata', kind: 'data-access', dependsOn: ['complete-upload'], nodeId: 'video-metadata-db', model: { modelId: 'video-metadata-model', modelVersion: 1 }, objectId: 'videos', operation: 'insert', estimatedRows: 1 },
          { id: 'publish-transcode-job', kind: 'event-publish', dependsOn: ['insert-processing-metadata'], producerNodeId: 'video-upload-api', brokerNodeId: 'transcode-queue', event: { eventId: 'transcode-requested', eventVersion: 1 } },
          { id: 'consume-transcode-job', kind: 'event-consume', dependsOn: ['publish-transcode-job'], consumerNodeId: 'transcoder-workers', brokerNodeId: 'transcode-queue', event: { eventId: 'transcode-requested', eventVersion: 1 } },
          { id: 'write-renditions-and-publish-metadata', kind: 'data-access', dependsOn: ['consume-transcode-job'], nodeId: 'video-metadata-db', model: { modelId: 'video-metadata-model', modelVersion: 1 }, objectId: 'videos', operation: 'update', estimatedRows: 1 },
        ],
      },
      {
        id: 'video-playback-flow', version: 1, name: 'Resolve metadata for online playback', entryOperation: { apiId: 'playback-contract', apiVersion: 1, operationId: 'get-playback-manifest' }, actions: [
          { id: 'request-playback', kind: 'api-call', dependsOn: [], sourceNodeId: 'video-viewers', targetNodeId: 'playback-api', operation: { apiId: 'playback-contract', apiVersion: 1, operationId: 'get-playback-manifest' } },
          { id: 'get-cached-playback-metadata', kind: 'cache-access', dependsOn: ['request-playback'], nodeId: 'video-metadata-cache', operation: 'get', key: { cacheKeyId: 'playback-metadata-key', cacheKeyVersion: 1 } },
          { id: 'read-video-metadata-on-miss', kind: 'data-access', dependsOn: ['get-cached-playback-metadata'], condition: { actionId: 'get-cached-playback-metadata', outcome: 'cache-miss' }, nodeId: 'video-metadata-db', model: { modelId: 'video-metadata-model', modelVersion: 1 }, objectId: 'videos', operation: 'point-read', estimatedRows: 1 },
          { id: 'cache-playback-metadata', kind: 'cache-access', dependsOn: ['read-video-metadata-on-miss'], nodeId: 'video-metadata-cache', operation: 'put', key: { cacheKeyId: 'playback-metadata-key', cacheKeyVersion: 1 } },
        ],
      },
    ],
  }
  const experiment = project.experiments[0]!
  experiment.seed = 'video-delivery'
  experiment.simulation = { durationSeconds: 6, sampleIntervalMs: 250, maxRequests: 5_000, traceLimit: 200, maxHops: 20 }
  experiment.workloads = [
    { id: 'upload-compatibility-load', name: 'Multipart upload chunks', sourceNodeId: 'video-creators', requestsPerSecond: 1, startAtSeconds: 5, durationSeconds: 1, pattern: 'constant', requestBytes: 67_108_864 },
    { id: 'playback-compatibility-load', name: 'Playback compatibility load', sourceNodeId: 'video-viewers', requestsPerSecond: 1, startAtSeconds: 5, durationSeconds: 1, pattern: 'constant', requestBytes: 512 },
    { id: 'video-upload-chunks', name: 'Direct multipart uploads', sourceNodeId: 'video-upload-streams', requestsPerSecond: 2, startAtSeconds: 0, durationSeconds: 5, pattern: 'poisson', requestBytes: 67_108_864 },
    { id: 'video-segment-requests', name: 'Adaptive bitrate segment requests', sourceNodeId: 'segment-streams', requestsPerSecond: 180, startAtSeconds: 0, durationSeconds: 5, pattern: 'poisson', requestBytes: 512 },
  ]
  experiment.operationWorkloads = [
    { id: 'video-upload-operations', name: 'Creator multipart video uploads', sourceNodeId: 'video-creators', phases: [{ id: 'upload-steady', startAtSeconds: 0, durationSeconds: 5, requestsPerSecond: 2, pattern: 'poisson' }], operationMix: [{ operation: { apiId: 'video-upload-contract', apiVersion: 1, operationId: 'complete-video-upload' }, interaction: { interactionId: 'video-upload-flow', interactionVersion: 1 }, weight: 1, requestBytes: 67_108_864, responseBytes: 256, keyDistribution: { kind: 'uniform', keySpaceSize: 10_000_000 }, valueSizeDistribution: { kind: 'uniform', minBytes: 33_554_432, maxBytes: 134_217_728 } }] },
    { id: 'video-playback-operations', name: 'Online playback starts', sourceNodeId: 'video-viewers', phases: [{ id: 'playback-steady', startAtSeconds: 0, durationSeconds: 5, requestsPerSecond: 80, pattern: 'poisson' }], operationMix: [{ operation: { apiId: 'playback-contract', apiVersion: 1, operationId: 'get-playback-manifest' }, interaction: { interactionId: 'video-playback-flow', interactionVersion: 1 }, weight: 1, requestBytes: 512, responseBytes: 4_096, keyDistribution: { kind: 'hotspot', keySpaceSize: 50_000, hotKeyCount: 100, hotTrafficFraction: 0.75 }, valueSizeDistribution: { kind: 'fixed', bytes: 4_096 } }] },
  ]
  return projectFileV3Schema.parse(project)
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
