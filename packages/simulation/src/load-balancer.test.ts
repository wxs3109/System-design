import { describe, expect, it } from 'vitest'
import { createRegisteredNode } from '@system-design/components'
import { createEmptyProject, type ProjectConnection, type ProjectFileV2 } from '@system-design/model'
import { runSimulation } from './engine'

const requestEdge = (id: string, source: string, target: string, weight = 1): ProjectConnection => ({
  id, source, target, sourcePort: 'out', targetPort: 'in', weight, routingMode: 'weighted-one', sourceSemantic: 'request', targetSemantic: 'request',
})

const loadBalancedProject = (algorithm: 'weighted' | 'round-robin' | 'health-aware'): ProjectFileV2 => {
  const project = createEmptyProject(`load-balancer-${algorithm}`)
  project.topology.nodes = [
    createRegisteredNode('traffic', 'traffic', { x: 0, y: 0 }, 'load'),
    createRegisteredNode('load-balancer', 'lb', { x: 200, y: 0 }),
    createRegisteredNode('service', 'left', { x: 400, y: -100 }),
    createRegisteredNode('service', 'right', { x: 400, y: 100 }),
  ]
  const loadBalancer = project.topology.nodes[1]!
  loadBalancer.config = { ...loadBalancer.config, algorithm, routingTimeMs: 0.1 }
  project.topology.edges = [
    requestEdge('entry', 'traffic', 'lb'),
    requestEdge('left-edge', 'lb', 'left', 1),
    requestEdge('right-edge', 'lb', 'right', 3),
  ]
  const experiment = project.experiments[0]!
  experiment.seed = `load-balancer-${algorithm}`
  experiment.simulation = { ...experiment.simulation, durationSeconds: 1, maxRequests: 100, sampleIntervalMs: 100 }
  experiment.workloads = [{ id: 'load', name: 'Load', sourceNodeId: 'traffic', requestsPerSecond: 8, startAtSeconds: 0, durationSeconds: 1, pattern: 'constant', requestBytes: 100 }]
  return project
}

const selectedTargets = (events: Awaited<ReturnType<typeof runSimulation>>['events']) => events
  .filter((event) => event.type === 'dependency-started' && event.nodeId === 'lb')
  .map((event) => event.edgeId)

describe('Load Balancer routing', () => {
  it('selects one target deterministically according to edge weights', async () => {
    const project = loadBalancedProject('weighted')
    project.experiments[0]!.workloads[0]!.requestsPerSecond = 100
    const [first, replay] = await Promise.all([runSimulation(project, 'weighted-lb'), runSimulation(structuredClone(project), 'weighted-lb')])
    const targets = selectedTargets(first.events)
    expect(targets).toHaveLength(first.summary.generatedRequests)
    expect(targets.filter((target) => target === 'right-edge').length).toBeGreaterThan(targets.filter((target) => target === 'left-edge').length)
    expect(selectedTargets(replay.events)).toEqual(targets)
  })

  it('visits targets in stable round-robin order regardless of weights', async () => {
    const project = loadBalancedProject('round-robin')
    project.topology.edges[1]!.weight = 100
    expect(selectedTargets((await runSimulation(project, 'round-robin-lb')).events)).toEqual([
      'left-edge', 'right-edge', 'left-edge', 'right-edge', 'left-edge', 'right-edge', 'left-edge', 'right-edge',
    ])
  })

  it('quarantines a failed target and routes later requests to a healthy target', async () => {
    const project = loadBalancedProject('health-aware')
    const loadBalancer = project.topology.nodes[1]!
    loadBalancer.config = { ...loadBalancer.config, failureThreshold: 1, recoveryTimeMs: 5_000 }
    project.topology.edges[1]!.weight = 1_000_000
    project.topology.edges[2]!.weight = 1
    project.experiments[0]!.faults = [{ id: 'left-down', targetNodeId: 'left', type: 'node-down', startAtSeconds: 0, durationSeconds: 1, enabled: true }]

    const result = await runSimulation(project, 'health-aware-lb')
    const targets = selectedTargets(result.events)
    expect(targets[0]).toBe('left-edge')
    expect(targets.slice(1)).toEqual(Array(targets.length - 1).fill('right-edge'))
    expect(result.nodes.find((node) => node.nodeId === 'left')?.failedRequests).toBe(1)
    expect(result.nodes.find((node) => node.nodeId === 'right')?.processedRequests).toBe(result.summary.generatedRequests - 1)
  })

  it('quarantines a protected target only after its configured attempts are exhausted', async () => {
    const project = loadBalancedProject('health-aware')
    const loadBalancer = project.topology.nodes[1]!
    loadBalancer.config = { ...loadBalancer.config, failureThreshold: 1, recoveryTimeMs: 5_000 }
    project.topology.edges[1]!.weight = 1_000_000
    project.topology.edges[2]!.weight = 1
    project.experiments[0]!.faults = [{ id: 'left-down', targetNodeId: 'left', type: 'node-down', startAtSeconds: 0, durationSeconds: 1, enabled: true }]
    project.topology.policies = [{
      id: 'left-retry', type: 'retry', version: 1, target: { kind: 'edge', id: 'left-edge' }, order: 0, enabled: true,
      config: { maxAttempts: 2, backoff: 'fixed', baseDelayMs: 0, maxDelayMs: 0, jitterRatio: 0 },
    }]

    const result = await runSimulation(project, 'protected-health-aware-lb')
    const targets = selectedTargets(result.events)
    expect(targets[0]).toBe('left-edge')
    expect(targets.slice(1)).toEqual(Array(targets.length - 1).fill('right-edge'))
    expect(result.events.filter((event) => event.type === 'attempt-started' && event.edgeId === 'left-edge')).toHaveLength(2)
    expect(result.nodes.find((node) => node.nodeId === 'left')?.failedRequests).toBe(2)
  })
})
