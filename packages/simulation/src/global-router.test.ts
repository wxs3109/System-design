import { describe, expect, it } from 'vitest'
import { createRegisteredNode } from '@system-design/components'
import { createEmptyProject, type ProjectConnection, type ProjectFile } from '@system-design/model'
import { runSimulation } from './engine'

const edge = (id: string, source: string, target: string, weight = 1): ProjectConnection => ({
  id, source, target, sourcePort: 'out', targetPort: 'in', weight, routingMode: 'weighted-one', sourceSemantic: 'request', targetSemantic: 'request',
})

const globalProject = (policy: 'geo' | 'weighted' | 'health-aware' = 'geo'): ProjectFile => {
  const project = createEmptyProject(`global-router-${policy}`)
  const westClients = createRegisteredNode('traffic', 'west-clients', { x: 0, y: 0 }, 'west-load')
  const eastClients = createRegisteredNode('traffic', 'east-clients', { x: 0, y: 180 }, 'east-load')
  const router = createRegisteredNode('global-router', 'global-router', { x: 240, y: 90 })
  const west = createRegisteredNode('service', 'west-api', { x: 520, y: 0 })
  const east = createRegisteredNode('service', 'east-api', { x: 520, y: 180 })
  if (router.type !== 'global-router' || west.type !== 'service' || east.type !== 'service') throw new Error('Expected Global Router and Service nodes.')
  router.config = { ...router.config, routingPolicy: policy, lookupTimeMs: 0.1, jitterMs: 0, decisionTtlMs: 500, healthCheckIntervalMs: 50, unhealthyThreshold: 1, healthyThreshold: 1, failoverDelayMs: 100 }
  west.config = { ...west.config, serviceTimeMs: 1, jitterMs: 0, errorRate: 0 }
  east.config = { ...east.config, serviceTimeMs: 1, jitterMs: 0, errorRate: 0 }
  project.topology.nodes = [westClients, eastClients, router, west, east]
  project.topology.edges = [edge('west-entry', westClients.id, router.id), edge('east-entry', eastClients.id, router.id), edge('west-route', router.id, west.id), edge('east-route', router.id, east.id)]
  project.topology.groups = [
    { id: 'region-west', name: 'West', kind: 'region', nodeIds: [westClients.id, west.id] },
    { id: 'region-east', name: 'East', kind: 'region', nodeIds: [eastClients.id, east.id] },
  ]
  const experiment = project.experiments[0]!
  experiment.seed = `global-router-${policy}`
  experiment.simulation = { durationSeconds: 2, sampleIntervalMs: 100, maxRequests: 1_000, traceLimit: 200, maxHops: 10 }
  experiment.workloads = [
    { id: 'west-load', name: 'West clients', sourceNodeId: westClients.id, requestsPerSecond: 10, startAtSeconds: 0, durationSeconds: 1, pattern: 'constant', requestBytes: 128 },
    { id: 'east-load', name: 'East clients', sourceNodeId: eastClients.id, requestsPerSecond: 10, startAtSeconds: 0, durationSeconds: 1, pattern: 'constant', requestBytes: 128 },
  ]
  return project
}

describe('Global Router runtime', () => {
  it('uses explicit client/target regions and cached geo decisions', async () => {
    const result = await runSimulation(globalProject(), 'geo-routing')
    const routeEvents = result.events.filter((event) => ['global-route-selected', 'global-route-cache-hit', 'global-route-cache-expired'].includes(event.type))
    expect(routeEvents.length).toBe(result.summary.generatedRequests)
    expect(routeEvents.every((event) => event.attributes.clientRegionId === event.attributes.selectedRegionId)).toBe(true)
    const details = result.nodes.find((node) => node.nodeId === 'global-router')!.details
    expect(Number(details.globalRouterCacheHits)).toBeGreaterThan(0)
    expect(Number(details.globalRouterGeoMatches)).toBe(result.summary.generatedRequests)
    expect(result.nodes.find((node) => node.nodeId === 'west-api')!.processedRequests).toBeGreaterThan(0)
    expect(result.nodes.find((node) => node.nodeId === 'east-api')!.processedRequests).toBeGreaterThan(0)
  })

  it('keeps stale cached health routes then exposes delayed failover deterministically', async () => {
    const project = globalProject('health-aware')
    project.experiments[0]!.workloads = [project.experiments[0]!.workloads[0]!]
    project.topology.nodes = project.topology.nodes.filter((node) => node.id !== 'east-clients')
    project.topology.edges = project.topology.edges.filter((candidate) => candidate.source !== 'east-clients')
    project.topology.groups.find((group) => group.id === 'region-east')!.nodeIds = ['east-api']
    project.topology.groups.push({ id: 'west-service-zone', name: 'West service zone', kind: 'zone', nodeIds: ['west-api'] })
    project.topology.edges.find((candidate) => candidate.id === 'west-route')!.weight = 1_000_000
    project.experiments[0]!.faults = [{ id: 'west-outage', type: 'region-outage', target: { kind: 'group', id: 'west-service-zone' }, startAtSeconds: 0.2, durationSeconds: 1, enabled: true }]
    const [result, replay] = await Promise.all([runSimulation(project, 'health-failover'), runSimulation(structuredClone(project), 'health-failover')])
    const transitions = result.events.filter((event) => event.type.startsWith('global-router-') || event.type.startsWith('global-route-')).map((event) => ({ type: event.type, timestampMs: event.timestampMs, edgeId: event.edgeId, attributes: event.attributes }))
    expect(result.events.some((event) => event.type === 'global-router-target-unhealthy')).toBe(true)
    expect(result.events.some((event) => event.type === 'global-router-failover' && Number(event.attributes.failoverDelayMs) >= 100)).toBe(true)
    expect(result.events.some((event) => event.type === 'global-router-target-recovered')).toBe(true)
    expect(result.nodes.find((node) => node.nodeId === 'east-api')!.processedRequests).toBeGreaterThan(0)
    expect(replay.events.filter((event) => event.type.startsWith('global-router-') || event.type.startsWith('global-route-')).map((event) => ({ type: event.type, timestampMs: event.timestampMs, edgeId: event.edgeId, attributes: event.attributes }))).toEqual(transitions)
  })

  it('keeps exact Global Router aggregates when request traces are disabled', async () => {
    const traced = globalProject('weighted')
    const aggregate = structuredClone(traced)
    aggregate.experiments[0]!.simulation.traceLimit = 0
    const [withTraces, withoutTraces] = await Promise.all([runSimulation(traced, 'global-traced'), runSimulation(aggregate, 'global-aggregate')])
    expect(withoutTraces.nodes.find((node) => node.nodeId === 'global-router')?.details).toEqual(withTraces.nodes.find((node) => node.nodeId === 'global-router')?.details)
  })
})
