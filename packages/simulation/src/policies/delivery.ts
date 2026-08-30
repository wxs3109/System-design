import type { EventStatus, ReasonCode } from '@system-design/model'

export interface BackpressureConfig {
  maxInFlight: number
  overflow: 'reject' | 'dead-letter'
}

export interface DeliveryDecision {
  accepted: boolean
  deadLettered: boolean
  status: EventStatus
  reason: ReasonCode
}

export class BackpressureGate {
  private inFlight = 0

  constructor(readonly config: BackpressureConfig) {
    if (!Number.isInteger(config.maxInFlight) || config.maxInFlight < 0) throw new Error('maxInFlight must be a non-negative integer.')
  }

  get active() { return this.inFlight }

  admit(): DeliveryDecision {
    if (this.inFlight < this.config.maxInFlight) {
      this.inFlight += 1
      return { accepted: true, deadLettered: false, status: 'ok', reason: 'none' }
    }
    return this.config.overflow === 'dead-letter'
      ? { accepted: false, deadLettered: true, status: 'rejected', reason: 'dead_lettered' }
      : { accepted: false, deadLettered: false, status: 'rejected', reason: 'backpressure' }
  }

  acknowledge() {
    if (this.inFlight <= 0) throw new Error('Cannot acknowledge when no delivery is in flight.')
    this.inFlight -= 1
  }
}

export class TokenBucket {
  private tokens: number
  private lastRefillMs = 0

  constructor(readonly config: { capacity: number; refillTokens: number; refillIntervalMs: number }) {
    if (!Number.isInteger(config.capacity) || config.capacity < 1) throw new Error('capacity must be a positive integer.')
    if (!Number.isInteger(config.refillTokens) || config.refillTokens < 1) throw new Error('refillTokens must be a positive integer.')
    if (!Number.isFinite(config.refillIntervalMs) || config.refillIntervalMs <= 0) throw new Error('refillIntervalMs must be positive.')
    this.tokens = config.capacity
  }

  admit(nowMs: number): boolean {
    if (!Number.isFinite(nowMs) || nowMs < this.lastRefillMs) throw new Error('Virtual time must be monotonic.')
    const intervals = Math.floor((nowMs - this.lastRefillMs) / this.config.refillIntervalMs)
    if (intervals > 0) {
      this.tokens = Math.min(this.config.capacity, this.tokens + intervals * this.config.refillTokens)
      this.lastRefillMs += intervals * this.config.refillIntervalMs
    }
    if (this.tokens < 1) return false
    this.tokens -= 1
    return true
  }

  get available() { return this.tokens }
}
