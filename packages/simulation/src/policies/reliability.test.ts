import { describe, expect, it } from 'vitest'
import { CircuitBreaker, retryDelayMs } from './reliability'

describe('retry timing', () => {
  const config = { maxAttempts: 5, backoff: 'exponential' as const, baseDelayMs: 100, maxDelayMs: 250, jitterRatio: 0 }

  it('uses capped exponential backoff', () => {
    expect([2, 3, 4, 5].map((attempt) => retryDelayMs(config, attempt, () => 0.5))).toEqual([100, 200, 250, 250])
  })

  it('applies deterministic bounded jitter only when configured', () => {
    const jittered = { ...config, jitterRatio: 0.25 }
    expect(retryDelayMs(jittered, 2, () => 0)).toBe(75)
    expect(retryDelayMs(jittered, 2, () => 1)).toBe(125)
  })
})

describe('circuit breaker state machine', () => {
  it('opens, rejects, probes half-open, and closes after a successful probe', () => {
    const breaker = new CircuitBreaker({ failureThreshold: 2, openDurationMs: 1_000, halfOpenMaxProbes: 1 })
    const first = breaker.acquire(0)
    expect(first.allowed).toBe(true)
    expect(breaker.fail(first.permit!, 10)).toEqual({ state: 'closed' })
    const second = breaker.acquire(20)
    expect(breaker.fail(second.permit!, 30)).toEqual({ state: 'open', transition: 'opened' })
    expect(breaker.acquire(1_029)).toMatchObject({ allowed: false, state: 'open' })
    const probe = breaker.acquire(1_030)
    expect(probe).toMatchObject({ allowed: true, state: 'half-open', transition: 'half-opened' })
    expect(breaker.acquire(1_030)).toMatchObject({ allowed: false, state: 'half-open' })
    expect(breaker.succeed(probe.permit!)).toEqual({ state: 'closed', transition: 'closed' })
    expect(breaker.acquire(1_031)).toMatchObject({ allowed: true, state: 'closed' })
  })

  it('reopens for a full interval when a half-open probe fails', () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1, openDurationMs: 100, halfOpenMaxProbes: 1 })
    const initial = breaker.acquire(0)
    breaker.fail(initial.permit!, 0)
    const probe = breaker.acquire(100)
    expect(probe.transition).toBe('half-opened')
    expect(breaker.fail(probe.permit!, 105)).toEqual({ state: 'open', transition: 'opened' })
    expect(breaker.acquire(204).allowed).toBe(false)
    expect(breaker.acquire(205)).toMatchObject({ allowed: true, state: 'half-open' })
  })

  it('ignores stale completions from calls admitted before an open transition', () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1, openDurationMs: 100, halfOpenMaxProbes: 1 })
    const failed = breaker.acquire(0)
    const stale = breaker.acquire(0)
    breaker.fail(failed.permit!, 10)
    expect(breaker.succeed(stale.permit!)).toEqual({ state: 'open' })
    expect(breaker.state).toBe('open')
  })
})
