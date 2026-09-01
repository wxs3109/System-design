import { describe, expect, it } from 'vitest'
import { createRegisteredNode } from '@system-design/components'
import { createEmptyProject, createOrderSystemContractFixture } from '@system-design/model'
import * as examples from './examples'
import { reviewArchitecture } from './architecture-review'

const edge = (id: string, source: string, target: string, overrides: Record<string, unknown> = {}) => ({
  id, source, target, sourcePort: 'out', targetPort: 'in', weight: 1, sourceSemantic: 'request' as const, targetSemantic: 'request' as const, routingMode: 'weighted-one' as const, ...overrides,
})

describe('static architecture review', () => {
  it('finds structural connectivity, redundancy, cache, broker, router and policy risks', () => {
    const project = createEmptyProject('review-risks')
    const traffic = createRegisteredNode('traffic', 'traffic', { x: 0, y: 0 }, 'load')
    const service = createRegisteredNode('service', 'service', { x: 200, y: 0 })
    const cache = createRegisteredNode('cache', 'cache', { x: 400, y: 0 })
    const database = createRegisteredNode('database', 'database', { x: 600, y: 0 })
    const queue = createRegisteredNode('queue', 'queue', { x: 800, y: 0 })
    const router = createRegisteredNode('load-balancer', 'router', { x: 1_000, y: 0 })
    const isolated = createRegisteredNode('service', 'isolated', { x: 1_200, y: 0 })
    if (service.type !== 'service' || database.type !== 'database') throw new Error('Expected typed nodes')
    service.config.replicas = 1
    database.config.replicasPerShard = 0
    project.topology.nodes = [traffic, service, cache, database, queue, router, isolated]
    project.topology.edges = [
      edge('entry', traffic.id, service.id),
      edge('service-cache', service.id, cache.id),
      edge('service-database', service.id, database.id),
      edge('service-queue', service.id, queue.id, { sourcePort: 'publish', targetPort: 'consume', sourceSemantic: 'publish', targetSemantic: 'consume', routingMode: 'async-publish' }),
      edge('service-router', service.id, router.id),
    ]
    project.experiments[0]!.workloads = [{ id: 'load', name: 'Load', sourceNodeId: traffic.id, requestsPerSecond: 1, startAtSeconds: 0, durationSeconds: 1, pattern: 'constant', requestBytes: 1 }]
    project.topology.policies = [{ id: 'retry', type: 'retry', version: 1, target: { kind: 'edge', id: 'entry' }, order: 0, enabled: true, config: { maxAttempts: 3, backoff: 'fixed', baseDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 } }]

    expect(new Set(reviewArchitecture(project).map((finding) => finding.rule))).toEqual(new Set([
      'isolated-node', 'single-replica-service', 'database-no-replica', 'cache-no-miss-path', 'broker-no-consumer', 'router-no-target', 'retry-without-timeout',
    ]))
  })

  it('recognizes business cache-miss handling and global routing without false positives', () => {
    const order = reviewArchitecture(createOrderSystemContractFixture())
    expect(order.some((finding) => finding.rule === 'cache-no-miss-path' && finding.target.id === 'orders-cache')).toBe(false)
    const global = reviewArchitecture(examples.createGlobalStorefrontExample())
    expect(global.some((finding) => finding.rule === 'cross-region-edge' && finding.target.id.includes('route'))).toBe(false)
  })

  it('does not report a structural error for any valid built-in example', () => {
    const factories = Object.entries(examples).filter(([name, factory]) => /^create.*Example$/.test(name) && typeof factory === 'function') as Array<[string, () => ReturnType<typeof examples.createDirectExample>]>
    const errors = factories.flatMap(([name, factory]) => reviewArchitecture(factory()).filter((finding) => finding.severity === 'error').map((finding) => `${name}:${finding.rule}:${finding.target.id}`))
    expect(errors).toEqual([])
  })

  it('reports an explicit non-router cross-region dependency and ignores disabled policies', () => {
    const project = createEmptyProject('cross-region')
    const traffic = createRegisteredNode('traffic', 'traffic', { x: 0, y: 0 }, 'load')
    const west = createRegisteredNode('service', 'west', { x: 200, y: 0 })
    const east = createRegisteredNode('service', 'east', { x: 400, y: 0 })
    project.topology.nodes = [traffic, west, east]
    project.topology.edges = [edge('entry', traffic.id, west.id), edge('cross-region', west.id, east.id)]
    project.topology.groups = [{ id: 'west-region', name: 'West', kind: 'region', nodeIds: [traffic.id, west.id] }, { id: 'east-region', name: 'East', kind: 'region', nodeIds: [east.id] }]
    project.experiments[0]!.workloads = [{ id: 'load', name: 'Load', sourceNodeId: traffic.id, requestsPerSecond: 1, startAtSeconds: 0, durationSeconds: 1, pattern: 'constant', requestBytes: 1 }]
    project.topology.policies = [
      { id: 'retry', type: 'retry', version: 1, target: { kind: 'edge', id: 'cross-region' }, order: 0, enabled: true, config: { maxAttempts: 3, backoff: 'fixed', baseDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 } },
      { id: 'timeout-off', type: 'timeout', version: 1, target: { kind: 'edge', id: 'cross-region' }, order: 1, enabled: false, config: { timeoutMs: 100 } },
    ]

    const findings = reviewArchitecture(project)
    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: 'cross-region-edge', target: { kind: 'edge', id: 'cross-region' }, severity: 'info' }),
      expect.objectContaining({ rule: 'retry-without-timeout', target: { kind: 'edge', id: 'cross-region' }, severity: 'warning' }),
    ]))
  })
})
