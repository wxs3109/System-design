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

  it('validates fault-specific factor bounds', () => {
    const base = { id: 'fault', target: { kind: 'edge' as const, id: 'edge-1' }, startAtSeconds: 0, durationSeconds: 1, enabled: true }
    expect(faultSchema.safeParse({ ...base, type: 'packet-loss', factor: 0.25 }).success).toBe(true)
    expect(faultSchema.safeParse({ ...base, type: 'packet-loss', factor: 2 }).success).toBe(false)
    expect(faultSchema.safeParse({ ...base, type: 'latency-spike', factor: 0.5 }).success).toBe(false)
    expect(faultSchema.safeParse({ ...base, type: 'node-down', factor: 1 }).success).toBe(false)
  })
})
