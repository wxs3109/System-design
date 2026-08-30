import type { EventStatus, ReasonCode, RuntimeEvent, RuntimeEventType } from '@system-design/model'

export interface EventInput {
  timestampMs: number
  requestId?: string
  traceId?: string
  spanId?: string
  parentSpanId?: string
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
    const updatesAggregate = input.type === 'request-generated'
      || input.attributes?.terminal === true
      || (input.nodeId !== undefined && input.type === 'request-queued')
      || (input.nodeId !== undefined && input.requestId !== undefined && input.spanId !== undefined
        && ((input.type === 'request-completed' && input.durationMs !== undefined)
          || input.type === 'request-failed'))
    if (!retained && !updatesAggregate) return undefined
    const interval = input.attributes?.terminal === true || input.type === 'node-snapshot' ? this.intervalFor(input.timestampMs) : undefined
    if (input.attributes?.terminal === true) {
      if (input.type === 'request-completed') {
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
      } else if (input.type === 'request-failed') {
        this.failedRequests += 1
        if (interval !== undefined) this.increment(this.failedRequestsByInterval, interval)
      }
    }
    if (input.type === 'request-generated') this.generatedRequests += 1
    if (input.nodeId && input.requestId && input.spanId) {
      // The runtime emits exactly one duration-bearing completion or non-terminal failure for a node span.
      if (input.type === 'request-completed' && input.durationMs !== undefined) this.increment(this.processedRequestsByNode, input.nodeId)
      if (input.type === 'request-failed' && input.attributes?.terminal !== true) this.increment(this.failedRequestsByNode, input.nodeId)
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
