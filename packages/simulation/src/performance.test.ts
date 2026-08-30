import { describe, expect, it } from 'vitest'
import { createEmptyProject } from '@system-design/model'
import { createRegisteredNode } from '@system-design/components'
import { compileSimulationInput } from './compiler/compiler'
import { runSimulation } from './engine'

const connection = (id: string, source: string, target: string) => ({
  id, source, target, sourcePort: 'out', targetPort: 'in', weight: 1,
  sourceSemantic: 'request' as const, targetSemantic: 'request' as const, routingMode: 'weighted-one' as const,
})

const performanceProject = () => {
  const project = createEmptyProject('phase-1-performance')
  const traffic = createRegisteredNode('traffic', 'traffic', { x: 0, y: 0 })
  const activeService = createRegisteredNode('service', 'active-service', { x: 200, y: 0 })
  activeService.config = { ...activeService.config, replicas: 100, concurrencyPerReplica: 100, serviceTimeMs: 0.001, jitterMs: 0, errorRate: 0, maxQueueSize: 100_000 }
  const unusedServices = Array.from({ length: 98 }, (_, index) => createRegisteredNode('service', `unused-service-${index + 1}`, { x: 400 + index * 20, y: 0 }))
  project.topology.nodes = [traffic, activeService, ...unusedServices]
  project.topology.edges = [connection('active-edge', traffic.id, activeService.id)]
  const experiment = project.experiments[0]!
  experiment.seed = 'phase-1-performance'
  experiment.simulation = { durationSeconds: 1, sampleIntervalMs: 1_000, maxRequests: 100_000, traceLimit: 0, maxHops: 4 }
  experiment.workloads = [{ id: 'load', name: 'High-volume deterministic load', sourceNodeId: traffic.id, requestsPerSecond: 100_000, startAtSeconds: 0, durationSeconds: 1, pattern: 'constant', requestBytes: 1 }]
  return project
}

describe('Phase 1 performance budget', () => {
  it('compiles and runs 100,000 requests through a 100-node project within the CI budget', async () => {
    const startedAt = performance.now()
    const project = performanceProject()
    const compiled = compileSimulationInput(project)
    expect(compiled.nodes).toHaveLength(100)
    expect(compiled.edges).toHaveLength(1)
    const result = await runSimulation(project, 'phase-1-performance')
    const elapsedMs = performance.now() - startedAt
    expect(result.summary.generatedRequests).toBe(100_000)
    expect(result.summary.completedRequests + result.summary.failedRequests).toBeLessThanOrEqual(result.summary.generatedRequests)
    expect(result.nodes).toHaveLength(99)
    expect(result.events.every((event) => event.requestId === undefined)).toBe(true)
    expect(elapsedMs).toBeLessThan(5_000)
  }, 10_000)
})
