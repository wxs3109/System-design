export interface TimeoutPolicyConfig {
  timeoutMs: number
}

export interface RetryPolicyConfig {
  maxAttempts: number
  backoff: 'fixed' | 'exponential'
  baseDelayMs: number
  maxDelayMs: number
  jitterRatio: number
}

export interface CircuitBreakerConfig {
  failureThreshold: number
  openDurationMs: number
  halfOpenMaxProbes: number
}

export type CircuitBreakerState = 'closed' | 'open' | 'half-open'
export type CircuitTransition = 'opened' | 'half-opened' | 'closed'

export interface CircuitPermit {
  readonly generation: number
  readonly state: 'closed' | 'half-open'
}

export interface ReliabilityAttempt {
  attempt: number
  spanId: string
  parentSpanId: string
  edgeId: string
  startedAtMs: number
  deadlineMs?: number
  circuitPermit?: CircuitPermit
}

export interface ReliabilityCall {
  callerNodeId: string
  callerSpanId: string
  callerRequest: {
    hops: number
    spanId: string
    parentSpanId?: string
    incomingEdgeId?: string
    incomingRoutingMode?: import('@system-design/model').RoutingMode
    dependencyStartedAtMs?: number
    loadBalancerNodeId?: string
    resumeNodeId?: string
    resumeOutgoingPort?: string
    resumeRequestSpanId?: string
  }
  edgeId: string
  attempt: number
  maxAttempts: number
  retry?: RetryPolicyConfig
  timeout?: TimeoutPolicyConfig
}

export interface CircuitAcquireResult {
  allowed: boolean
  state: CircuitBreakerState
  permit?: CircuitPermit
  transition?: CircuitTransition
}

export interface CircuitCompletionResult {
  state: CircuitBreakerState
  transition?: CircuitTransition
}

const finiteNonNegative = (value: number, name: string) => {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a finite non-negative number.`)
}

export const validateTimeoutPolicy = (config: TimeoutPolicyConfig): TimeoutPolicyConfig => {
  if (!Number.isFinite(config.timeoutMs) || config.timeoutMs <= 0) throw new Error('timeoutMs must be a finite positive number.')
  return config
}

export const validateRetryPolicy = (config: RetryPolicyConfig): RetryPolicyConfig => {
  if (!Number.isInteger(config.maxAttempts) || config.maxAttempts < 1) throw new Error('maxAttempts must be a positive integer.')
  finiteNonNegative(config.baseDelayMs, 'baseDelayMs')
  finiteNonNegative(config.maxDelayMs, 'maxDelayMs')
  if (config.maxDelayMs < config.baseDelayMs) throw new Error('maxDelayMs must be greater than or equal to baseDelayMs.')
  if (!Number.isFinite(config.jitterRatio) || config.jitterRatio < 0 || config.jitterRatio > 1) throw new Error('jitterRatio must be between 0 and 1.')
  return config
}

export const retryDelayMs = (config: RetryPolicyConfig, nextAttempt: number, random: () => number): number => {
  validateRetryPolicy(config)
  if (!Number.isInteger(nextAttempt) || nextAttempt < 2) throw new Error('nextAttempt must be an integer greater than or equal to 2.')
  const delay = config.backoff === 'fixed' ? config.baseDelayMs : config.baseDelayMs * 2 ** (nextAttempt - 2)
  const capped = Math.min(delay, config.maxDelayMs)
  if (config.jitterRatio === 0 || capped === 0) return capped
  const jitter = (random() * 2 - 1) * config.jitterRatio
  return Math.max(0, capped * (1 + jitter))
}

export class CircuitBreaker {
  private currentState: CircuitBreakerState = 'closed'
  private generation = 0
  private consecutiveFailures = 0
  private openUntilMs = 0
  private halfOpenInFlight = 0

  constructor(readonly config: CircuitBreakerConfig) {
    if (!Number.isInteger(config.failureThreshold) || config.failureThreshold < 1) throw new Error('failureThreshold must be a positive integer.')
    finiteNonNegative(config.openDurationMs, 'openDurationMs')
    if (!Number.isInteger(config.halfOpenMaxProbes) || config.halfOpenMaxProbes < 1) throw new Error('halfOpenMaxProbes must be a positive integer.')
  }

  get state(): CircuitBreakerState { return this.currentState }

  acquire(nowMs: number): CircuitAcquireResult {
    finiteNonNegative(nowMs, 'nowMs')
    let transition: CircuitTransition | undefined
    if (this.currentState === 'open' && nowMs >= this.openUntilMs) {
      this.currentState = 'half-open'
      this.generation += 1
      this.halfOpenInFlight = 0
      transition = 'half-opened'
    }
    if (this.currentState === 'open' || (this.currentState === 'half-open' && this.halfOpenInFlight >= this.config.halfOpenMaxProbes)) {
      return { allowed: false, state: this.currentState, ...(transition === undefined ? {} : { transition }) }
    }
    if (this.currentState === 'half-open') this.halfOpenInFlight += 1
    return {
      allowed: true,
      state: this.currentState,
      permit: { generation: this.generation, state: this.currentState },
      ...(transition === undefined ? {} : { transition }),
    }
  }

  succeed(permit: CircuitPermit): CircuitCompletionResult {
    if (permit.generation !== this.generation) return { state: this.currentState }
    if (permit.state === 'half-open') {
      this.halfOpenInFlight = Math.max(0, this.halfOpenInFlight - 1)
      this.currentState = 'closed'
      this.generation += 1
      this.consecutiveFailures = 0
      return { state: this.currentState, transition: 'closed' }
    }
    this.consecutiveFailures = 0
    return { state: this.currentState }
  }

  fail(permit: CircuitPermit, nowMs: number): CircuitCompletionResult {
    finiteNonNegative(nowMs, 'nowMs')
    if (permit.generation !== this.generation) return { state: this.currentState }
    if (permit.state === 'half-open') this.halfOpenInFlight = Math.max(0, this.halfOpenInFlight - 1)
    else this.consecutiveFailures += 1
    if (permit.state === 'half-open' || this.consecutiveFailures >= this.config.failureThreshold) {
      this.currentState = 'open'
      this.generation += 1
      this.openUntilMs = nowMs + this.config.openDurationMs
      this.halfOpenInFlight = 0
      return { state: this.currentState, transition: 'opened' }
    }
    return { state: this.currentState }
  }
}
