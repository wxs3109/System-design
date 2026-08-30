import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { createEmptyProject } from '@system-design/model'
import { createRegisteredNode } from '@system-design/components'
import { runSimulation } from './engine'

interface RuntimeConfiguration {
  seed: string
  requestsPerSecond: number
  durationSeconds: number
  maxRequests: number
  maxHops: number
  serviceTimeMs: number
  jitterMs: number
  replicas: number
  concurrencyPerReplica: number
  maxQueueSize: number
  errorRate: number
  traceLimit: number
}

const runtimeConfigurationArbitrary: fc.Arbitrary<RuntimeConfiguration> = fc.record({
  seed: fc.string({ minLength: 1, maxLength: 30 }),
  requestsPerSecond: fc.integer({ min: 1, max: 60 }),
  durationSeconds: fc.integer({ min: 1, max: 3 }),
  maxRequests: fc.integer({ min: 1, max: 120 }),
  maxHops: fc.integer({ min: 1, max: 12 }),
  serviceTimeMs: fc.integer({ min: 1, max: 40 }),
  jitterMs: fc.integer({ min: 0, max: 10 }),
  replicas: fc.integer({ min: 1, max: 4 }),
  concurrencyPerReplica: fc.integer({ min: 1, max: 5 }),
  maxQueueSize: fc.integer({ min: 0, max: 20 }),
  errorRate: fc.integer({ min: 0, max: 10 }).map((percent) => percent / 100),
  traceLimit: fc.integer({ min: 120, max: 200 }),
})

const cyclicConfigurationArbitrary = fc.record({
  seed: fc.string({ minLength: 1, maxLength: 30 }),
  maxHops: fc.integer({ min: 1, max: 12 }),
  maxAttempts: fc.integer({ min: 1, max: 5 }),
  baseDelayMs: fc.integer({ min: 0, max: 5 }),
})

const runtimeProject = (input: RuntimeConfiguration) => {
  const project = createEmptyProject('property-runtime')
  const traffic = createRegisteredNode('traffic', 'traffic', { x: 0, y: 0 }, 'load')
  const service = createRegisteredNode('service', 'service', { x: 200, y: 0 })
  Object.assign(service.config, {
    serviceTimeMs: input.serviceTimeMs, jitterMs: input.jitterMs, replicas: input.replicas,
    concurrencyPerReplica: input.concurrencyPerReplica, maxQueueSize: input.maxQueueSize, errorRate: input.errorRate,
  })
  project.topology.nodes = [traffic, service]
  project.topology.edges = [{
    id: 'edge', source: traffic.id, target: service.id, sourcePort: 'out', targetPort: 'in',
    sourceSemantic: 'request', targetSemantic: 'request', routingMode: 'weighted-one', weight: 1,
  }]
  const experiment = project.experiments[0]!
  experiment.seed = input.seed
  experiment.simulation = { durationSeconds: input.durationSeconds, sampleIntervalMs: 100, maxRequests: input.maxRequests, traceLimit: input.traceLimit, maxHops: input.maxHops }
  experiment.workloads = [{
    id: 'load', name: 'Property load', sourceNodeId: traffic.id, requestsPerSecond: input.requestsPerSecond,
    startAtSeconds: 0, durationSeconds: input.durationSeconds, pattern: 'poisson', requestBytes: 1_024,
  }]
  return project
}

const stableResult = <T extends Awaited<ReturnType<typeof runSimulation>>>(result: T) => ({ ...result, wallClockDurationMs: 0 })

describe('runtime properties', () => {
  it('replays the same ordered event stream for every generated configuration and seed', async () => {
    await fc.assert(fc.asyncProperty(runtimeConfigurationArbitrary, async (input) => {
      const project = runtimeProject(input)
      const [first, replay] = await Promise.all([
        runSimulation(project, 'property-replay'),
        runSimulation(structuredClone(project), 'property-replay'),
      ])

      expect(stableResult(replay)).toEqual(stableResult(first))
      expect(first.events.every((event, index) => index === 0 || event.sequence > first.events[index - 1]!.sequence)).toBe(true)
    }), { numRuns: 30 })
  })

  it('keeps counters non-negative, terminal outcomes bounded, and queues within configured limits', async () => {
    await fc.assert(fc.asyncProperty(runtimeConfigurationArbitrary, async (input) => {
      const result = await runSimulation(runtimeProject(input), 'property-invariants')
      const { generatedRequests, completedRequests, failedRequests } = result.summary

      expect(generatedRequests).toBeGreaterThanOrEqual(0)
      expect(completedRequests).toBeGreaterThanOrEqual(0)
      expect(failedRequests).toBeGreaterThanOrEqual(0)
      expect(completedRequests + failedRequests).toBeLessThanOrEqual(generatedRequests)
      expect(result.nodes.every((node) => node.maxQueueLength >= 0 && node.maxQueueLength <= input.maxQueueSize)).toBe(true)
    }), { numRuns: 30 })
  })

  it('bounds retries and always terminates cyclic graphs at the hop budget', async () => {
    await fc.assert(fc.asyncProperty(cyclicConfigurationArbitrary, async (input) => {
      const project = createEmptyProject('property-cycle')
      const traffic = createRegisteredNode('traffic', 'traffic', { x: 0, y: 0 }, 'load')
      const first = createRegisteredNode('service', 'first', { x: 200, y: 0 })
      const second = createRegisteredNode('service', 'second', { x: 400, y: 0 })
      Object.assign(first.config, { serviceTimeMs: 1, jitterMs: 0, errorRate: 0, replicas: 1, concurrencyPerReplica: 1, maxQueueSize: 10 })
      Object.assign(second.config, { serviceTimeMs: 1, jitterMs: 0, errorRate: 1, replicas: 1, concurrencyPerReplica: 1, maxQueueSize: 10 })
      project.topology.nodes = [traffic, first, second]
      project.topology.edges = [
        { id: 'entry', source: traffic.id, target: first.id, sourcePort: 'out', targetPort: 'in', sourceSemantic: 'request', targetSemantic: 'request', routingMode: 'weighted-one', weight: 1 },
        { id: 'forward', source: first.id, target: second.id, sourcePort: 'out', targetPort: 'in', sourceSemantic: 'request', targetSemantic: 'request', routingMode: 'weighted-one', weight: 1 },
        { id: 'cycle', source: second.id, target: first.id, sourcePort: 'out', targetPort: 'in', sourceSemantic: 'request', targetSemantic: 'request', routingMode: 'weighted-one', weight: 1 },
      ]
      project.topology.policies = [{
        id: 'retry', type: 'retry', version: 1, target: { kind: 'edge', id: 'forward' }, order: 0, enabled: true,
        config: { maxAttempts: input.maxAttempts, backoff: 'fixed', baseDelayMs: input.baseDelayMs, maxDelayMs: input.baseDelayMs, jitterRatio: 0 },
      }]
      const experiment = project.experiments[0]!
      experiment.seed = input.seed
      experiment.simulation = { durationSeconds: 1, sampleIntervalMs: 100, maxRequests: 1, traceLimit: 10, maxHops: input.maxHops }
      experiment.workloads = [{ id: 'load', name: 'One request', sourceNodeId: traffic.id, requestsPerSecond: 1, startAtSeconds: 0, durationSeconds: 1, pattern: 'constant', requestBytes: 1 }]

      const retryResult = await runSimulation(project, 'property-retry-budget')
      const attempts = retryResult.events.filter((event) => event.type === 'attempt-started')
      expect(attempts.length).toBeLessThanOrEqual(input.maxAttempts)
      expect(retryResult.summary.completedRequests + retryResult.summary.failedRequests).toBeLessThanOrEqual(1)

      const cyclicProject = structuredClone(project)
      cyclicProject.topology.policies = []
      cyclicProject.topology.nodes.find((node) => node.id === 'second')!.config.errorRate = 0
      const cyclicResult = await runSimulation(cyclicProject, 'property-hop-budget')
      const requestArrivals = cyclicResult.events.filter((event) => event.type === 'request-arrived')
      const terminal = cyclicResult.events.filter((event) => event.attributes.terminal === true)

      expect(requestArrivals.length).toBeLessThanOrEqual(input.maxHops + 1)
      expect(terminal).toHaveLength(1)
      expect(terminal[0]).toMatchObject({ type: 'request-failed', reason: 'hop_limit' })
      expect(cyclicResult.summary).toMatchObject({ generatedRequests: 1, completedRequests: 0, failedRequests: 1 })
    }), { numRuns: 25 })
  })
})
