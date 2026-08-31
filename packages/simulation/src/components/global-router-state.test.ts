import { describe, expect, it } from 'vitest'
import { GlobalRouterState } from './global-router-state'

const config = { decisionTtlMs: 100, healthCheckIntervalMs: 10, unhealthyThreshold: 2, healthyThreshold: 2, failoverDelayMs: 30 }
const targets = [
  { edgeId: 'west', weight: 1, regionId: 'region-west' },
  { edgeId: 'east', weight: 3, regionId: 'region-east' },
]

describe('GlobalRouterState', () => {
  it('prefers explicit client region and caches the cohort decision until TTL', () => {
    const state = new GlobalRouterState(config)
    expect(state.select({ clientKey: 'west-client', clientRegionId: 'region-west', policy: 'geo', targets, nowMs: 0, random: () => 0.99 })).toMatchObject({ target: targets[0], cacheHit: false, geoMatched: true })
    expect(state.select({ clientKey: 'west-client', clientRegionId: 'region-east', policy: 'geo', targets, nowMs: 50, random: () => 0.99 })).toMatchObject({ target: targets[0], cacheHit: true })
    expect(state.select({ clientKey: 'west-client', clientRegionId: 'region-east', policy: 'geo', targets, nowMs: 100, random: () => 0.99 })).toMatchObject({ target: targets[1], cacheHit: false, cacheExpired: true, geoMatched: true })
    expect(state.snapshot(100)).toMatchObject({ decisions: 3, cacheHits: 1, cacheMisses: 2, cacheExpirations: 1, geoMatches: 2 })
  })

  it('uses weights deterministically when geo has no matching region', () => {
    const state = new GlobalRouterState(config)
    expect(state.select({ clientKey: 'a', clientRegionId: 'unknown', policy: 'geo', targets, nowMs: 0, random: () => 0.1 }).target?.edgeId).toBe('west')
    expect(state.select({ clientKey: 'b', clientRegionId: 'unknown', policy: 'geo', targets, nowMs: 1, random: () => 0.9 }).target?.edgeId).toBe('east')
  })

  it('keeps cached stale decisions through detection and propagation, then fails over on TTL', () => {
    const state = new GlobalRouterState(config)
    expect(state.select({ clientKey: 'client', policy: 'health-aware', targets, nowMs: 0, random: () => 0 }).target?.edgeId).toBe('west')
    expect(state.recordOutcome('west', false, 1)).toBeUndefined()
    expect(state.recordOutcome('west', false, 11)).toEqual({ type: 'target-unhealthy', edgeId: 'west', detectedAtMs: 11, effectiveAtMs: 41 })
    expect(state.select({ clientKey: 'client', policy: 'health-aware', targets, nowMs: 50, random: () => 0 }).target?.edgeId).toBe('west')
    const failedOver = state.select({ clientKey: 'client', policy: 'health-aware', targets, nowMs: 100, random: () => 0 })
    expect(failedOver).toMatchObject({ target: targets[1], previousEdgeId: 'west', cacheExpired: true, failoverDelayMs: 89 })
    expect(state.snapshot(100)).toMatchObject({ unhealthyTransitions: 1, currentlyUnhealthy: 1, failovers: 1, maxFailoverDelayMs: 89 })
  })

  it('recovers only after sampled healthy observations reach the threshold', () => {
    const state = new GlobalRouterState({ ...config, unhealthyThreshold: 1, failoverDelayMs: 0 })
    state.recordOutcome('west', false, 0)
    expect(state.probe('west', true, 5)).toBeUndefined()
    expect(state.probe('west', true, 10)).toBeUndefined()
    expect(state.probe('west', true, 20)).toEqual({ type: 'target-recovered', edgeId: 'west', recoveredAtMs: 20 })
    expect(state.snapshot(20)).toMatchObject({ recoveries: 1, currentlyUnhealthy: 0 })
  })
})
