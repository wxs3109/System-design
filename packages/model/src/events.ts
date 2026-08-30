import { z } from 'zod'

const identifierSchema = z.string().trim().min(1).max(160)
const nonNegativeSchema = z.number().finite().nonnegative()

export const runtimeEventTypeSchema = z.enum([
  'request-generated', 'request-arrived', 'request-queued', 'request-started', 'request-completed', 'request-failed',
  'dependency-started', 'dependency-returned', 'retry-scheduled', 'attempt-started', 'timeout-fired',
  'circuit-opened', 'circuit-half-opened', 'circuit-closed', 'rate-limit-accepted', 'rate-limit-rejected',
  'cache-hit', 'cache-miss', 'cache-written', 'cache-deleted', 'cache-evicted', 'cache-expired', 'message-published', 'message-consumed',
  'cdn-pop-selected', 'cdn-cache-hit', 'cdn-cache-miss', 'cdn-origin-fetch',
  'search-index-write-accepted', 'search-document-indexed', 'search-index-refreshed', 'search-replica-refreshed', 'search-query-fan-out', 'search-query-completed',
  'message-acknowledged', 'message-dead-lettered', 'stream-record-appended', 'stream-record-consumed',
  'object-read', 'object-written', 'database-read', 'database-written',
  'scheduler-tick', 'scheduler-run-released', 'scheduler-run-queued', 'scheduler-run-skipped', 'scheduler-run-settled',
  'operation-started', 'operation-completed', 'action-started', 'action-completed', 'action-skipped',
  'fault-activated', 'fault-recovered', 'metric-sampled', 'node-snapshot',
])

export const eventStatusSchema = z.enum(['pending', 'ok', 'error', 'rejected', 'cancelled'])
export const reasonCodeSchema = z.enum([
  'none', 'timeout', 'queue_full', 'node_down', 'rate_limited', 'circuit_open', 'packet_loss',
  'intrinsic_error', 'hop_limit', 'missing_node', 'simulation_ended',
  'backpressure', 'dead_lettered', 'no_healthy_target',
  'scheduler_missed',
  'latency_spike', 'region_outage', 'capacity_reduced', 'bandwidth_reduced', 'traffic_spike', 'hot_key',
])
export const eventAttributeValueSchema = z.union([z.string().max(500), z.number().finite(), z.boolean()])

export const runtimeEventSchema = z.object({
  runId: identifierSchema,
  timestampMs: nonNegativeSchema,
  sequence: z.number().int().nonnegative(),
  requestId: identifierSchema.optional(),
  traceId: identifierSchema.optional(),
  spanId: identifierSchema.optional(),
  parentSpanId: identifierSchema.optional(),
  operationId: identifierSchema.optional(),
  actionId: identifierSchema.optional(),
  nodeId: identifierSchema.optional(),
  edgeId: identifierSchema.optional(),
  attempt: z.number().int().positive().default(1),
  type: runtimeEventTypeSchema,
  status: eventStatusSchema,
  durationMs: nonNegativeSchema.optional(),
  queueDurationMs: nonNegativeSchema.optional(),
  bytes: z.number().int().nonnegative().optional(),
  reason: reasonCodeSchema.default('none'),
  attributes: z.record(z.string().max(80), eventAttributeValueSchema).default({}),
}).superRefine((event, context) => {
  const requestFields = ['requestId', 'traceId', 'spanId'] as const
  const populatedRequestFields = requestFields.filter((field) => event[field] !== undefined)
  if (populatedRequestFields.length > 0 && populatedRequestFields.length < requestFields.length) {
    context.addIssue({ code: 'custom', message: 'Request events must include requestId, traceId and spanId together.' })
  }
  if (event.parentSpanId !== undefined && event.spanId === undefined) {
    context.addIssue({ code: 'custom', path: ['parentSpanId'], message: 'parentSpanId requires spanId.' })
  }
})

export const spanSchema = z.object({
  runId: identifierSchema, traceId: identifierSchema, spanId: identifierSchema, parentSpanId: identifierSchema.optional(),
  requestId: identifierSchema, nodeId: identifierSchema, edgeId: identifierSchema.optional(), attempt: z.number().int().positive(),
  startedAtMs: nonNegativeSchema, endedAtMs: nonNegativeSchema, durationMs: nonNegativeSchema, queueDurationMs: nonNegativeSchema,
  status: z.enum(['ok', 'error']), reason: reasonCodeSchema, operationId: identifierSchema.optional(), actionId: identifierSchema.optional(),
}).superRefine((span, context) => {
  if (span.endedAtMs < span.startedAtMs) {
    context.addIssue({ code: 'custom', path: ['endedAtMs'], message: 'A span cannot end before it starts.' })
  }
  if (span.durationMs !== span.endedAtMs - span.startedAtMs) {
    context.addIssue({ code: 'custom', path: ['durationMs'], message: 'Span duration must match its virtual-time boundaries.' })
  }
  if (span.queueDurationMs > span.durationMs) {
    context.addIssue({ code: 'custom', path: ['queueDurationMs'], message: 'Queue duration cannot exceed total span duration.' })
  }
})

export const simulationProgressSchema = z.object({
  runId: identifierSchema,
  simulatedTimeMs: nonNegativeSchema,
  simulatedDurationMs: nonNegativeSchema,
  generatedRequests: z.number().int().nonnegative(),
  completedRequests: z.number().int().nonnegative(),
  failedRequests: z.number().int().nonnegative(),
  events: z.array(runtimeEventSchema),
}).superRefine((progress, context) => {
  if (progress.simulatedTimeMs > progress.simulatedDurationMs) {
    context.addIssue({ code: 'custom', path: ['simulatedTimeMs'], message: 'Progress cannot exceed the simulated duration.' })
  }
  progress.events.forEach((event, index) => {
    if (event.runId !== progress.runId) {
      context.addIssue({ code: 'custom', path: ['events', index, 'runId'], message: 'Progress events must belong to the progress run.' })
    }
    if (index > 0 && event.sequence <= progress.events[index - 1]!.sequence) {
      context.addIssue({ code: 'custom', path: ['events', index, 'sequence'], message: 'Progress events must have strictly increasing sequence numbers.' })
    }
  })
})

export type RuntimeEventType = z.infer<typeof runtimeEventTypeSchema>
export type EventStatus = z.infer<typeof eventStatusSchema>
export type ReasonCode = z.infer<typeof reasonCodeSchema>
export type RuntimeEvent = z.infer<typeof runtimeEventSchema>
export type TraceSpan = z.infer<typeof spanSchema>
export type SimulationProgress = z.infer<typeof simulationProgressSchema>
