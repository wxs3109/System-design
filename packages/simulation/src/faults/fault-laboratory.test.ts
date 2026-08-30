import { describe, expect, it } from 'vitest'
import { createEmptyProject, createNode, projectToScenario, type ProjectFileV2 } from '@system-design/model'
import { runSimulation } from '../engine'

const projectWithNetwork = (): ProjectFileV2 => {
  const project = createEmptyProject('fault-laboratory')
  const traffic = createNode('traffic', 'traffic', { x: 0, y: 0 }, 'load')
  const network = createNode('network', 'network', { x: 100, y: 0 })
  const service = createNode('service', 'service', { x: 200, y: 0 })
  network.config = { ...network.config, latencyMs: 1, jitterMs: 0, packetLossRate: 0 }
  service.config = { ...service.config, serviceTimeMs: 1, jitterMs: 0, errorRate: 0 }
  project.topology.nodes = [
    { ...traffic, componentVersion: 1, config: {} },
    { ...network, componentVersion: 1 },
    { ...service, componentVersion: 1 },
  ]
  project.topology.edges = [
    { id: 'network-link', source: 'traffic', target: 'network', sourcePort: 'out', targetPort: 'in', sourceSemantic: 'request', targetSemantic: 'request', routingMode: 'weighted-one', weight: 1 },
    { id: 'service-link', source: 'network', target: 'service', sourcePort: 'out', targetPort: 'in', sourceSemantic: 'request', targetSemantic: 'request', routingMode: 'weighted-one', weight: 1 },
  ]
  project.topology.groups = [{ id: 'region-a', name: 'Region A', kind: 'region', nodeIds: ['network', 'service'] }]
  project.experiments[0]!.workloads = [{ id: 'load', name: 'Load', sourceNodeId: 'traffic', requestsPerSecond: 20, startAtSeconds: 0, durationSeconds: 1, pattern: 'constant', requestBytes: 1_024 }]
  project.experiments[0]!.simulation = { durationSeconds: 1, sampleIntervalMs: 100, maxRequests: 100, traceLimit: 100, maxHops: 10 }
  project.experiments[0]!.seed = 'faults'
  return project
}

describe('fault laboratory runtime', () => {
  it('emits exact activation and recovery events for a moved fault window', async () => {
    const project = projectWithNetwork()
    project.experiments[0]!.faults = [{ id: 'down', type: 'node-down', target: { kind: 'node', id: 'service' }, startAtSeconds: 0.2, durationSeconds: 0.3, enabled: true }]
    const result = await runSimulation(project, 'fault-lifecycle')
    expect(result.events.filter((event) => event.attributes.faultId === 'down').map((event) => [event.type, event.timestampMs, event.reason])).toEqual([
      ['fault-activated', 200, 'node_down'],
      ['fault-recovered', 500, 'node_down'],
    ])
    expect(result.events.some((event) => event.type === 'request-failed' && event.reason === 'node_down' && event.timestampMs >= 200 && event.timestampMs < 500)).toBe(true)
  })

  it('does not schedule disabled faults', async () => {
    const project = projectWithNetwork()
    project.experiments[0]!.faults = [{ id: 'disabled-down', type: 'node-down', target: { kind: 'node', id: 'service' }, startAtSeconds: 0, durationSeconds: 1, enabled: false }]
    const result = await runSimulation(project, 'disabled-fault')
    expect(result.summary.failedRequests).toBe(0)
    expect(result.events.some((event) => event.type === 'fault-activated')).toBe(false)
  })

  it('does not invent lifecycle events beyond the simulated-time boundary', async () => {
    const project = projectWithNetwork()
    project.experiments[0]!.faults = [
      { id: 'active-at-end', type: 'node-down', target: { kind: 'node', id: 'service' }, startAtSeconds: 0.8, durationSeconds: 1, enabled: true },
      { id: 'after-run', type: 'node-down', target: { kind: 'node', id: 'service' }, startAtSeconds: 2, durationSeconds: 1, enabled: true },
    ]
    const result = await runSimulation(project, 'bounded-fault-lifecycle')
    expect(result.events.filter((event) => event.attributes.faultId === 'active-at-end').map((event) => event.type)).toEqual(['fault-activated'])
    expect(result.events.some((event) => event.attributes.faultId === 'after-run')).toBe(false)
  })

  it('applies link packet loss with a distinct reason', async () => {
    const project = projectWithNetwork()
    project.experiments[0]!.faults = [{ id: 'loss', type: 'packet-loss', target: { kind: 'edge', id: 'service-link' }, startAtSeconds: 0, durationSeconds: 1, factor: 1, enabled: true }]
    const result = await runSimulation(project, 'packet-loss')
    expect(result.summary.completedRequests).toBe(0)
    expect(result.events.some((event) => event.type === 'request-failed' && event.reason === 'packet_loss')).toBe(true)
  })

  it('expands a region at compile time and reports region outage', async () => {
    const project = projectWithNetwork()
    project.experiments[0]!.faults = [{ id: 'region-down', type: 'region-outage', target: { kind: 'group', id: 'region-a' }, startAtSeconds: 0, durationSeconds: 1, enabled: true }]
    const scenario = projectToScenario(project)
    expect(scenario.faults.map((fault) => fault.target)).toEqual(expect.arrayContaining([
      { kind: 'node', id: 'network' }, { kind: 'node', id: 'service' }, { kind: 'edge', id: 'network-link' }, { kind: 'edge', id: 'service-link' },
    ]))
    const result = await runSimulation(project, 'region-outage')
    expect(result.summary.completedRequests).toBe(0)
    expect(result.events.some((event) => event.type === 'request-failed' && event.reason === 'region_outage')).toBe(true)
    expect(result.events.filter((event) => event.type === 'fault-activated').every((event) => event.attributes.faultId === 'region-down')).toBe(true)
  })

  it('increases generated traffic only inside an active workload spike', async () => {
    const baseline = projectWithNetwork()
    baseline.experiments[0]!.faults = []
    const spiked = structuredClone(baseline)
    spiked.experiments[0]!.faults = [{ id: 'spike', type: 'traffic-spike', target: { kind: 'workload', id: 'load' }, startAtSeconds: 0.25, durationSeconds: 0.5, factor: 3, enabled: true }]
    const [normal, burst] = await Promise.all([runSimulation(baseline, 'normal'), runSimulation(spiked, 'spiked')])
    expect(normal.summary.generatedRequests).toBe(20)
    expect(burst.summary.generatedRequests).toBeGreaterThan(normal.summary.generatedRequests)
    expect(burst.events.filter((event) => event.type === 'request-generated' && event.timestampMs >= 250 && event.timestampMs < 750).length).toBeGreaterThan(normal.events.filter((event) => event.type === 'request-generated' && event.timestampMs >= 250 && event.timestampMs < 750).length)
  })

  it('composes overlapping node capacity drops and restores each boundary', async () => {
    const project = projectWithNetwork()
    const service = project.topology.nodes.find((node) => node.id === 'service')!
    service.config = { ...service.config, replicas: 4, concurrencyPerReplica: 1, serviceTimeMs: 20, jitterMs: 0, maxQueueSize: 0, errorRate: 0 }
    project.experiments[0]!.workloads[0] = { ...project.experiments[0]!.workloads[0]!, requestsPerSecond: 200 }
    project.experiments[0]!.faults = [
      { id: 'first', type: 'capacity-drop', target: { kind: 'node', id: 'service' }, startAtSeconds: 0.1, durationSeconds: 0.6, factor: 0.5, enabled: true },
      { id: 'second', type: 'capacity-drop', target: { kind: 'node', id: 'service' }, startAtSeconds: 0.3, durationSeconds: 0.6, factor: 0.5, enabled: true },
    ]
    const result = await runSimulation(project, 'overlap')
    const capacities = result.events.filter((event) => event.type === 'node-snapshot' && event.nodeId === 'service').map((event) => [event.timestampMs, event.attributes.capacity])
    expect(capacities).toEqual(expect.arrayContaining([[200, 2], [400, 1], [800, 2], [1_000, 4]]))
    expect(result.events.filter((event) => event.type.startsWith('fault-') && event.nodeId === 'service').map((event) => [event.type, event.timestampMs])).toEqual([
      ['fault-activated', 100], ['fault-activated', 300], ['fault-recovered', 700], ['fault-recovered', 900],
    ])
  })
})
