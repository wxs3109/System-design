import { describe, expect, it } from 'vitest'
import { createNode } from '@system-design/model'
import { getNodeBehavior, registeredBehaviorTypes } from './behavior'

describe('runtime component behavior registry', () => {
  it('provides behavior for every built-in component', () => {
    expect(registeredBehaviorTypes()).toEqual(['traffic', 'network', 'load-balancer', 'service', 'queue', 'database'])
    const service = createNode('service', 'service', { x: 0, y: 0 })
    expect(getNodeBehavior(service).capacity(service)).toBe(20)
  })
})
