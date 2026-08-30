import { describe, expect, it } from 'vitest'
import { createNode } from '@system-design/model'
import { getNodeBehavior, registeredBehaviorTypes } from './behavior'

describe('runtime component behavior registry', () => {
  it('provides behavior for every built-in component', () => {
    expect(registeredBehaviorTypes()).toEqual(['traffic', 'scheduler', 'network', 'load-balancer', 'service', 'queue', 'cache', 'cdn', 'stream', 'object-storage', 'database'])
    const service = createNode('service', 'service', { x: 0, y: 0 })
    expect(getNodeBehavior(service).capacity(service)).toBe(20)
    const legacyDatabase = createNode('database', 'legacy-database', { x: 0, y: 0 })
    expect(getNodeBehavior(legacyDatabase).capacity(legacyDatabase)).toBe(100)
  })

  it('charges CDN misses for origin transfer while hits stay at edge cost', () => {
    const cdn = createNode('cdn', 'cdn', { x: 0, y: 0 })
    if (cdn.type !== 'cdn') throw new Error('Expected CDN')
    cdn.config.lookupTimeMs = 1
    cdn.config.edgeLatencyMs = 10
    cdn.config.edgeBandwidthMbps = 100
    cdn.config.originRoundTripMs = 80
    cdn.config.originBandwidthMbps = 50
    const behavior = getNodeBehavior(cdn)
    expect(behavior.baseServiceTimeMs(cdn, { bytes: 1_000, cdnOutcome: 'miss' })).toBeGreaterThan(behavior.baseServiceTimeMs(cdn, { bytes: 1_000, cdnOutcome: 'hit' }))
  })
})
