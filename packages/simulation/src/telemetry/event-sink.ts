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

export class RuntimeEventSink {
  readonly events: RuntimeEvent[] = []
  private sequence = 0
  private batch: RuntimeEvent[] = []

  constructor(readonly runId: string, private readonly onBatch?: (events: RuntimeEvent[]) => void, private readonly batchSize = 500) {}

  emit(input: EventInput): RuntimeEvent {
    const event: RuntimeEvent = {
      runId: this.runId, timestampMs: input.timestampMs, sequence: this.sequence++, attempt: input.attempt ?? 1,
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
    this.events.push(event)
    if (this.onBatch) {
      this.batch.push(event)
      if (this.batch.length >= this.batchSize) this.flush()
    }
    return event
  }

  flush() {
    if (!this.onBatch || this.batch.length === 0) return
    const batch = this.batch
    this.batch = []
    this.onBatch(batch)
  }
}
