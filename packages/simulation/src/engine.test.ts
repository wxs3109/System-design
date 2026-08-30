import { describe, expect, it } from 'vitest'
import { createEmptyScenario, createNode, type Scenario } from '@system-design/model'
import { runSimulation, SimulationValidationError } from './engine'

const directScenario = (requestsPerSecond = 50): Scenario => {
  const scenario = createEmptyScenario('direct')
  scenario.seed = 'repeatable'
  scenario.simulation.durationSeconds = 10
  const traffic = createNode('traffic', 'traffic', { x: 0, y: 0 }, 'load')
  const service = createNode('service', 'service', { x: 200, y: 0 })
  const database = createNode('database', 'database', { x: 400, y: 0 })
  scenario.nodes.push(traffic, service, database)
  scenario.edges.push(
    { id: 'e1', source: traffic.id, target: service.id, sourcePort: 'out', targetPort: 'in', weight: 1 },
    { id: 'e2', source: service.id, target: database.id, sourcePort: 'out', targetPort: 'in', weight: 1 },
  )
  scenario.workloads.push({
    id: 'load', name: 'Load', sourceNodeId: traffic.id, requestsPerSecond, startAtSeconds: 0,
    durationSeconds: 10, pattern: 'constant', requestBytes: 1_024,
  })
  return scenario
}

describe('discrete event simulation', () => {
  it('runs a topology assembled from generic components', async () => {
    const result = await runSimulation(directScenario())
    expect(result.summary.generatedRequests).toBe(500)
    expect(result.summary.completedRequests).toBeGreaterThan(480)
    expect(result.summary.latencyP95Ms).toBeGreaterThan(0)
    expect(result.nodes.map((node) => node.nodeType)).toEqual(['service', 'database'])
  })

  it('is deterministic for the same scenario and seed', async () => {
    const first = await runSimulation(directScenario())
    const second = await runSimulation(directScenario())
    expect({ ...first, runId: '', wallClockDurationMs: 0 }).toEqual({ ...second, runId: '', wallClockDurationMs: 0 })
  })

  it('exposes queueing when a resource is saturated', async () => {
    const scenario = directScenario(1_000)
    const service = scenario.nodes.find((node) => node.type === 'service')!
    if (service.type === 'service') {
      service.config.replicas = 1
      service.config.concurrencyPerReplica = 1
      service.config.serviceTimeMs = 20
      service.config.maxQueueSize = 100
    }
    const result = await runSimulation(scenario)
    const serviceMetrics = result.nodes.find((node) => node.nodeId === 'service')!
    expect(serviceMetrics.maxQueueLength).toBe(100)
    expect(result.summary.failedRequests).toBeGreaterThan(0)
  })

  it('uses full configured capacity when no capacity fault is active', async () => {
    const scenario = directScenario(150)
    const service = scenario.nodes.find((node) => node.type === 'service')!
    if (service.type === 'service') {
      service.config.replicas = 2
      service.config.concurrencyPerReplica = 1
      service.config.serviceTimeMs = 10
      service.config.jitterMs = 0
      service.config.maxQueueSize = 0
    }
    const database = scenario.nodes.find((node) => node.type === 'database')!
    if (database.type === 'database') database.config.errorRate = 0

    const result = await runSimulation(scenario)
    expect(result.summary.failedRequests).toBe(0)
    expect(result.summary.completedRequests).toBeGreaterThan(1_480)
  })

  it('applies a scheduled capacity-drop fault to resource admission', async () => {
    const baseline = directScenario(150)
    const service = baseline.nodes.find((node) => node.type === 'service')!
    if (service.type === 'service') {
      service.config.replicas = 2
      service.config.concurrencyPerReplica = 1
      service.config.serviceTimeMs = 10
      service.config.jitterMs = 0
      service.config.maxQueueSize = 0
    }
    const database = baseline.nodes.find((node) => node.type === 'database')!
    if (database.type === 'database') database.config.errorRate = 0
    const degraded = structuredClone(baseline)
    degraded.faults.push({
      id: 'service-capacity-drop', targetNodeId: 'service', type: 'capacity-drop',
      startAtSeconds: 0, durationSeconds: 10, factor: 0.5,
    })

    const [healthyResult, degradedResult] = await Promise.all([runSimulation(baseline), runSimulation(degraded)])
    expect(healthyResult.summary.failedRequests).toBe(0)
    expect(degradedResult.summary.failedRequests).toBeGreaterThan(400)
    expect(degradedResult.summary.completedRequests).toBeLessThan(healthyResult.summary.completedRequests)
  })

  it('restores configured resource capacity after a capacity-drop window', async () => {
    const baseline = directScenario(150)
    const service = baseline.nodes.find((node) => node.type === 'service')!
    if (service.type === 'service') {
      service.config.replicas = 2
      service.config.concurrencyPerReplica = 1
      service.config.serviceTimeMs = 10
      service.config.jitterMs = 0
      service.config.maxQueueSize = 0
    }
    const database = baseline.nodes.find((node) => node.type === 'database')!
    if (database.type === 'database') database.config.errorRate = 0
    const partialFault = structuredClone(baseline)
    partialFault.faults.push({ id: 'temporary-drop', targetNodeId: 'service', type: 'capacity-drop', startAtSeconds: 0, durationSeconds: 5, factor: 0.5 })
    const fullFault = structuredClone(baseline)
    fullFault.faults.push({ id: 'full-drop', targetNodeId: 'service', type: 'capacity-drop', startAtSeconds: 0, durationSeconds: 10, factor: 0.5 })

    const [partial, full] = await Promise.all([runSimulation(partialFault), runSimulation(fullFault)])
    expect(partial.summary.completedRequests).toBeGreaterThan(full.summary.completedRequests + 300)
    expect(partial.summary.failedRequests).toBeLessThan(full.summary.failedRequests)
  })

  it('rejects a disconnected Traffic Generator', async () => {
    const scenario = directScenario()
    scenario.edges = []
    await expect(runSimulation(scenario)).rejects.toBeInstanceOf(SimulationValidationError)
  })
})
