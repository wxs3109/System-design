import { describe, expect, it } from 'vitest'
import { createRegisteredNode } from '@system-design/components'
import { createEmptyProject, type ProjectFile } from '@system-design/model'
import { runSimulation } from './engine'

const edge = (id: string, source: string, target: string, sourcePort = 'out') => ({
  id, source, target, sourcePort, targetPort: 'in', weight: 1, routingMode: 'weighted-one' as const,
  sourceSemantic: (sourcePort === 'hit' ? 'hit' : sourcePort === 'miss' ? 'miss' : 'request') as 'request' | 'hit' | 'miss', targetSemantic: 'request' as const,
})

const deliveryProject = (id: string): ProjectFile => {
  const project = createEmptyProject(id)
  const traffic = createRegisteredNode('traffic', 'viewers', { x: 0, y: 0 }, 'views')
  const cdn = createRegisteredNode('cdn', 'edge-cdn', { x: 200, y: 0 })
  const cached = createRegisteredNode('service', 'cached-response', { x: 400, y: -100 })
  const origin = createRegisteredNode('object-storage', 'origin', { x: 400, y: 100 })
  Object.assign(cdn.config, { popCount: 2, popSelection: 'consistent-hash', capacityEntriesPerPop: 8, ttlMs: 60_000, keySpaceSize: 4, hotKeyProbability: 0, maxConcurrentRequests: 1_000, lookupTimeMs: 0.1, edgeLatencyMs: 2, edgeBandwidthMbps: 1_000, originRoundTripMs: 50, originBandwidthMbps: 100, defaultObjectSizeBytes: 1_000_000, jitterMs: 0, errorRate: 0 })
  Object.assign(cached.config, { serviceTimeMs: 0.1, jitterMs: 0, errorRate: 0 })
  Object.assign(origin.config, { baseLatencyMs: 0.1, jitterMs: 0, errorRate: 0, defaultObjectSizeBytes: 1_000_000 })
  project.topology.nodes = [traffic, cdn, cached, origin]
  project.topology.edges = [edge('to-cdn', 'viewers', 'edge-cdn'), edge('cdn-hit', 'edge-cdn', 'cached-response', 'hit'), edge('cdn-miss', 'edge-cdn', 'origin', 'miss')]
  const experiment = project.experiments[0]!
  experiment.seed = 'cdn-delivery'
  experiment.simulation = { durationSeconds: 3, sampleIntervalMs: 250, maxRequests: 1_000, traceLimit: 100, maxHops: 10 }
  experiment.workloads = [{ id: 'views', name: 'Video views', sourceNodeId: 'viewers', requestsPerSecond: 20, startAtSeconds: 0, durationSeconds: 2, pattern: 'constant', requestBytes: 256 }]
  return project
}

describe('P2.6b CDN behavior', () => {
  it('warms independent POP caches and avoids the origin on subsequent hits', async () => {
    const project = deliveryProject('video-delivery')
    const result = await runSimulation(project, 'cdn-warm')
    const details = result.nodes.find((node) => node.nodeId === 'edge-cdn')!.details
    const origin = result.nodes.find((node) => node.nodeId === 'origin')!
    expect(Number(details.cdnHitRate)).toBeGreaterThan(0.75)
    expect(Number(details.cdnOriginFetches)).toBeLessThan(result.summary.generatedRequests)
    expect(origin.processedRequests).toBe(Number(details.cdnOriginFetches))
    expect(result.events.some((event) => event.type === 'cdn-pop-selected')).toBe(true)
    expect(result.events.some((event) => event.type === 'cdn-cache-hit')).toBe(true)
    expect(result.events.some((event) => event.type === 'cdn-origin-fetch')).toBe(true)
  })

  it('makes TTL, capacity, and bandwidth change measured results deterministically', async () => {
    const warm = deliveryProject('cloud-drive-delivery')
    const constrained = structuredClone(warm)
    const fast = warm.topology.nodes.find((node) => node.type === 'cdn')!
    const slow = constrained.topology.nodes.find((node) => node.type === 'cdn')!
    Object.assign(fast.config, { capacityEntriesPerPop: 8, ttlMs: 60_000, edgeBandwidthMbps: 1_000 })
    Object.assign(slow.config, { capacityEntriesPerPop: 1, ttlMs: 1, edgeBandwidthMbps: 10 })
    const [baseline, candidate, replay] = await Promise.all([
      runSimulation(warm, 'cdn-fast'), runSimulation(constrained, 'cdn-slow'), runSimulation(structuredClone(constrained), 'cdn-slow'),
    ])
    const baselineDetails = baseline.nodes.find((node) => node.nodeId === 'edge-cdn')!.details
    const candidateDetails = candidate.nodes.find((node) => node.nodeId === 'edge-cdn')!.details
    expect(Number(candidateDetails.cdnHitRate)).toBeLessThan(Number(baselineDetails.cdnHitRate))
    expect(Number(candidateDetails.cdnOriginFetches)).toBeGreaterThan(Number(baselineDetails.cdnOriginFetches))
    expect(candidate.summary.latencyP95Ms).toBeGreaterThan(baseline.summary.latencyP95Ms)
    expect(replay.events).toEqual(candidate.events)
  })

  it('does not fill a POP or report an origin fetch when the origin fails', async () => {
    const project = deliveryProject('failed-origin')
    project.experiments[0]!.workloads[0] = { ...project.experiments[0]!.workloads[0]!, requestsPerSecond: 2, durationSeconds: 1 }
    const origin = project.topology.nodes.find((node) => node.id === 'origin')!
    origin.config = { ...origin.config, errorRate: 1 }
    const result = await runSimulation(project, 'cdn-failed-origin')
    const details = result.nodes.find((node) => node.nodeId === 'edge-cdn')!.details
    expect(Number(details.cdnHits)).toBe(0)
    expect(Number(details.cdnOriginFetches)).toBe(0)
    expect(result.events.filter((event) => event.type === 'cdn-origin-fetch')).toHaveLength(0)
  })

  it('distributes round-robin requests across POPs independently of object keys', async () => {
    const project = deliveryProject('round-robin-pops')
    const cdn = project.topology.nodes.find((node) => node.type === 'cdn')!
    Object.assign(cdn.config, { popCount: 2, popSelection: 'round-robin', keySpaceSize: 1, capacityEntriesPerPop: 1 })
    const result = await runSimulation(project, 'cdn-round-robin')
    const details = result.nodes.find((node) => node.nodeId === 'edge-cdn')!.details
    expect(Number(details.requestsByPop0)).toBe(Number(details.requestsByPop1))
    expect(Number(details.popRequestImbalance)).toBe(0)
    // Two requests per POP overlap before either origin response fills the
    // cache. CDN v1 exposes this stampede instead of coalescing those misses.
    expect(Number(details.cdnOriginFetches)).toBe(4)
    expect(Number(details.cdnOriginFetches)).toBeLessThan(result.summary.generatedRequests)
  })

  it('charges successful delivered bytes but excludes failed responses', async () => {
    const success = deliveryProject('successful-delivery-bytes')
    const failed = deliveryProject('failed-delivery-bytes')
    failed.topology.nodes.find((node) => node.id === 'origin')!.config = { ...failed.topology.nodes.find((node) => node.id === 'origin')!.config, errorRate: 1 }
    const [successResult, failedResult] = await Promise.all([runSimulation(success, 'successful-delivery-bytes'), runSimulation(failed, 'failed-delivery-bytes')])
    const successDetails = successResult.nodes.find((node) => node.nodeId === 'edge-cdn')!.details
    const failedDetails = failedResult.nodes.find((node) => node.nodeId === 'edge-cdn')!.details
    expect(Number(successDetails.cdnBytesServed)).toBeGreaterThan(0)
    expect(Number(failedDetails.cdnBytesServed)).toBe(0)
  })
})
