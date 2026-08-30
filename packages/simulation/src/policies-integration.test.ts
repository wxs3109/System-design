import { describe, expect, it } from 'vitest'
import { createEmptyProject, type ProjectFileV2 } from '@system-design/model'
import { createRegisteredNode } from '@system-design/components'
import { runSimulation } from './engine'

const directProject = (requestsPerSecond = 10): ProjectFileV2 => {
  const project = createEmptyProject('policy-integration')
  project.topology.nodes = [createRegisteredNode('traffic', 'traffic', { x: 0, y: 0 }), createRegisteredNode('service', 'service', { x: 100, y: 0 })]
  project.topology.edges = [{ id: 'edge', source: 'traffic', target: 'service', sourcePort: 'out', targetPort: 'in', weight: 1, sourceSemantic: 'request', targetSemantic: 'request', routingMode: 'weighted-one' }]
  project.experiments[0]!.simulation = { ...project.experiments[0]!.simulation, durationSeconds: 1, sampleIntervalMs: 100 }
  project.experiments[0]!.workloads = [{ id: 'load', name: 'Load', sourceNodeId: 'traffic', requestsPerSecond, startAtSeconds: 0, durationSeconds: 1, pattern: 'constant', requestBytes: 1 }]
  return project
}

describe('admission and delivery policies in the runtime', () => {
  it('accounts token-bucket admission deterministically for a fixed project and seed', async () => {
    const project = directProject(10)
    project.topology.policies = [{ id: 'limit', type: 'rate-limit', version: 1, target: { kind: 'node', id: 'service' }, order: 0, enabled: true, config: { capacity: 2, refillTokens: 1, refillIntervalMs: 500 } }]
    const [first, replay] = await Promise.all([runSimulation(project, 'rate-limit'), runSimulation(structuredClone(project), 'rate-limit')])
    const accepted = first.events.filter((event) => event.type === 'rate-limit-accepted')
    const rejected = first.events.filter((event) => event.type === 'rate-limit-rejected')
    expect(accepted).toHaveLength(3)
    expect(rejected.length).toBe(first.summary.generatedRequests - accepted.length)
    expect(replay.events).toEqual(first.events)
  })

  it('dead-letters asynchronous overflow without failing an accepted producer request', async () => {
    const project = directProject(20)
    project.topology.nodes[0] = createRegisteredNode('service', 'producer', { x: 0, y: 0 })
    project.topology.nodes.unshift(createRegisteredNode('traffic', 'traffic', { x: -100, y: 0 }))
    project.topology.nodes.push(createRegisteredNode('queue', 'consumer', { x: 200, y: 0 }))
    project.topology.edges = [
      { id: 'entry', source: 'traffic', target: 'producer', sourcePort: 'out', targetPort: 'in', weight: 1, sourceSemantic: 'request', targetSemantic: 'request', routingMode: 'weighted-one' },
      { id: 'publish', source: 'producer', target: 'consumer', sourcePort: 'publish', targetPort: 'consume', weight: 1, sourceSemantic: 'publish', targetSemantic: 'consume', routingMode: 'async-publish' },
    ]
    project.topology.policies = [{ id: 'pressure', type: 'backpressure', version: 1, target: { kind: 'edge', id: 'publish' }, order: 0, enabled: true, config: { maxInFlight: 0, overflow: 'dead-letter' } }]
    const result = await runSimulation(project, 'dead-letter')
    expect(result.events.filter((event) => event.type === 'message-dead-lettered')).toHaveLength(result.summary.generatedRequests)
    expect(result.summary.completedRequests).toBe(result.summary.generatedRequests)
    expect(result.summary.failedRequests).toBe(0)
  })

  it('releases edge and consumer backpressure gates after asynchronous delivery completes', async () => {
    const project = directProject(5)
    project.topology.nodes[0] = createRegisteredNode('service', 'producer', { x: 0, y: 0 })
    project.topology.nodes.unshift(createRegisteredNode('traffic', 'traffic', { x: -100, y: 0 }))
    project.topology.nodes.push(createRegisteredNode('queue', 'consumer', { x: 200, y: 0 }))
    project.topology.edges = [
      { id: 'entry', source: 'traffic', target: 'producer', sourcePort: 'out', targetPort: 'in', weight: 1, sourceSemantic: 'request', targetSemantic: 'request', routingMode: 'weighted-one' },
      { id: 'publish', source: 'producer', target: 'consumer', sourcePort: 'publish', targetPort: 'consume', weight: 1, sourceSemantic: 'publish', targetSemantic: 'consume', routingMode: 'async-publish' },
    ]
    const producer = project.topology.nodes.find((node) => node.id === 'producer')!
    const consumer = project.topology.nodes.find((node) => node.id === 'consumer')!
    producer.config = { ...producer.config, serviceTimeMs: 1, jitterMs: 0, errorRate: 0 }
    consumer.config = { ...consumer.config, consumers: 1, deliveryTimeMs: 1, jitterMs: 0, errorRate: 0 }
    project.topology.policies = [
      { id: 'edge-pressure', type: 'backpressure', version: 1, target: { kind: 'edge', id: 'publish' }, order: 0, enabled: true, config: { maxInFlight: 1, overflow: 'reject' } },
      { id: 'node-pressure', type: 'backpressure', version: 1, target: { kind: 'node', id: 'consumer' }, order: 0, enabled: true, config: { maxInFlight: 1, overflow: 'reject' } },
    ]

    const result = await runSimulation(project, 'backpressure-release')
    expect(result.events.filter((event) => event.type === 'message-published')).toHaveLength(result.summary.generatedRequests)
    expect(result.events.filter((event) => event.type === 'message-acknowledged')).toHaveLength(result.summary.generatedRequests)
    expect(result.events.some((event) => event.reason === 'backpressure')).toBe(false)
  })

  it('rolls back an admitted edge gate when the consumer gate rejects delivery', async () => {
    const project = directProject(2)
    project.topology.nodes[0] = createRegisteredNode('service', 'producer', { x: 0, y: 0 })
    project.topology.nodes.unshift(createRegisteredNode('traffic', 'traffic', { x: -100, y: 0 }))
    project.topology.nodes.push(createRegisteredNode('queue', 'consumer', { x: 200, y: 0 }))
    project.topology.edges = [
      { id: 'entry', source: 'traffic', target: 'producer', sourcePort: 'out', targetPort: 'in', weight: 1, sourceSemantic: 'request', targetSemantic: 'request', routingMode: 'weighted-one' },
      { id: 'publish', source: 'producer', target: 'consumer', sourcePort: 'publish', targetPort: 'consume', weight: 1, sourceSemantic: 'publish', targetSemantic: 'consume', routingMode: 'async-publish' },
    ]
    project.topology.policies = [
      { id: 'edge-pressure', type: 'backpressure', version: 1, target: { kind: 'edge', id: 'publish' }, order: 0, enabled: true, config: { maxInFlight: 1, overflow: 'reject' } },
      { id: 'node-pressure', type: 'backpressure', version: 1, target: { kind: 'node', id: 'consumer' }, order: 0, enabled: true, config: { maxInFlight: 0, overflow: 'dead-letter' } },
    ]

    const result = await runSimulation(project, 'backpressure-rollback')
    const overflow = result.events.filter((event) => event.type === 'message-dead-lettered')
    expect(overflow).toHaveLength(result.summary.generatedRequests)
    expect(overflow.every((event) => event.reason === 'dead_lettered' && event.status === 'rejected')).toBe(true)
    expect(result.summary.completedRequests).toBe(result.summary.generatedRequests)
    expect(result.summary.failedRequests).toBe(0)
  })
})
