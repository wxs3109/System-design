export type GlobalRoutingPolicy = 'geo' | 'weighted' | 'health-aware'

export interface GlobalRouterStateConfig {
  decisionTtlMs: number
  healthCheckIntervalMs: number
  unhealthyThreshold: number
  healthyThreshold: number
  failoverDelayMs: number
}

export interface GlobalRouteTarget {
  edgeId: string
  weight: number
  regionId?: string
}

export type GlobalRouterHealthTransition =
  | { type: 'target-unhealthy'; edgeId: string; detectedAtMs: number; effectiveAtMs: number }
  | { type: 'target-recovered'; edgeId: string; recoveredAtMs: number }

export interface GlobalRouteDecision {
  target?: GlobalRouteTarget
  cacheHit: boolean
  cacheExpired: boolean
  geoMatched: boolean
  previousEdgeId?: string
  failoverDelayMs?: number
}

interface CachedDecision {
  edgeId: string
  expiresAtMs: number
}

interface TargetHealth {
  consecutiveFailures: number
  consecutiveSuccesses: number
  lastObservationAtMs: number
  unhealthyDetectedAtMs?: number
  unhealthyEffectiveAtMs?: number
}

const positiveInteger = (value: number, label: string) => {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} must be a positive integer.`)
}

const finitePositive = (value: number, label: string) => {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be positive.`)
}

const finiteNonNegative = (value: number, label: string) => {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be non-negative.`)
}

/**
 * Deterministic control-plane state for a global routing boundary. Cached
 * client decisions deliberately remain usable until their TTL expires, even
 * after a target has become unhealthy, approximating DNS/edge decision caches.
 */
export class GlobalRouterState {
  private readonly cache = new Map<string, CachedDecision>()
  private readonly health = new Map<string, TargetHealth>()
  private readonly selections = new Map<string, number>()
  private lastTimeMs = 0
  private decisions = 0
  private cacheHits = 0
  private cacheMisses = 0
  private cacheExpirations = 0
  private geoMatches = 0
  private failedOutcomes = 0
  private unhealthyTransitions = 0
  private recoveries = 0
  private failovers = 0
  private cumulativeFailoverDelayMs = 0
  private maxFailoverDelayMs = 0

  constructor(readonly config: GlobalRouterStateConfig) {
    finitePositive(config.decisionTtlMs, 'decisionTtlMs')
    finitePositive(config.healthCheckIntervalMs, 'healthCheckIntervalMs')
    positiveInteger(config.unhealthyThreshold, 'unhealthyThreshold')
    positiveInteger(config.healthyThreshold, 'healthyThreshold')
    finiteNonNegative(config.failoverDelayMs, 'failoverDelayMs')
  }

  select(input: {
    clientKey: string
    clientRegionId?: string
    policy: GlobalRoutingPolicy
    targets: readonly GlobalRouteTarget[]
    nowMs: number
    random: () => number
  }): GlobalRouteDecision {
    this.advance(input.nowMs)
    if (input.clientKey.trim().length === 0) throw new Error('clientKey must not be empty.')
    this.validateTargets(input.targets)
    this.decisions += 1
    for (const target of input.targets) this.ensureHealth(target.edgeId)
    const targets = new Map(input.targets.map((target) => [target.edgeId, target]))
    const cached = this.cache.get(input.clientKey)
    if (cached && cached.expiresAtMs > input.nowMs && targets.has(cached.edgeId)) {
      const target = targets.get(cached.edgeId)!
      this.cacheHits += 1
      this.recordSelection(target.edgeId)
      const geoMatched = input.policy === 'geo' && input.clientRegionId !== undefined && target.regionId === input.clientRegionId
      if (geoMatched) this.geoMatches += 1
      return { target, cacheHit: true, cacheExpired: false, geoMatched }
    }

    let cacheExpired = false
    let previousEdgeId: string | undefined
    if (cached) {
      previousEdgeId = cached.edgeId
      cacheExpired = cached.expiresAtMs <= input.nowMs
      if (cacheExpired) this.cacheExpirations += 1
      this.cache.delete(input.clientKey)
    }
    this.cacheMisses += 1

    const eligible = input.policy === 'health-aware'
      ? input.targets.filter((target) => !this.isEffectivelyUnhealthy(target.edgeId, input.nowMs))
      : [...input.targets]
    let candidates = eligible
    let geoMatched = false
    if (input.policy === 'geo' && input.clientRegionId !== undefined) {
      const regional = eligible.filter((target) => target.regionId === input.clientRegionId)
      if (regional.length > 0) { candidates = regional; geoMatched = true }
    }
    const target = this.weightedTarget(candidates, input.random)
    if (!target) return { cacheHit: false, cacheExpired, geoMatched: false, ...(previousEdgeId === undefined ? {} : { previousEdgeId }) }

    this.cache.set(input.clientKey, { edgeId: target.edgeId, expiresAtMs: input.nowMs + this.config.decisionTtlMs })
    this.recordSelection(target.edgeId)
    if (geoMatched) this.geoMatches += 1
    let failoverDelayMs: number | undefined
    if (input.policy === 'health-aware' && previousEdgeId && previousEdgeId !== target.edgeId) {
      const previous = this.health.get(previousEdgeId)
      if (previous?.unhealthyDetectedAtMs !== undefined && this.isEffectivelyUnhealthy(previousEdgeId, input.nowMs)) {
        failoverDelayMs = Math.max(0, input.nowMs - previous.unhealthyDetectedAtMs)
        this.failovers += 1
        this.cumulativeFailoverDelayMs += failoverDelayMs
        this.maxFailoverDelayMs = Math.max(this.maxFailoverDelayMs, failoverDelayMs)
      }
    }
    return {
      target, cacheHit: false, cacheExpired, geoMatched,
      ...(previousEdgeId === undefined ? {} : { previousEdgeId }),
      ...(failoverDelayMs === undefined ? {} : { failoverDelayMs }),
    }
  }

  /** Records a routed request result and samples it at the configured interval. */
  recordOutcome(edgeId: string, success: boolean, nowMs: number): GlobalRouterHealthTransition | undefined {
    if (!success) this.failedOutcomes += 1
    return this.observe(edgeId, success, nowMs)
  }

  /** Samples an explicit target health probe without counting it as a request failure. */
  probe(edgeId: string, success: boolean, nowMs: number): GlobalRouterHealthTransition | undefined {
    return this.observe(edgeId, success, nowMs)
  }

  needsRecoveryProbe(edgeId: string) {
    return this.ensureHealth(edgeId).unhealthyDetectedAtMs !== undefined
  }

  snapshot(nowMs: number) {
    this.advance(nowMs)
    return {
      decisions: this.decisions, cacheHits: this.cacheHits, cacheMisses: this.cacheMisses, cacheExpirations: this.cacheExpirations,
      cacheHitRate: this.decisions === 0 ? 0 : this.cacheHits / this.decisions, cachedDecisions: [...this.cache.values()].filter((decision) => decision.expiresAtMs > nowMs).length, geoMatches: this.geoMatches,
      failedOutcomes: this.failedOutcomes, unhealthyTransitions: this.unhealthyTransitions, recoveries: this.recoveries, failovers: this.failovers,
      cumulativeFailoverDelayMs: this.cumulativeFailoverDelayMs, maxFailoverDelayMs: this.maxFailoverDelayMs,
      currentlyUnhealthy: [...this.health.keys()].filter((edgeId) => this.isEffectivelyUnhealthy(edgeId, nowMs)).length,
      selectionsByTarget: Object.fromEntries([...this.selections].sort(([left], [right]) => left.localeCompare(right))),
    }
  }

  private observe(edgeId: string, success: boolean, nowMs: number): GlobalRouterHealthTransition | undefined {
    this.advance(nowMs)
    if (edgeId.trim().length === 0) throw new Error('edgeId must not be empty.')
    const state = this.ensureHealth(edgeId)
    if (nowMs < state.lastObservationAtMs + this.config.healthCheckIntervalMs) return undefined
    state.lastObservationAtMs = nowMs
    if (!success) {
      state.consecutiveFailures += 1
      state.consecutiveSuccesses = 0
      if (state.unhealthyDetectedAtMs === undefined && state.consecutiveFailures >= this.config.unhealthyThreshold) {
        state.unhealthyDetectedAtMs = nowMs
        state.unhealthyEffectiveAtMs = nowMs + this.config.failoverDelayMs
        state.consecutiveFailures = 0
        this.unhealthyTransitions += 1
        return { type: 'target-unhealthy', edgeId, detectedAtMs: nowMs, effectiveAtMs: state.unhealthyEffectiveAtMs }
      }
      return undefined
    }

    state.consecutiveFailures = 0
    if (state.unhealthyDetectedAtMs === undefined) {
      state.consecutiveSuccesses = 0
      return undefined
    }
    state.consecutiveSuccesses += 1
    if (state.consecutiveSuccesses < this.config.healthyThreshold) return undefined
    delete state.unhealthyDetectedAtMs
    delete state.unhealthyEffectiveAtMs
    state.consecutiveSuccesses = 0
    this.recoveries += 1
    return { type: 'target-recovered', edgeId, recoveredAtMs: nowMs }
  }

  private isEffectivelyUnhealthy(edgeId: string, nowMs: number) {
    const effectiveAtMs = this.health.get(edgeId)?.unhealthyEffectiveAtMs
    return effectiveAtMs !== undefined && effectiveAtMs <= nowMs
  }

  private ensureHealth(edgeId: string) {
    let state = this.health.get(edgeId)
    if (!state) {
      state = { consecutiveFailures: 0, consecutiveSuccesses: 0, lastObservationAtMs: Number.NEGATIVE_INFINITY }
      this.health.set(edgeId, state)
    }
    return state
  }

  private weightedTarget(targets: readonly GlobalRouteTarget[], random: () => number) {
    if (targets.length === 0) return undefined
    if (targets.length === 1) return targets[0]
    const sample = random()
    if (!Number.isFinite(sample) || sample < 0 || sample > 1) throw new Error('Routing random sample must be between 0 and 1.')
    const total = targets.reduce((sum, target) => sum + target.weight, 0)
    let choice = Math.min(sample, 1 - Number.EPSILON) * total
    for (const target of targets) { choice -= target.weight; if (choice <= 0) return target }
    return targets.at(-1)
  }

  private validateTargets(targets: readonly GlobalRouteTarget[]) {
    const ids = new Set<string>()
    for (const target of targets) {
      if (target.edgeId.trim().length === 0) throw new Error('Target edgeId must not be empty.')
      if (ids.has(target.edgeId)) throw new Error(`Duplicate global route target: ${target.edgeId}.`)
      ids.add(target.edgeId)
      finitePositive(target.weight, `Target ${target.edgeId} weight`)
    }
  }

  private recordSelection(edgeId: string) {
    this.selections.set(edgeId, (this.selections.get(edgeId) ?? 0) + 1)
  }

  private advance(nowMs: number) {
    if (!Number.isFinite(nowMs) || nowMs < this.lastTimeMs) throw new Error('Virtual time must be finite and monotonic.')
    this.lastTimeMs = nowMs
  }
}
