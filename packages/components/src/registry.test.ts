import { z } from 'zod'
import { describe, expect, it } from 'vitest'
import { ComponentRegistry, PolicyRegistry, componentRegistry } from './index'

describe('component registry', () => {
  it('creates and describes all built-in nodes from manifests', () => {
    const service = componentRegistry.createNode('service', 'service-1', { x: 10, y: 20 })
    expect(service.componentVersion).toBe(1)
    expect(componentRegistry.describeNode(service)).toContain('concurrent')
    expect(componentRegistry.list()).toHaveLength(5)
  })

  it('adds a component without changing registry dispatch code', () => {
    const registry = new ComponentRegistry()
    registry.register({
      type: 'test-sink', version: 1, label: 'Test sink', description: 'Test-only terminal.', category: 'data', iconToken: 'test', color: '#000000',
      configSchema: z.object({ latencyMs: z.number().nonnegative() }), createDefaultConfig: () => ({ latencyMs: 5 }),
      configFields: [{ kind: 'number', key: 'latencyMs', label: 'Latency', min: 0 }],
      ports: [{ id: 'in', label: 'Input', direction: 'input', protocol: 'request' }], capabilities: ['sink'],
      emittedMetrics: ['latency'], supportedFaults: [], runtimeBehavior: 'test-sink-v1', describeConfig: (config) => `${config.latencyMs} ms`,
    })
    const node = registry.createNode('test-sink', 'sink', { x: 0, y: 0 })
    expect(node.config).toEqual({ latencyMs: 5 })
    expect(registry.describeNode(node)).toBe('5 ms')
  })

  it('rejects direct self-connections through registry semantics', () => {
    const service = componentRegistry.createNode('service', 'same', { x: 0, y: 0 })
    expect(componentRegistry.canConnect(service, service)).toMatchObject({ valid: false })
  })
})

describe('policy registry', () => {
  it('registers a typed policy independently from components', () => {
    const registry = new PolicyRegistry()
    registry.register({
      type: 'test-timeout', version: 1, label: 'Test timeout', description: 'Test-only policy.', targets: ['edge'],
      configSchema: z.object({ timeoutMs: z.number().positive() }), defaultConfig: { timeoutMs: 100 },
      configFields: [{ kind: 'number', key: 'timeoutMs', label: 'Timeout', min: 1 }], runtimeBehavior: 'test-timeout-v1',
    })
    expect(registry.get('test-timeout', 1).defaultConfig).toEqual({ timeoutMs: 100 })
  })
})
