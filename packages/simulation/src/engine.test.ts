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
    expect({ ...first, wallClockDurationMs: 0 }).toEqual({ ...second, wallClockDurationMs: 0 })
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

  it('rejects a disconnected Traffic Generator', async () => {
    const scenario = directScenario()
    scenario.edges = []
    await expect(runSimulation(scenario)).rejects.toBeInstanceOf(SimulationValidationError)
  })
})
