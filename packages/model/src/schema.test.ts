import { describe, expect, it } from 'vitest'
import { canConnect, createEmptyScenario, createNode, faultSchema, scenarioSchema } from './index'

const buildScenario = () => {
  const scenario = createEmptyScenario('round-trip')
  const traffic = createNode('traffic', 'traffic-1', { x: 0, y: 0 })
  const service = createNode('service', 'service-1', { x: 200, y: 0 })
  if (traffic.type !== 'traffic') throw new Error('Expected a traffic node')
  scenario.nodes.push(traffic, service)
  scenario.workloads.push({
    id: traffic.config.workloadId,
    name: 'Steady traffic',
    sourceNodeId: traffic.id,
    requestsPerSecond: 100,
    startAtSeconds: 0,
    durationSeconds: 20,
    pattern: 'constant',
    requestBytes: 1_024,
  })
  scenario.edges.push({ id: 'edge-1', source: traffic.id, target: service.id, sourcePort: 'out', targetPort: 'in', weight: 1 })
  return scenario
}

describe('scenario schema', () => {
  it('round-trips a versioned generic scenario', () => {
    const original = buildScenario()
    const parsed = scenarioSchema.parse(JSON.parse(JSON.stringify(original)))
    expect(parsed).toEqual(original)
  })

  it('rejects dangling edges', () => {
    const scenario = buildScenario()
    scenario.edges[0]!.target = 'missing-node'
    const result = scenarioSchema.safeParse(scenario)
    expect(result.success).toBe(false)
    expect(result.error?.issues.some((issue) => issue.message.includes('Unknown target node'))).toBe(true)
  })

  it('requires workloads to originate from traffic nodes', () => {
    const scenario = buildScenario()
    scenario.workloads[0]!.sourceNodeId = 'service-1'
    expect(scenarioSchema.safeParse(scenario).success).toBe(false)
  })

  it('uses catalog port semantics for connection validation', () => {
    const traffic = createNode('traffic', 'a', { x: 0, y: 0 })
    const service = createNode('service', 'b', { x: 0, y: 0 })
    expect(canConnect(traffic, service).valid).toBe(true)
    expect(canConnect(service, traffic)).toMatchObject({ valid: false })
  })

  it('round-trips a configured Load Balancer node', () => {
    const loadBalancer = createNode('load-balancer', 'lb', { x: 100, y: 50 })
    if (loadBalancer.type !== 'load-balancer') throw new Error('Expected a Load Balancer node.')
    loadBalancer.config.algorithm = 'health-aware'
    loadBalancer.config.failureThreshold = 3
    expect(scenarioSchema.shape.nodes.element.parse(loadBalancer)).toEqual(loadBalancer)
  })

  it('validates Global Router cache, health, and failover configuration', () => {
    const router = createNode('global-router', 'global', { x: 100, y: 50 })
    if (router.type !== 'global-router') throw new Error('Expected a Global Router node.')
    router.config.routingPolicy = 'health-aware'
    router.config.decisionTtlMs = 30_000
    expect(scenarioSchema.shape.nodes.element.parse(router)).toEqual(router)
    expect(scenarioSchema.shape.nodes.element.safeParse({ ...router, config: { ...router.config, decisionTtlMs: 0 } }).success).toBe(false)
    expect(scenarioSchema.shape.nodes.element.safeParse({ ...router, config: { ...router.config, unhealthyThreshold: 0 } }).success).toBe(false)
    expect(scenarioSchema.shape.nodes.element.safeParse({ ...router, config: { ...router.config, failoverDelayMs: -1 } }).success).toBe(false)
  })

  it('validates Scheduler timing and missed-run configuration', () => {
    const scheduler = createNode('scheduler', 'scheduler', { x: 100, y: 50 })
    if (scheduler.type !== 'scheduler') throw new Error('Expected a Scheduler node.')
    scheduler.config.batchSize = 10
    scheduler.config.missedRunPolicy = 'catch-up'
    scheduler.config.maxPendingRuns = 50
    expect(scenarioSchema.shape.nodes.element.parse(scheduler)).toEqual(scheduler)
    expect(scenarioSchema.shape.nodes.element.safeParse({ ...scheduler, config: { ...scheduler.config, jitterMs: scheduler.config.intervalMs + 1 } }).success).toBe(false)
    expect(scenarioSchema.shape.nodes.element.safeParse({ ...scheduler, config: { ...scheduler.config, concurrencyLimit: 0 } }).success).toBe(false)
  })

  it('validates CDN POP, cache, and bandwidth configuration', () => {
    const cdn = createNode('cdn', 'cdn', { x: 100, y: 50 })
    if (cdn.type !== 'cdn') throw new Error('Expected a CDN node.')
    cdn.config.popCount = 8
    cdn.config.popSelection = 'round-robin'
    expect(scenarioSchema.shape.nodes.element.parse(cdn)).toEqual(cdn)
    expect(scenarioSchema.shape.nodes.element.safeParse({ ...cdn, config: { ...cdn.config, popCount: 0 } }).success).toBe(false)
    expect(scenarioSchema.shape.nodes.element.safeParse({ ...cdn, config: { ...cdn.config, edgeBandwidthMbps: 0 } }).success).toBe(false)
  })

  it('validates Search Index refresh, shard, and merge configuration', () => {
    const search = createNode('search-index', 'search', { x: 100, y: 50 })
    if (search.type !== 'search-index') throw new Error('Expected a Search Index node.')
    search.config.shardCount = 12
    search.config.replicaRefreshDelayMs = 250
    expect(scenarioSchema.shape.nodes.element.parse(search)).toEqual(search)
    expect(scenarioSchema.shape.nodes.element.safeParse({ ...search, config: { ...search.config, shardCount: 0 } }).success).toBe(false)
    expect(scenarioSchema.shape.nodes.element.safeParse({ ...search, config: { ...search.config, refreshIntervalMs: 0 } }).success).toBe(false)
    expect(scenarioSchema.shape.nodes.element.safeParse({ ...search, config: { ...search.config, mergeTimePerCandidateMs: -1 } }).success).toBe(false)
  })

  it('validates Topic subscription, retention, and capacity configuration', () => {
    const topic = createNode('topic', 'topic', { x: 100, y: 50 })
    if (topic.type !== 'topic') throw new Error('Expected a Topic node.')
    topic.config.subscriptionCount = 4
    topic.config.retentionMs = 60_000
    expect(scenarioSchema.shape.nodes.element.parse(topic)).toEqual(topic)
    expect(scenarioSchema.shape.nodes.element.safeParse({ ...topic, config: { ...topic.config, subscriptionCount: 0 } }).success).toBe(false)
    expect(scenarioSchema.shape.nodes.element.safeParse({ ...topic, config: { ...topic.config, retentionMs: 0 } }).success).toBe(false)
    expect(scenarioSchema.shape.nodes.element.safeParse({ ...topic, config: { ...topic.config, maxRetainedMessages: 0 } }).success).toBe(false)
  })

  it('validates Realtime Gateway connection, channel, and backpressure configuration', () => {
    const gateway = createNode('realtime-gateway', 'gateway', { x: 100, y: 50 })
    if (gateway.type !== 'realtime-gateway') throw new Error('Expected a Realtime Gateway node.')
    gateway.config.maxConnections = 50_000
    gateway.config.overflowPolicy = 'disconnect'
    expect(scenarioSchema.shape.nodes.element.parse(gateway)).toEqual(gateway)
    expect(scenarioSchema.shape.nodes.element.safeParse({ ...gateway, config: { ...gateway.config, maxConnections: 0 } }).success).toBe(false)
    expect(scenarioSchema.shape.nodes.element.safeParse({ ...gateway, config: { ...gateway.config, outboundBandwidthMbps: 0 } }).success).toBe(false)
    expect(scenarioSchema.shape.nodes.element.safeParse({ ...gateway, config: { ...gateway.config, slowConnectionBandwidthMbps: gateway.config.outboundBandwidthMbps + 1 } }).success).toBe(false)
  })

  it('validates Workflow execution capacity and persistence configuration', () => {
    const workflow = createNode('workflow', 'workflow', { x: 100, y: 50 })
    if (workflow.type !== 'workflow') throw new Error('Expected a Workflow node.')
    workflow.config.maxConcurrentInstances = 50
    workflow.config.persistenceTimeMs = 3
    expect(scenarioSchema.shape.nodes.element.parse(workflow)).toEqual(workflow)
    expect(scenarioSchema.shape.nodes.element.safeParse({ ...workflow, config: { ...workflow.config, maxConcurrentInstances: 0 } }).success).toBe(false)
    expect(scenarioSchema.shape.nodes.element.safeParse({ ...workflow, config: { ...workflow.config, persistenceTimeMs: -1 } }).success).toBe(false)
    expect(scenarioSchema.shape.nodes.element.safeParse({ ...workflow, config: { ...workflow.config, errorRate: 2 } }).success).toBe(false)
  })

  it('validates fault-specific factor bounds', () => {
    const base = { id: 'fault', target: { kind: 'edge' as const, id: 'edge-1' }, startAtSeconds: 0, durationSeconds: 1, enabled: true }
    expect(faultSchema.safeParse({ ...base, type: 'packet-loss', factor: 0.25 }).success).toBe(true)
    expect(faultSchema.safeParse({ ...base, type: 'packet-loss', factor: 2 }).success).toBe(false)
    expect(faultSchema.safeParse({ ...base, type: 'latency-spike', factor: 0.5 }).success).toBe(false)
    expect(faultSchema.safeParse({ ...base, type: 'node-down', factor: 1 }).success).toBe(false)
  })
})
