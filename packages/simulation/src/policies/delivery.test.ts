import { describe, expect, it } from 'vitest'
import { BackpressureGate, TokenBucket } from './delivery'

describe('backpressure and dead-letter behavior', () => {
  it('bounds in-flight deliveries and accepts again after acknowledgement', () => {
    const gate = new BackpressureGate({ maxInFlight: 1, overflow: 'reject' })
    expect(gate.admit()).toMatchObject({ accepted: true })
    expect(gate.admit()).toMatchObject({ accepted: false, reason: 'backpressure' })
    gate.acknowledge()
    expect(gate.admit()).toMatchObject({ accepted: true })
  })

  it('routes overflow to a dead-letter outcome when configured', () => {
    const gate = new BackpressureGate({ maxInFlight: 0, overflow: 'dead-letter' })
    expect(gate.admit()).toEqual({ accepted: false, deadLettered: true, status: 'rejected', reason: 'dead_lettered' })
  })
})

describe('virtual-time token bucket', () => {
  it('refills on deterministic interval boundaries', () => {
    const bucket = new TokenBucket({ capacity: 2, refillTokens: 1, refillIntervalMs: 100 })
    expect([bucket.admit(0), bucket.admit(0), bucket.admit(99), bucket.admit(100), bucket.admit(100)]).toEqual([true, true, false, true, false])
    expect(bucket.admit(500)).toBe(true)
    expect(bucket.available).toBe(1)
  })
})
