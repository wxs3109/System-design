import { z } from 'zod'

const millisecondsSchema = z.number().finite().nonnegative().max(3_600_000)
const positiveMillisecondsSchema = z.number().finite().positive().max(3_600_000)
const boundedCountSchema = z.number().int().positive().max(1_000_000)

export const timeoutPolicyConfigSchema = z.object({
  timeoutMs: positiveMillisecondsSchema.default(1_000),
}).strict()

export const retryBackoffSchema = z.enum(['fixed', 'exponential'])

export const retryPolicyConfigSchema = z.object({
  maxAttempts: z.number().int().min(1).max(100).default(3),
  backoff: retryBackoffSchema.default('exponential'),
  baseDelayMs: millisecondsSchema.default(50),
  maxDelayMs: millisecondsSchema.default(2_000),
  jitterRatio: z.number().finite().min(0).max(1).default(0),
}).strict().superRefine((config, context) => {
  if (config.maxDelayMs < config.baseDelayMs) {
    context.addIssue({ code: 'custom', path: ['maxDelayMs'], message: 'Maximum retry delay must be greater than or equal to the base delay.' })
  }
})

export const circuitBreakerPolicyConfigSchema = z.object({
  failureThreshold: z.number().int().min(1).max(100_000).default(5),
  openDurationMs: positiveMillisecondsSchema.default(10_000),
  halfOpenMaxProbes: z.number().int().min(1).max(1_000).default(1),
}).strict()

export const tokenBucketPolicyConfigSchema = z.object({
  capacity: boundedCountSchema.default(100),
  refillTokens: boundedCountSchema.default(100),
  refillIntervalMs: positiveMillisecondsSchema.default(1_000),
}).strict()

export const backpressureOverflowSchema = z.enum(['reject', 'dead-letter'])

export const backpressurePolicyConfigSchema = z.object({
  maxInFlight: z.number().int().min(0).max(1_000_000).default(1_000),
  overflow: backpressureOverflowSchema.default('reject'),
}).strict()

export const builtInPolicyTypeSchema = z.enum([
  'timeout',
  'retry',
  'circuit-breaker',
  'rate-limit',
  'backpressure',
])

export type TimeoutPolicyConfig = z.infer<typeof timeoutPolicyConfigSchema>
export type RetryBackoff = z.infer<typeof retryBackoffSchema>
export type RetryPolicyConfig = z.infer<typeof retryPolicyConfigSchema>
export type CircuitBreakerPolicyConfig = z.infer<typeof circuitBreakerPolicyConfigSchema>
export type TokenBucketPolicyConfig = z.infer<typeof tokenBucketPolicyConfigSchema>
export type BackpressureOverflow = z.infer<typeof backpressureOverflowSchema>
export type BackpressurePolicyConfig = z.infer<typeof backpressurePolicyConfigSchema>
export type BuiltInPolicyType = z.infer<typeof builtInPolicyTypeSchema>
