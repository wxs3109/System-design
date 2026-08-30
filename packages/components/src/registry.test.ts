import { z } from 'zod'
import { describe, expect, it } from 'vitest'
import { ComponentRegistry, PolicyRegistry, componentRegistry, policyRegistry } from './index'

describe('component registry', () => {
  it('creates and describes all built-in nodes from manifests', () => {
    const service = componentRegistry.createNode('service', 'service-1', { x: 10, y: 20 })
    expect(service.componentVersion).toBe(1)
    expect(componentRegistry.describeNode(service)).toContain('concurrent')
    expect(componentRegistry.list()).toHaveLength(6)
  })

  it('declares an editable Load Balancer manifest', () => {
    const loadBalancer = componentRegistry.createNode('load-balancer', 'lb', { x: 0, y: 0 })
    const manifest = componentRegistry.get('load-balancer')
    expect(loadBalancer.config).toMatchObject({ algorithm: 'weighted', failureThreshold: 1 })
    expect(manifest.configFields.find((field) => field.key === 'algorithm')).toMatchObject({ kind: 'select' })
    expect(manifest.capabilities).toContain('health-aware-routing')
  })

  it('adds a component without changing registry dispatch code', () => {
    const registry = new ComponentRegistry()
    registry.register({
      type: 'test-sink', version: 1, label: 'Test sink', description: 'Test-only terminal.', category: 'data', iconToken: 'test', color: '#000000',
      configSchema: z.object({ latencyMs: z.number().nonnegative() }), createDefaultConfig: () => ({ latencyMs: 5 }),
      configFields: [{ kind: 'number', key: 'latencyMs', label: 'Latency', min: 0 }],
      ports: [{ id: 'in', label: 'Input', direction: 'input', semantic: 'request' }], capabilities: ['sink'],
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

  it('resolves selected typed ports and accepts publish to consume only', () => {
    const producer = componentRegistry.createNode('service', 'producer', { x: 0, y: 0 })
    const consumer = componentRegistry.createNode('queue', 'consumer', { x: 100, y: 0 })
    expect(componentRegistry.canConnect(producer, consumer, 'publish', 'consume')).toMatchObject({ valid: true, sourceSemantic: 'publish', targetSemantic: 'consume' })
    expect(componentRegistry.canConnect(producer, consumer, 'publish', 'in')).toMatchObject({ valid: false })
    expect(componentRegistry.canConnect(producer, consumer, 'missing', 'consume')).toMatchObject({ valid: false })
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

  it('registers all Phase 1 reliability policies with manifest-driven fields', () => {
    expect(policyRegistry.list().map((policy) => policy.type)).toEqual(['timeout', 'retry', 'circuit-breaker', 'rate-limit', 'backpressure'])
    expect(policyRegistry.get('retry', 1).configFields.map((field) => field.key)).toContain('maxAttempts')
    expect(policyRegistry.get('rate-limit', 1).targets).toEqual(['node'])
  })

  it('validates target applicability, configuration and explicit ordering', () => {
    const timeout = { id: 'timeout', type: 'timeout', version: 1, target: { kind: 'edge' as const, id: 'edge' }, order: 1, enabled: true, config: { timeoutMs: 250 } }
    const retry = { id: 'retry', type: 'retry', version: 1, target: { kind: 'edge' as const, id: 'edge' }, order: 0, enabled: true, config: { maxAttempts: 2 } }
    expect(policyRegistry.validateOrder([timeout, retry]).map((policy) => policy.id)).toEqual(['retry', 'timeout'])
    expect(policyRegistry.validateAttachment(retry).config).toMatchObject({ maxAttempts: 2, backoff: 'exponential' })
    expect(() => policyRegistry.validateAttachment({ ...timeout, target: { kind: 'node', id: 'node' } })).toThrow('cannot target node')
    expect(() => policyRegistry.validateAttachment({ ...retry, config: { maxAttempts: 0 } })).toThrow()
    expect(() => policyRegistry.validateOrder([timeout, { ...retry, order: 1 }])).toThrow('order 1 is duplicated')
  })

  it('rejects duplicate singleton attachments on a target', () => {
    const first = { id: 'one', type: 'timeout', version: 1, target: { kind: 'edge' as const, id: 'edge' }, order: 0, enabled: true, config: { timeoutMs: 100 } }
    expect(() => policyRegistry.validateOrder([first, { ...first, id: 'two', order: 1 }])).toThrow('only be attached once')
  })
})
