import { z } from 'zod'
import { describe, expect, it } from 'vitest'
import { ComponentCatalog, ComponentCategoryRegistry, ComponentPresetRegistry, ComponentRegistry, PolicyRegistry, componentCatalog, componentCategoryRegistry, componentPresetRegistry, componentRegistry, policyRegistry, rolePresetRegistry } from './index'

describe('component registry', () => {
  it('creates and describes all built-in nodes from manifests', () => {
    const service = componentRegistry.createNode('service', 'service-1', { x: 10, y: 20 })
    expect(service.componentVersion).toBe(1)
    expect(componentRegistry.describeNode(service)).toContain('concurrent')
    expect(componentRegistry.list().map((manifest) => manifest.type)).toEqual([
      'traffic', 'scheduler', 'network', 'load-balancer', 'service', 'queue', 'cache', 'cdn', 'stream', 'object-storage', 'database',
    ])
  })

  it('declares Scheduler as an executable periodic source rather than a preset', () => {
    const scheduler = componentRegistry.createNode('scheduler', 'scheduler', { x: 0, y: 0 })
    const manifest = componentRegistry.get('scheduler')
    expect(scheduler.config).toMatchObject({ intervalMs: 1_000, batchSize: 1, missedRunPolicy: 'skip', concurrencyLimit: 1 })
    expect(manifest.ports).toEqual([expect.objectContaining({ direction: 'output', semantic: 'request' })])
    expect(manifest.capabilities).toEqual(expect.arrayContaining(['scheduling', 'batch-release', 'missed-run-policy']))
    expect(componentCatalog.listPresets('scheduler')).toEqual([])
    expect(manifest.supportedFaults).toEqual([])
    expect(manifest.supportedNodePolicies).toEqual([])
    expect(() => manifest.configSchema.parse({ ...scheduler.config, jitterMs: 1_001 })).toThrow('jitter')
  })

  it('rejects imported faults and node policies that a variant does not execute', () => {
    const scheduler = componentRegistry.createNode('scheduler', 'scheduler', { x: 0, y: 0 })
    const project = {
      schemaVersion: 2 as const, id: 'unsupported-semantics', name: 'Unsupported semantics', activeExperimentId: 'experiment',
      topology: { nodes: [scheduler], edges: [], groups: [], policies: [] as import('@system-design/model').PolicyAttachment[] },
      experiments: [{ id: 'experiment', name: 'Experiment', workloads: [], faults: [] as import('@system-design/model').Fault[], simulation: { durationSeconds: 1, sampleIntervalMs: 100, maxRequests: 10, traceLimit: 10, maxHops: 10 }, seed: 'seed' }],
    }
    project.topology.policies.push({ id: 'limit', type: 'rate-limit', version: 1, target: { kind: 'node', id: 'scheduler' }, order: 0, enabled: true, config: { capacity: 1, refillTokens: 1, refillIntervalMs: 1_000 } })
    expect(() => componentRegistry.validateProject(project)).toThrow('Scheduler does not support rate-limit@1 as a node policy')
    project.topology.policies = []
    project.experiments[0]!.faults.push({ id: 'down', type: 'node-down', target: { kind: 'node', id: 'scheduler' }, startAtSeconds: 0, durationSeconds: 1, enabled: true })
    expect(() => componentRegistry.validateProject(project)).toThrow('Scheduler does not support node-down faults')
  })

  it('declares an editable Load Balancer manifest', () => {
    const loadBalancer = componentRegistry.createNode('load-balancer', 'lb', { x: 0, y: 0 })
    const manifest = componentRegistry.get('load-balancer')
    expect(loadBalancer.config).toMatchObject({ algorithm: 'weighted', failureThreshold: 1 })
    expect(manifest.configFields.find((field) => field.key === 'algorithm')).toMatchObject({ kind: 'select' })
    expect(manifest.capabilities).toContain('health-aware-routing')
  })

  it('registers Phase 1 data components and defaults Database to v2', () => {
    expect(componentRegistry.createNode('cache', 'cache', { x: 0, y: 0 }).config).toMatchObject({ evictionPolicy: 'lru', ttlMs: 60_000 })
    expect(componentRegistry.createNode('stream', 'stream', { x: 0, y: 0 }).config).toMatchObject({ partitions: 12, consumerGroups: 1 })
    expect(componentRegistry.createNode('object-storage', 'objects', { x: 0, y: 0 }).config).toMatchObject({ readRatio: 0.8 })
    const database = componentRegistry.createNode('database', 'database', { x: 0, y: 0 })
    expect(database.componentVersion).toBe(2)
    expect(database.config).toMatchObject({ shardCount: 1, replicasPerShard: 0, readPreference: 'primary' })
    expect(componentRegistry.get('database', 1).runtimeBehavior).toBe('database-v1')
  })

  it('declares CDN as a Cache-category executable variant instead of a preset', () => {
    const cdn = componentRegistry.createNode('cdn', 'cdn', { x: 0, y: 0 })
    const manifest = componentRegistry.get('cdn')
    expect(cdn.config).toMatchObject({ popCount: 4, popSelection: 'consistent-hash', capacityEntriesPerPop: 10_000 })
    expect(manifest.category).toBe('cache')
    expect(manifest.ports.map((port) => port.id)).toEqual(['in', 'hit', 'miss'])
    expect(manifest.capabilities).toEqual(expect.arrayContaining(['pop-selection', 'origin-fetch', 'byte-throughput']))
    expect(componentCatalog.listPresets('cdn')).toEqual([])
  })

  it('advertises executable network fault modes', () => {
    expect(componentRegistry.get('network').supportedFaults).toEqual(expect.arrayContaining(['bandwidth-drop', 'packet-loss', 'region-outage']))
  })

  it('rejects unknown component versions and invalid configs before rendering', () => {
    const project = {
      schemaVersion: 2 as const, id: 'project', name: 'Project', activeExperimentId: 'experiment',
      topology: { nodes: [componentRegistry.createNode('cache', 'cache', { x: 0, y: 0 })], edges: [], groups: [], policies: [] },
      experiments: [{ id: 'experiment', name: 'Experiment', workloads: [], faults: [], simulation: { durationSeconds: 1, sampleIntervalMs: 100, maxRequests: 10, traceLimit: 10, maxHops: 10 }, seed: 'seed' }],
    }
    expect(() => componentRegistry.validateProject({ ...project, topology: { ...project.topology, nodes: [{ ...project.topology.nodes[0]!, componentVersion: 999 }] } })).toThrow('Unknown component')
    expect(() => componentRegistry.validateProject({ ...project, topology: { ...project.topology, nodes: [{ ...project.topology.nodes[0]!, config: { capacityEntries: 0 } }] } })).toThrow()
  })

  it('adds a component without changing registry dispatch code', () => {
    const registry = new ComponentRegistry()
    registry.register({
      type: 'test-sink', version: 1, label: 'Test sink', description: 'Test-only terminal.', category: 'database', iconToken: 'test', color: '#000000',
      configSchema: z.object({ latencyMs: z.number().nonnegative() }), createDefaultConfig: () => ({ latencyMs: 5 }),
      configFields: [{ kind: 'number', key: 'latencyMs', label: 'Latency', min: 0 }],
      ports: [{ id: 'in', label: 'Input', direction: 'input', semantic: 'request' }], capabilities: ['sink'],
      emittedMetrics: ['latency'], supportedFaults: [], supportedNodePolicies: [], runtimeBehavior: 'test-sink-v1', describeConfig: (config) => `${config.latencyMs} ms`,
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

describe('role preset registry', () => {
  it('resolves every built-in preset to an executable base behavior', () => {
    const nodes = componentPresetRegistry.list().filter((preset) => preset.availability !== 'legacy')
      .map((preset) => componentPresetRegistry.createNode(preset.id, preset.version, `${preset.id}-node`, { x: 0, y: 0 }))
    expect(nodes.map((node) => node.rolePreset?.id)).toEqual(['client', 'worker'])
    expect(nodes.map((node) => node.type)).toEqual(['traffic', 'service'])
    for (const node of nodes) expect(() => componentRegistry.validateNode(node)).not.toThrow()
    expect(() => componentPresetRegistry.createNode('sql-store', 1, 'new-sql', { x: 0, y: 0 })).toThrow('cannot create new components')
  })

  it('rejects duplicate IDs, invalid overrides, unknown versions, and mismatched references', () => {
    const components = new ComponentRegistry(componentRegistry.list())
    const registry = new ComponentPresetRegistry(components)
    const preset = { id: 'test-worker', version: 1, label: 'Test worker', description: 'Test preset.', iconToken: 'server', behavior: { type: 'service', version: 1 }, configOverrides: { replicas: 2 } }
    registry.register(preset)
    expect(() => registry.register(preset)).toThrow('already registered')
    expect(() => registry.register({ ...preset, id: 'invalid', configOverrides: { replicas: 0 } })).toThrow()
    expect(() => registry.get('test-worker', 2)).toThrow('Unknown role preset')
    const node = registry.createNode('test-worker', 1, 'worker', { x: 0, y: 0 })
    expect(() => registry.validateReference({ ...node, type: 'queue' })).toThrow('requires service@1')
    expect(registry.validateReference({ ...node, rolePreset: { id: 'removed-preset', version: 1 } })).toMatchObject({ type: 'service' })
    expect(() => registry.validateReference({ ...node, rolePreset: { id: 'removed-preset', version: 1 } }, true)).toThrow('Unknown role preset')
  })

  it('round-trips preset identity while preserving resolved execution without the preset catalog', () => {
    const worker = rolePresetRegistry.createNode('worker', 1, 'worker', { x: 10, y: 20 })
    const project = {
      schemaVersion: 2 as const, id: 'preset-project', name: 'Preset project', activeExperimentId: 'experiment',
      topology: { nodes: [worker], edges: [], groups: [], policies: [] },
      experiments: [{ id: 'experiment', name: 'Experiment', workloads: [], faults: [], simulation: { durationSeconds: 1, sampleIntervalMs: 100, maxRequests: 10, traceLimit: 10, maxHops: 10 }, seed: 'seed' }],
    }
    const roundTripped = JSON.parse(JSON.stringify(project))
    expect(componentRegistry.validateProject(roundTripped, rolePresetRegistry).topology.nodes[0]).toEqual(worker)
    expect(componentRegistry.validateProject(roundTripped).topology.nodes[0]).toEqual(worker)
  })
})

describe('component creation hierarchy', () => {
  it('lists palette categories before executable variants and nested presets', () => {
    expect(componentCatalog.listCategories().map((category) => category.id)).toEqual([
      'traffic', 'automation', 'network', 'gateway', 'service', 'cache', 'database', 'object-storage', 'messaging',
    ])
    expect(componentCatalog.listVariants('database').map((variant) => variant.type)).toEqual(['database'])
    expect(componentCatalog.listVariants('automation').map((variant) => variant.type)).toEqual(['scheduler'])
    expect(componentCatalog.listVariants('cache').map((variant) => variant.type)).toEqual(['cache', 'cdn'])
    expect(componentCatalog.listVariants('messaging').map((variant) => variant.type)).toEqual(['queue', 'stream'])
    expect(componentCatalog.listPresets('service', 1).map((preset) => preset.id)).toEqual(['worker'])
    expect(componentCatalog.listPresets('database', 2)).toEqual([])
    expect(componentCatalog.listPresets('database', 2, { includeLegacy: true }).map((preset) => preset.id)).toEqual(['sql-store', 'nosql-store'])
    expect(componentCatalog.getCategoryForVariant('database').id).toBe('database')
  })

  it('creates a resolved variant with or without a preset', () => {
    const plain = componentCatalog.createNode('service', 'service', 'plain', { x: 0, y: 0 })
    const worker = componentCatalog.createNode('service', 'service', 'worker', { x: 10, y: 20 }, {
      version: 1, preset: { id: 'worker', version: 1 },
    })
    expect(plain).toMatchObject({ type: 'service', componentVersion: 1 })
    expect(plain.rolePreset).toBeUndefined()
    expect(worker).toMatchObject({ type: 'service', componentVersion: 1, rolePreset: { id: 'worker', version: 1 } })
    expect(() => componentCatalog.createNode('database', 'service', 'wrong-category', { x: 0, y: 0 })).toThrow('does not belong to category database')
    expect(() => componentCatalog.createNode('service', 'service', 'wrong-preset', { x: 0, y: 0 }, { preset: { id: 'client', version: 1 } })).toThrow('does not belong to behavior variant service@1')
  })

  it('rejects unknown categories and permits only presets owned by an exact variant', () => {
    const categories = new ComponentCategoryRegistry([{ id: 'service', label: 'Service', description: 'Compute.', iconToken: 'server', color: '#000', order: 0 }])
    const variants = new ComponentRegistry([{
      type: 'test-service', version: 1, label: 'Test service', description: 'Test.', category: 'service', iconToken: 'server', color: '#000',
      configSchema: z.object({ concurrency: z.number().positive() }), createDefaultConfig: () => ({ concurrency: 1 }), configFields: [], ports: [], capabilities: [], emittedMetrics: [], supportedFaults: [], supportedNodePolicies: [], runtimeBehavior: 'test-service-v1', describeConfig: () => 'test',
    }])
    const presets = new ComponentPresetRegistry(variants, [{ id: 'test-preset', version: 1, label: 'Test preset', description: 'Test.', iconToken: 'server', behavior: { type: 'test-service', version: 1 }, configOverrides: { concurrency: 2 } }])
    expect(() => new ComponentCatalog(new ComponentCategoryRegistry(), variants, presets)).toThrow('Unknown component category: service')
    expect(new ComponentCatalog(categories, variants, presets).listPresets('test-service')).toHaveLength(1)
  })

  it('keeps legacy presets resolvable for imports but unavailable for new creation', () => {
    const variants = new ComponentRegistry(componentRegistry.list())
    const presets = new ComponentPresetRegistry(variants, [{ id: 'old-worker', version: 1, label: 'Old worker', description: 'Compatibility only.', iconToken: 'server', behavior: { type: 'service', version: 1 }, configOverrides: {}, availability: 'legacy' }])
    const catalog = new ComponentCatalog(componentCategoryRegistry, variants, presets)
    const imported = { ...variants.createNodeAtVersion('service', 1, 'imported', { x: 0, y: 0 }), rolePreset: { id: 'old-worker', version: 1 } }
    expect(presets.validateReference(imported)).toEqual(imported)
    expect(() => presets.createNode('old-worker', 1, 'new', { x: 0, y: 0 })).toThrow('cannot create new components')
    expect(catalog.listPresets('service', 1)).toEqual([])
    expect(catalog.listPresets('service', 1, { includeLegacy: true })).toHaveLength(1)
    expect(() => catalog.createNode('service', 'service', 'new', { x: 0, y: 0 }, { preset: { id: 'old-worker', version: 1 } })).toThrow('retained for compatibility')
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
