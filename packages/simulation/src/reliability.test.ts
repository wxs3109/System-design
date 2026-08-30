import { describe, expect, it } from 'vitest'
import { createEmptyProject, spanSchema, type ProjectFileV2 } from '@system-design/model'
import { createRegisteredNode } from '@system-design/components'
import { runSimulation } from './engine'

const reliabilityProject = (serviceTimeMs = 100): ProjectFileV2 => {
  const project = createEmptyProject('reliability')
  project.topology.nodes = [
    createRegisteredNode('traffic', 'traffic', { x: 0, y: 0 }),
    createRegisteredNode('service', 'caller', { x: 200, y: 0 }),
    createRegisteredNode('service', 'dependency', { x: 400, y: 0 }),
  ]
  const caller = project.topology.nodes.find((node) => node.id === 'caller')!
  const dependency = project.topology.nodes.find((node) => node.id === 'dependency')!
  caller.config = { ...caller.config, serviceTimeMs: 1, jitterMs: 0, errorRate: 0 }
  dependency.config = { ...dependency.config, serviceTimeMs, jitterMs: 0, errorRate: 0 }
  project.topology.edges = [
    { id: 'entry', source: 'traffic', target: 'caller', sourcePort: 'out', targetPort: 'in', weight: 1, sourceSemantic: 'request', targetSemantic: 'request', routingMode: 'weighted-one' },
    { id: 'dependency', source: 'caller', target: 'dependency', sourcePort: 'out', targetPort: 'in', weight: 1, sourceSemantic: 'request', targetSemantic: 'request', routingMode: 'weighted-one' },
  ]
  const experiment = project.experiments[0]!
  experiment.seed = 'reliability-seed'
  experiment.simulation.durationSeconds = 2
  experiment.workloads = [{ id: 'load', name: 'Load', sourceNodeId: 'traffic', requestsPerSecond: 1, startAtSeconds: 0, durationSeconds: 0.1, pattern: 'constant', requestBytes: 1 }]
  return project
}

describe('reliability policies in virtual time', () => {
  it('times out attempts and performs only the configured bounded retries', async () => {
    const project = reliabilityProject()
    project.topology.policies = [
      { id: 'timeout', type: 'timeout', version: 1, target: { kind: 'edge', id: 'dependency' }, order: 0, enabled: true, config: { timeoutMs: 10 } },
      { id: 'retry', type: 'retry', version: 1, target: { kind: 'edge', id: 'dependency' }, order: 1, enabled: true, config: { maxAttempts: 3, backoff: 'fixed', baseDelayMs: 5, maxDelayMs: 5, jitterRatio: 0 } },
    ]
    const result = await runSimulation(project, 'timeout-retry')
    expect(result.events.filter((event) => event.type === 'attempt-started')).toHaveLength(3)
    expect(result.events.filter((event) => event.type === 'timeout-fired')).toHaveLength(3)
    expect(result.events.filter((event) => event.type === 'retry-scheduled')).toHaveLength(2)
    expect(result.events.filter((event) => event.type === 'attempt-started').map((event) => event.attempt)).toEqual([1, 2, 3])
    expect(new Set(result.events.filter((event) => event.type === 'attempt-started').map((event) => event.spanId)).size).toBe(3)
    expect(result.events.filter((event) => event.type === 'request-failed' && event.attributes.terminal === true)).toHaveLength(1)
    expect(result.summary.failedRequests).toBe(1)
    expect(result.nodes.find((node) => node.nodeId === 'caller')?.processedRequests).toBe(1)
    expect(result.nodes.find((node) => node.nodeId === 'dependency')?.failedRequests).toBe(3)
    expect(result.spans.filter((span) => span.nodeId === 'dependency')).toHaveLength(3)
    expect(result.spans.filter((span) => span.nodeId === 'dependency').every((span) => span.reason === 'timeout')).toBe(true)
    expect(result.spans.filter((span) => span.nodeId === 'dependency').map((span) => span.attempt)).toEqual([1, 2, 3])
    expect(result.spans.filter((span) => span.nodeId === 'dependency').every((span) => span.durationMs === span.endedAtMs - span.startedAtMs)).toBe(true)
  })

  it('opens the circuit and later probes half-open before closing', async () => {
    const project = reliabilityProject(1)
    project.experiments[0]!.workloads[0] = { ...project.experiments[0]!.workloads[0]!, requestsPerSecond: 100, durationSeconds: 0.2 }
    project.experiments[0]!.faults = [{ id: 'temporary-outage', targetNodeId: 'dependency', type: 'node-down', startAtSeconds: 0, durationSeconds: 0.03, enabled: true }]
    project.topology.policies = [{ id: 'circuit', type: 'circuit-breaker', version: 1, target: { kind: 'edge', id: 'dependency' }, order: 0, enabled: true, config: { failureThreshold: 1, openDurationMs: 20, halfOpenMaxProbes: 1 } }]
    const result = await runSimulation(project, 'circuit-transitions')
    const transitions = result.events.filter((event) => event.type.startsWith('circuit-')).map((event) => event.type)
    expect(transitions).toContain('circuit-opened')
    expect(transitions).toContain('circuit-half-opened')
    expect(transitions).toContain('circuit-closed')
    expect(transitions.lastIndexOf('circuit-closed')).toBeGreaterThan(transitions.lastIndexOf('circuit-opened'))
    expect(result.events.some((event) => event.reason === 'circuit_open')).toBe(true)
  })

  it('replays jittered retry timing deterministically with a fixed seed', async () => {
    const project = reliabilityProject()
    project.topology.policies = [
      { id: 'timeout', type: 'timeout', version: 1, target: { kind: 'edge', id: 'dependency' }, order: 0, enabled: true, config: { timeoutMs: 10 } },
      { id: 'retry', type: 'retry', version: 1, target: { kind: 'edge', id: 'dependency' }, order: 1, enabled: true, config: { maxAttempts: 3, backoff: 'exponential', baseDelayMs: 5, maxDelayMs: 20, jitterRatio: 0.5 } },
    ]
    const first = await runSimulation(project, 'jitter-replay')
    const second = await runSimulation(structuredClone(project), 'jitter-replay')
    expect(second.events).toEqual(first.events)
  })

  it('continues after a successful protected call without processing its target twice', async () => {
    const project = reliabilityProject(1)
    project.topology.policies = [
      { id: 'timeout', type: 'timeout', version: 1, target: { kind: 'edge', id: 'dependency' }, order: 0, enabled: true, config: { timeoutMs: 50 } },
      { id: 'retry', type: 'retry', version: 1, target: { kind: 'edge', id: 'dependency' }, order: 1, enabled: true, config: { maxAttempts: 3, backoff: 'fixed', baseDelayMs: 0, maxDelayMs: 0, jitterRatio: 0 } },
    ]

    const result = await runSimulation(project, 'successful-protected-call')
    const dependencyStarts = result.events.filter((event) => event.type === 'request-started' && event.nodeId === 'dependency')
    const terminal = result.events.filter((event) => (event.type === 'request-completed' || event.type === 'request-failed') && event.attributes.terminal === true)
    expect(dependencyStarts).toHaveLength(result.summary.generatedRequests)
    expect(result.nodes.find((node) => node.nodeId === 'dependency')?.processedRequests).toBe(result.summary.generatedRequests)
    expect(terminal).toHaveLength(result.summary.generatedRequests)
    expect(result.summary.failedRequests).toBe(0)
  })

  it('continues through downstream nodes after a protected dependency succeeds', async () => {
    const project = reliabilityProject(1)
    project.topology.nodes.push(createRegisteredNode('database', 'downstream', { x: 600, y: 0 }))
    const downstream = project.topology.nodes.find((node) => node.id === 'downstream')!
    downstream.config = { ...downstream.config, queryTimeMs: 1, jitterMs: 0, errorRate: 0 }
    project.topology.edges.push({ id: 'downstream-edge', source: 'dependency', target: 'downstream', sourcePort: 'out', targetPort: 'in', weight: 1, sourceSemantic: 'request', targetSemantic: 'request', routingMode: 'weighted-one' })
    project.topology.policies = [{ id: 'timeout', type: 'timeout', version: 1, target: { kind: 'edge', id: 'dependency' }, order: 0, enabled: true, config: { timeoutMs: 50 } }]

    const result = await runSimulation(project, 'successful-protected-chain')
    expect(result.nodes.find((node) => node.nodeId === 'dependency')?.processedRequests).toBe(result.summary.generatedRequests)
    expect(result.nodes.find((node) => node.nodeId === 'downstream')?.processedRequests).toBe(result.summary.generatedRequests)
    expect(result.summary.completedRequests).toBe(result.summary.generatedRequests)
  })

  it('preserves fan-out aggregation when a protected branch succeeds', async () => {
    const project = reliabilityProject(1)
    project.topology.nodes.push(createRegisteredNode('service', 'sibling', { x: 400, y: 100 }))
    const sibling = project.topology.nodes.find((node) => node.id === 'sibling')!
    sibling.config = { ...sibling.config, serviceTimeMs: 1, jitterMs: 0, errorRate: 0 }
    project.topology.edges = [
      project.topology.edges[0]!,
      { ...project.topology.edges[1]!, routingMode: 'fan-out' },
      { id: 'sibling-edge', source: 'caller', target: 'sibling', sourcePort: 'out', targetPort: 'in', weight: 1, sourceSemantic: 'request', targetSemantic: 'request', routingMode: 'fan-out' },
    ]
    project.topology.policies = [{ id: 'timeout', type: 'timeout', version: 1, target: { kind: 'edge', id: 'dependency' }, order: 0, enabled: true, config: { timeoutMs: 50 } }]

    const result = await runSimulation(project, 'protected-fanout')
    expect(result.summary.completedRequests).toBe(result.summary.generatedRequests)
    expect(result.summary.failedRequests).toBe(0)
    expect(result.events.filter((event) => event.attributes.terminal === true)).toHaveLength(result.summary.generatedRequests)
  })

  it('preserves fan-out aggregation when a protected branch exhausts retries', async () => {
    const project = reliabilityProject(100)
    project.topology.nodes.push(createRegisteredNode('service', 'sibling', { x: 400, y: 100 }))
    const sibling = project.topology.nodes.find((node) => node.id === 'sibling')!
    sibling.config = { ...sibling.config, serviceTimeMs: 1, jitterMs: 0, errorRate: 0 }
    project.topology.edges = [
      project.topology.edges[0]!,
      { ...project.topology.edges[1]!, routingMode: 'fan-out' },
      { id: 'sibling-edge', source: 'caller', target: 'sibling', sourcePort: 'out', targetPort: 'in', weight: 1, sourceSemantic: 'request', targetSemantic: 'request', routingMode: 'fan-out' },
    ]
    project.topology.policies = [
      { id: 'timeout', type: 'timeout', version: 1, target: { kind: 'edge', id: 'dependency' }, order: 0, enabled: true, config: { timeoutMs: 10 } },
      { id: 'retry', type: 'retry', version: 1, target: { kind: 'edge', id: 'dependency' }, order: 1, enabled: true, config: { maxAttempts: 2, backoff: 'fixed', baseDelayMs: 0, maxDelayMs: 0, jitterRatio: 0 } },
    ]

    const result = await runSimulation(project, 'protected-fanout-failure')
    expect(result.summary.failedRequests).toBe(result.summary.generatedRequests)
    expect(result.events.filter((event) => event.type === 'request-failed' && event.attributes.terminal === true)).toHaveLength(result.summary.generatedRequests)
    expect(result.events.filter((event) => event.type === 'attempt-started')).toHaveLength(result.summary.generatedRequests * 2)
  })

  it('counts a protected hop exactly once when enforcing max hops downstream', async () => {
    const project = reliabilityProject(1)
    project.topology.nodes.push(createRegisteredNode('database', 'downstream', { x: 600, y: 0 }))
    project.topology.edges.push({ id: 'downstream-edge', source: 'dependency', target: 'downstream', sourcePort: 'out', targetPort: 'in', weight: 1, sourceSemantic: 'request', targetSemantic: 'request', routingMode: 'weighted-one' })
    project.experiments[0]!.simulation.maxHops = 2
    project.topology.policies = [{ id: 'timeout', type: 'timeout', version: 1, target: { kind: 'edge', id: 'dependency' }, order: 0, enabled: true, config: { timeoutMs: 50 } }]

    const result = await runSimulation(project, 'protected-hop-limit')
    expect(result.summary.failedRequests).toBe(result.summary.generatedRequests)
    expect(result.events.filter((event) => event.type === 'request-failed' && event.reason === 'hop_limit' && event.attributes.terminal === true)).toHaveLength(result.summary.generatedRequests)
    expect(result.nodes.find((node) => node.nodeId === 'downstream')?.processedRequests).toBe(0)
  })

  it('does not leak queued work or service capacity when attempts time out', async () => {
    const project = reliabilityProject(100)
    const dependency = project.topology.nodes.find((node) => node.id === 'dependency')!
    dependency.config = { ...dependency.config, replicas: 1, concurrencyPerReplica: 1, maxQueueSize: 1_000 }
    project.experiments[0]!.workloads[0] = { ...project.experiments[0]!.workloads[0]!, requestsPerSecond: 100, durationSeconds: 0.1 }
    project.topology.policies = [{ id: 'timeout', type: 'timeout', version: 1, target: { kind: 'edge', id: 'dependency' }, order: 0, enabled: true, config: { timeoutMs: 10 } }]

    const result = await runSimulation(project, 'timeout-capacity-release')
    const finalSnapshot = result.events.filter((event) => event.type === 'node-snapshot' && event.nodeId === 'dependency').at(-1)
    expect(result.summary.failedRequests).toBe(result.summary.generatedRequests)
    expect(finalSnapshot?.attributes.unitsInUse).toBe(0)
    expect(finalSnapshot?.attributes.queueLength).toBe(0)
  })

  it('keeps an attempt span anchored at call start while recording queue delay', async () => {
    const project = reliabilityProject(100)
    const dependency = project.topology.nodes.find((node) => node.id === 'dependency')!
    dependency.config = { ...dependency.config, replicas: 1, concurrencyPerReplica: 1, maxQueueSize: 1_000 }
    project.experiments[0]!.workloads[0] = { ...project.experiments[0]!.workloads[0]!, requestsPerSecond: 100, durationSeconds: 0.02 }
    project.topology.policies = [{ id: 'retry', type: 'retry', version: 1, target: { kind: 'edge', id: 'dependency' }, order: 0, enabled: true, config: { maxAttempts: 1, backoff: 'fixed', baseDelayMs: 0, maxDelayMs: 0, jitterRatio: 0 } }]

    const result = await runSimulation(project, 'queued-attempt-span')
    const attemptSpans = result.spans.filter((span) => span.edgeId === 'dependency')
    expect(result.spans.every((span) => spanSchema.safeParse(span).success)).toBe(true)
    expect(attemptSpans).toHaveLength(result.summary.generatedRequests)
    expect(attemptSpans.some((span) => span.queueDurationMs > 0)).toBe(true)
    expect(attemptSpans.every((span) => span.durationMs === span.endedAtMs - span.startedAtMs && span.queueDurationMs <= span.durationMs)).toBe(true)
  })
})
