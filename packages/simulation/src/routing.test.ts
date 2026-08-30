import { describe, expect, it } from 'vitest'
import { createEmptyProject, migrateProjectV2ToProjectV3, type ProjectFile, type ProjectFileV2 } from '@system-design/model'
import { createRegisteredNode } from '@system-design/components'
import { runSimulation } from './engine'

const routingProject = (mode: 'weighted-one' | 'fan-out' | 'async-publish'): ProjectFile => {
  const project = createEmptyProject(`routing-${mode}`)
  project.topology.nodes = [
    createRegisteredNode('traffic', 'traffic', { x: 0, y: 0 }),
    createRegisteredNode('service', 'router', { x: 200, y: 0 }),
    createRegisteredNode('service', 'left', { x: 400, y: -100 }),
    createRegisteredNode('service', 'right', { x: 400, y: 100 }),
  ]
  const semantic = mode === 'async-publish' ? { sourcePort: 'publish', targetPort: 'consume', sourceSemantic: 'publish' as const, targetSemantic: 'consume' as const } : { sourcePort: 'out', targetPort: 'in', sourceSemantic: 'request' as const, targetSemantic: 'request' as const }
  project.topology.edges = [
    { id: 'entry', source: 'traffic', target: 'router', sourcePort: 'out', targetPort: 'in', weight: 1, routingMode: 'weighted-one', sourceSemantic: 'request', targetSemantic: 'request' },
    { id: 'left-edge', source: 'router', target: 'left', weight: 1, routingMode: mode, ...semantic },
    { id: 'right-edge', source: 'router', target: 'right', weight: 3, routingMode: mode, ...semantic },
  ]
  const experiment = project.experiments[0]!
  experiment.seed = 'routing-seed'
  experiment.simulation.durationSeconds = 2
  experiment.simulation.maxRequests = 100
  experiment.workloads = [{ id: 'load', name: 'Load', sourceNodeId: 'traffic', requestsPerSecond: 10, startAtSeconds: 0, durationSeconds: 1, pattern: 'constant', requestBytes: 100 }]
  return project
}

describe('explicit routing modes', () => {
  it('weighted-one selects exactly one target per request using weights', async () => {
    const result = await runSimulation(routingProject('weighted-one'), 'weighted')
    const left = result.nodes.find((node) => node.nodeId === 'left')!
    const right = result.nodes.find((node) => node.nodeId === 'right')!
    expect(left.processedRequests + right.processedRequests).toBe(result.summary.completedRequests)
    expect(right.processedRequests).toBeGreaterThan(left.processedRequests)
  })

  it('fan-out executes every branch and completes once after all branches', async () => {
    const result = await runSimulation(routingProject('fan-out'), 'fanout')
    const leaves = result.nodes.filter((node) => node.nodeId === 'left' || node.nodeId === 'right')
    expect(leaves[0]!.processedRequests).toBe(result.summary.completedRequests)
    expect(leaves[1]!.processedRequests).toBe(result.summary.completedRequests)
    expect(result.events.filter((event) => event.type === 'dependency-started' && event.attributes.routingMode === 'fan-out')).toHaveLength(result.summary.generatedRequests * 2)
  })

  it('async-publish acknowledges the caller without waiting for consumers', async () => {
    const result = await runSimulation(routingProject('async-publish'), 'async')
    expect(result.events.filter((event) => event.type === 'message-published')).toHaveLength(result.summary.generatedRequests * 2)
    expect(result.summary.completedRequests).toBe(result.summary.generatedRequests)
    const accepted = result.events.filter((event) => event.attributes.asyncAccepted === true)
    expect(accepted).toHaveLength(result.summary.generatedRequests)
  })

  it('fails a fan-out root once when one branch fails', async () => {
    const project = routingProject('fan-out')
    const left = project.topology.nodes.find((node) => node.id === 'left')!
    left.config = { ...left.config, errorRate: 1 }
    const result = await runSimulation(project, 'fanout-failure')
    expect(result.summary.failedRequests).toBe(result.summary.generatedRequests)
    expect(result.events.filter((event) => event.type === 'request-failed' && event.attributes.terminal === true)).toHaveLength(result.summary.generatedRequests)
  })

  it('does not let an asynchronous consumer failure contaminate caller success', async () => {
    const project = routingProject('async-publish')
    for (const node of project.topology.nodes.filter((node) => node.id === 'left' || node.id === 'right')) node.config = { ...node.config, errorRate: 1 }
    const result = await runSimulation(project, 'async-failure')
    expect(result.summary.completedRequests).toBe(result.summary.generatedRequests)
    expect(result.summary.failedRequests).toBe(0)
    expect(result.events.some((event) => event.type === 'request-failed' && event.attributes.terminal === false)).toBe(true)
  })

  it('publishes asynchronously while continuing the synchronous request path', async () => {
    const project = routingProject('weighted-one')
    project.topology.nodes.push(createRegisteredNode('queue', 'audit', { x: 300, y: 200 }))
    project.topology.edges.push({ id: 'audit-edge', source: 'router', target: 'audit', sourcePort: 'publish', targetPort: 'consume', weight: 1, routingMode: 'async-publish', sourceSemantic: 'publish', targetSemantic: 'consume' })
    const result = await runSimulation(project, 'mixed-routing')
    expect(result.summary.completedRequests).toBe(result.summary.generatedRequests)
    expect(result.events.filter((event) => event.type === 'message-published')).toHaveLength(result.summary.generatedRequests)
    expect(result.events.some((event) => event.nodeId === 'left' || event.nodeId === 'right')).toBe(true)
  })

  it('releases backpressure gates after every hop in an asynchronous chain', async () => {
    const project = routingProject('weighted-one')
    project.topology.nodes = [
      project.topology.nodes[0]!,
      createRegisteredNode('service', 'producer', { x: 200, y: 0 }),
      createRegisteredNode('queue', 'relay', { x: 400, y: 0 }),
      createRegisteredNode('queue', 'consumer', { x: 600, y: 0 }),
    ]
    project.topology.edges = [
      { id: 'entry', source: 'traffic', target: 'producer', sourcePort: 'out', targetPort: 'in', weight: 1, routingMode: 'weighted-one', sourceSemantic: 'request', targetSemantic: 'request' },
      { id: 'publish', source: 'producer', target: 'relay', sourcePort: 'publish', targetPort: 'consume', weight: 1, routingMode: 'async-publish', sourceSemantic: 'publish', targetSemantic: 'consume' },
      { id: 'forward', source: 'relay', target: 'consumer', sourcePort: 'publish', targetPort: 'consume', weight: 1, routingMode: 'async-publish', sourceSemantic: 'publish', targetSemantic: 'consume' },
    ]
    project.topology.policies = [
      { id: 'publish-pressure', type: 'backpressure', version: 1, target: { kind: 'edge', id: 'publish' }, order: 0, enabled: true, config: { maxInFlight: 1, overflow: 'reject' } },
      { id: 'forward-pressure', type: 'backpressure', version: 1, target: { kind: 'edge', id: 'forward' }, order: 0, enabled: true, config: { maxInFlight: 1, overflow: 'reject' } },
    ]
    for (const node of project.topology.nodes.filter((candidate) => candidate.type === 'queue')) {
      node.config = { ...node.config, consumers: 1, deliveryTimeMs: 1, jitterMs: 0 }
    }
    project.experiments[0]!.workloads[0] = { ...project.experiments[0]!.workloads[0]!, requestsPerSecond: 10, durationSeconds: 1 }

    const result = await runSimulation(project, 'async-chain-backpressure')
    expect(result.summary.completedRequests).toBe(result.summary.generatedRequests)
    expect(result.events.filter((event) => event.type === 'message-acknowledged' && event.edgeId === 'publish')).toHaveLength(result.summary.generatedRequests)
    expect(result.events.filter((event) => event.type === 'message-acknowledged' && event.edgeId === 'forward')).toHaveLength(result.summary.generatedRequests)
    expect(result.events.some((event) => event.reason === 'backpressure')).toBe(false)
  })

  it('preserves complete Phase 1 results when ProjectFile v2 is migrated to v3', async () => {
    const current = routingProject('weighted-one')
    const legacy: ProjectFileV2 = {
      schemaVersion: 2,
      id: current.id,
      name: current.name,
      topology: structuredClone(current.topology),
      experiments: current.experiments.map(({ operationWorkloads: _operationWorkloads, ...experiment }) => structuredClone(experiment)),
      activeExperimentId: current.activeExperimentId,
    }
    const migrated = migrateProjectV2ToProjectV3(legacy)
    const [before, after] = await Promise.all([runSimulation(legacy, 'project-migration'), runSimulation(migrated, 'project-migration')])
    const { wallClockDurationMs: _beforeWallClock, ...beforeDeterministic } = before
    const { wallClockDurationMs: _afterWallClock, ...afterDeterministic } = after
    expect(afterDeterministic).toEqual(beforeDeterministic)
  })
})
