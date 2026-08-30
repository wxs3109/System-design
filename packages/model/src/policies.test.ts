import { describe, expect, it } from 'vitest'
import {
  backpressurePolicyConfigSchema,
  circuitBreakerPolicyConfigSchema,
  retryPolicyConfigSchema,
  timeoutPolicyConfigSchema,
  tokenBucketPolicyConfigSchema,
} from './policies'

describe('reliability policy config contracts', () => {
  it('supplies portable deterministic defaults', () => {
    expect(timeoutPolicyConfigSchema.parse({})).toEqual({ timeoutMs: 1_000 })
    expect(retryPolicyConfigSchema.parse({})).toEqual({ maxAttempts: 3, backoff: 'exponential', baseDelayMs: 50, maxDelayMs: 2_000, jitterRatio: 0 })
    expect(circuitBreakerPolicyConfigSchema.parse({})).toEqual({ failureThreshold: 5, openDurationMs: 10_000, halfOpenMaxProbes: 1 })
    expect(tokenBucketPolicyConfigSchema.parse({})).toEqual({ capacity: 100, refillTokens: 100, refillIntervalMs: 1_000 })
    expect(backpressurePolicyConfigSchema.parse({})).toEqual({ maxInFlight: 1_000, overflow: 'reject' })
  })

  it('rejects unbounded or internally inconsistent policies', () => {
    expect(retryPolicyConfigSchema.safeParse({ maxAttempts: 0 }).success).toBe(false)
    expect(retryPolicyConfigSchema.safeParse({ baseDelayMs: 200, maxDelayMs: 100 }).success).toBe(false)
    expect(tokenBucketPolicyConfigSchema.safeParse({ capacity: 0 }).success).toBe(false)
    expect(backpressurePolicyConfigSchema.safeParse({ maxInFlight: -1 }).success).toBe(false)
  })
})
