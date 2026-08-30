import type { EventStatus, ReasonCode, RuntimeEvent, RuntimeEventType } from '@system-design/model'

export interface EventInput {
  timestampMs: number
  requestId?: string
  traceId?: string
  spanId?: string
  parentSpanId?: string
  operationId?: string
  actionId?: string
  nodeId?: string
  edgeId?: string
  attempt?: number
  type: RuntimeEventType
  status: EventStatus
  durationMs?: number
  queueDurationMs?: number
  bytes?: number
  reason?: ReasonCode
  attributes?: Record<string, string | number | boolean>
}

export interface RuntimeTelemetryAggregate {
  generatedRequests: number
  completedRequests: number
  failedRequests: number
  completedLatencies: number[]
  processedRequestsByNode: ReadonlyMap<string, number>
  failedRequestsByNode: ReadonlyMap<string, number>
  maxQueueByNode: ReadonlyMap<string, number>
  latestNodeSnapshotByNode: ReadonlyMap<string, RuntimeEvent>
  completedRequestsByInterval: ReadonlyMap<number, number>
  failedRequestsByInterval: ReadonlyMap<number, number>
  completedLatenciesByInterval: ReadonlyMap<number, readonly number[]>
  queueSnapshotsByInterval: ReadonlyMap<number, ReadonlyMap<string, number>>
  operations: ReadonlyMap<string, OperationTelemetryAggregate>
  actions: ReadonlyMap<string, ActionTelemetryAggregate>
}

export interface OperationTelemetryAggregate {
  generatedRequests: number
  completedRequests: number
  failedRequests: number
  completedLatencies: readonly number[]
}

export interface ActionTelemetryAggregate {
  operationId: string
  actionId: string
  actionKind: string
  completed: number
  failed: number
  totalDurationMs: number
  recordsExamined: number
  bytesProcessed: number
  explanation?: string
}

export class RuntimeEventSink {
  readonly events: RuntimeEvent[] = []
  private sequence = 0
  private batch: RuntimeEvent[] = []
  private generatedRequests = 0
  private completedRequests = 0
  private failedRequests = 0
  private completedLatencies: number[] = []
  private readonly retainedRequestDetails: boolean
  private processedRequestsByNode = new Map<string, number>()
  private failedRequestsByNode = new Map<string, number>()
  private maxQueueByNode = new Map<string, number>()
  private latestNodeSnapshotByNode = new Map<string, RuntimeEvent>()
  private completedRequestsByInterval = new Map<number, number>()
  private failedRequestsByInterval = new Map<number, number>()
  private completedLatenciesByInterval = new Map<number, number[]>()
  private queueSnapshotsByInterval = new Map<number, Map<string, number>>()
  private operations = new Map<string, { generatedRequests: number; completedRequests: number; failedRequests: number; completedLatencies: number[] }>()
  private actions = new Map<string, ActionTelemetryAggregate>()

  constructor(
    readonly runId: string,
    private readonly onBatch?: (events: RuntimeEvent[]) => void,
    private readonly batchSize = 500,
    private readonly retainedRequestLimit = Number.POSITIVE_INFINITY,
    private readonly sampleIntervalMs?: number,
  ) {
    this.retainedRequestDetails = Number.isFinite(retainedRequestLimit)
  }

  emit(input: EventInput): RuntimeEvent | undefined {
    const requestNumber = input.requestId === undefined || !this.retainedRequestDetails ? undefined : Number(input.requestId)
    const retained = !this.retainedRequestDetails || requestNumber === undefined || !Number.isFinite(requestNumber) || requestNumber <= this.retainedRequestLimit
    const updatesAggregate = input.type === 'request-generated' || input.type === 'operation-started' || input.type === 'operation-completed'
      || input.attributes?.terminal === true
      || (input.nodeId !== undefined && input.type === 'request-queued')
      || (input.nodeId !== undefined && input.requestId !== undefined && input.spanId !== undefined
        && (((input.type === 'request-completed' || input.type === 'action-completed') && input.durationMs !== undefined)
          || input.type === 'request-failed'))
    if (!retained && !updatesAggregate) return undefined
    const interval = input.attributes?.terminal === true || input.type === 'node-snapshot' ? this.intervalFor(input.timestampMs) : undefined
    if (input.attributes?.terminal === true) {
      if (input.type === 'request-completed' || (input.type === 'operation-completed' && input.status === 'ok')) {
        this.completedRequests += 1
        const latency = input.attributes.totalLatencyMs
        if (typeof latency === 'number') {
          this.completedLatencies.push(latency)
          if (interval !== undefined && input.timestampMs > (interval - 1) * this.sampleIntervalMs!) {
            const latencies = this.completedLatenciesByInterval.get(interval) ?? []
            latencies.push(latency)
            this.completedLatenciesByInterval.set(interval, latencies)
          }
        }
        if (interval !== undefined) this.increment(this.completedRequestsByInterval, interval)
      } else if (input.type === 'request-failed' || input.type === 'operation-completed') {
        this.failedRequests += 1
        if (interval !== undefined) this.increment(this.failedRequestsByInterval, interval)
      }
    }
    if (input.type === 'request-generated' || input.type === 'operation-started') this.generatedRequests += 1
    if (input.operationId && (input.type === 'operation-started' || input.type === 'operation-completed')) {
      const operation = this.operations.get(input.operationId) ?? { generatedRequests: 0, completedRequests: 0, failedRequests: 0, completedLatencies: [] }
      if (input.type === 'operation-started') operation.generatedRequests += 1
      else if (input.status === 'ok') {
        operation.completedRequests += 1
        operation.completedLatencies.push(input.durationMs ?? Number(input.attributes?.totalLatencyMs ?? 0))
      } else operation.failedRequests += 1
      this.operations.set(input.operationId, operation)
    }
    if (input.operationId && input.actionId && input.type === 'action-completed') {
      const key = `${input.operationId}:${input.actionId}`
      const action = this.actions.get(key) ?? {
        operationId: input.operationId, actionId: input.actionId, actionKind: String(input.attributes?.actionKind ?? 'unknown'),
        completed: 0, failed: 0, totalDurationMs: 0, recordsExamined: 0, bytesProcessed: 0,
      }
      if (input.status === 'ok') action.completed += 1
      else action.failed += 1
      action.totalDurationMs += input.durationMs ?? 0
      action.recordsExamined += Number(input.attributes?.recordsExamined ?? 0)
      action.bytesProcessed += Number(input.attributes?.bytesProcessed ?? 0)
      if (typeof input.attributes?.explanation === 'string' && input.attributes.explanation) action.explanation = input.attributes.explanation
      this.actions.set(key, action)
    }
    if (input.nodeId && input.requestId && input.spanId) {
      // The runtime emits exactly one duration-bearing completion or non-terminal failure for a node span.
      if ((input.type === 'request-completed' || input.type === 'action-completed') && input.durationMs !== undefined && input.status === 'ok') this.increment(this.processedRequestsByNode, input.nodeId)
      if ((input.type === 'request-failed' && input.attributes?.terminal !== true) || (input.type === 'action-completed' && input.status !== 'ok')) this.increment(this.failedRequestsByNode, input.nodeId)
    }
    if (input.nodeId && input.type === 'request-queued') {
      const queueLength = Number(input.attributes?.queueLength ?? 0)
      this.maxQueueByNode.set(input.nodeId, Math.max(this.maxQueueByNode.get(input.nodeId) ?? 0, queueLength))
    }
    if (input.nodeId && input.type === 'node-snapshot' && interval !== undefined) {
      const snapshots = this.queueSnapshotsByInterval.get(interval) ?? new Map<string, number>()
      snapshots.set(input.nodeId, Number(input.attributes?.queueLength ?? 0))
      this.queueSnapshotsByInterval.set(interval, snapshots)
      this.maxQueueByNode.set(input.nodeId, Math.max(this.maxQueueByNode.get(input.nodeId) ?? 0, Number(input.attributes?.maxQueueLength ?? 0)))
    }
    if (!retained) return undefined
    const sequence = this.sequence++
    const event: RuntimeEvent = {
      runId: this.runId, timestampMs: input.timestampMs, sequence, attempt: input.attempt ?? 1,
      type: input.type, status: input.status, reason: input.reason ?? 'none', attributes: input.attributes ?? {},
      ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
      ...(input.traceId === undefined ? {} : { traceId: input.traceId }),
      ...(input.spanId === undefined ? {} : { spanId: input.spanId }),
      ...(input.parentSpanId === undefined ? {} : { parentSpanId: input.parentSpanId }),
      ...(input.operationId === undefined ? {} : { operationId: input.operationId }),
      ...(input.actionId === undefined ? {} : { actionId: input.actionId }),
      ...(input.nodeId === undefined ? {} : { nodeId: input.nodeId }),
      ...(input.edgeId === undefined ? {} : { edgeId: input.edgeId }),
      ...(input.durationMs === undefined ? {} : { durationMs: input.durationMs }),
      ...(input.queueDurationMs === undefined ? {} : { queueDurationMs: input.queueDurationMs }),
      ...(input.bytes === undefined ? {} : { bytes: input.bytes }),
    }
    if (input.type === 'node-snapshot' && input.nodeId) this.latestNodeSnapshotByNode.set(input.nodeId, event)
    this.events.push(event)
    if (this.onBatch) {
      this.batch.push(event)
      if (this.batch.length >= this.batchSize) this.flush()
    }
    return event
  }

  aggregateSnapshot(): RuntimeTelemetryAggregate {
    return {
      generatedRequests: this.generatedRequests,
      completedRequests: this.completedRequests,
      failedRequests: this.failedRequests,
      completedLatencies: this.completedLatencies.slice(),
      processedRequestsByNode: new Map(this.processedRequestsByNode),
      failedRequestsByNode: new Map(this.failedRequestsByNode),
      maxQueueByNode: new Map(this.maxQueueByNode),
      latestNodeSnapshotByNode: new Map(this.latestNodeSnapshotByNode),
      completedRequestsByInterval: new Map(this.completedRequestsByInterval),
      failedRequestsByInterval: new Map(this.failedRequestsByInterval),
      completedLatenciesByInterval: new Map([...this.completedLatenciesByInterval].map(([interval, latencies]) => [interval, latencies.slice()])),
      queueSnapshotsByInterval: new Map([...this.queueSnapshotsByInterval].map(([interval, snapshots]) => [interval, new Map(snapshots)])),
      operations: new Map([...this.operations].map(([operationId, operation]) => [operationId, { ...operation, completedLatencies: operation.completedLatencies.slice() }])),
      actions: new Map([...this.actions].map(([key, action]) => [key, { ...action }])),
    }
  }

  /** Detailed request events are retained only for the configured trace sample. */
  isRequestRetained(requestId: number) {
    return !this.retainedRequestDetails || requestId <= this.retainedRequestLimit
  }

  private intervalFor(timestampMs: number) {
    if (!this.sampleIntervalMs || this.sampleIntervalMs <= 0 || timestampMs < 0) return undefined
    return Math.max(1, Math.ceil(timestampMs / this.sampleIntervalMs))
  }

  private increment<Key>(counts: Map<Key, number>, key: Key) {
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  flush() {
    if (!this.onBatch || this.batch.length === 0) return
    const batch = this.batch
    this.batch = []
    this.onBatch(batch)
  }
}
