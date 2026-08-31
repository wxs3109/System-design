import { describe, expect, it } from 'vitest'
import { createRegisteredNode } from '@system-design/components'
import { createEmptyProject, projectFileV3Schema, type ProjectFile } from '@system-design/model'
import { runSimulation } from './engine'

const connection = (id: string, source: string, target: string) => ({
  id, source, target, sourcePort: 'out', targetPort: 'in', weight: 1,
  sourceSemantic: 'request' as const, targetSemantic: 'request' as const, routingMode: 'weighted-one' as const,
})

const realtimeProject = (id: string, overrides: {
  maxConnections?: number
  connectionDurationMs?: number
  channelPattern?: string
  messageBytes?: number
  outboundBandwidthMbps?: number
  slowConnectionFraction?: number
  slowConnectionBandwidthMbps?: number
  maxPendingBytesPerConnection?: number
  overflowPolicy?: 'drop-message' | 'disconnect'
  traceLimit?: number
  requestsPerSecond?: number
  durationSeconds?: number
} = {}): ProjectFile => {
  const project = createEmptyProject(id)
  project.name = id
  project.modelingMode = 'business-aware'
  const traffic = createRegisteredNode('traffic', 'clients', { x: 0, y: 0 }, 'legacy-load')
  const service = createRegisteredNode('service', 'api', { x: 200, y: 0 })
  const gateway = createRegisteredNode('realtime-gateway', 'gateway', { x: 400, y: 0 })
  if (gateway.type !== 'realtime-gateway' || service.type !== 'service') throw new Error('Expected fixture nodes')
  service.config = { ...service.config, replicas: 10, concurrencyPerReplica: 100, serviceTimeMs: 0.1, jitterMs: 0, errorRate: 0 }
  gateway.config = {
    ...gateway.config, maxConnections: overrides.maxConnections ?? 1_000, connectionDurationMs: overrides.connectionDurationMs ?? 10_000,
    maxChannelsPerConnection: 2, defaultChannelCount: 100, maxConcurrentMessages: 1_000, handshakeTimeMs: 0.1,
    broadcastBaseTimeMs: 0.1, fanOutTimePerConnectionMs: 0, defaultMessageBytes: overrides.messageBytes ?? 128,
    outboundBandwidthMbps: overrides.outboundBandwidthMbps ?? 10, slowConnectionFraction: overrides.slowConnectionFraction ?? 0,
    slowConnectionBandwidthMbps: overrides.slowConnectionBandwidthMbps ?? 0.01,
    maxPendingBytesPerConnection: overrides.maxPendingBytesPerConnection ?? 1_000_000, overflowPolicy: overrides.overflowPolicy ?? 'drop-message',
    jitterMs: 0, errorRate: 0, maxQueueSize: 10_000,
  }
  project.topology.nodes = [traffic, service, gateway]
  project.topology.edges = [connection('clients-to-api', 'clients', 'api'), connection('api-to-gateway', 'api', 'gateway')]
  project.definitions = {
    schemaVersion: 1, jsonSchemas: [], dataModels: [], events: [], cacheKeys: [], workflows: [],
    apis: [{ id: 'realtime-api', version: 1, name: 'Realtime API', ownerNodeId: 'api', operations: [{ id: 'send', name: 'Send', method: 'POST', path: '/send', responses: [{ statusCode: '202' }], handlerTimeMs: 0.1 }] }],
    interactions: [{
      id: 'realtime-flow', version: 1, name: 'Connect and send', entryOperation: { apiId: 'realtime-api', apiVersion: 1, operationId: 'send' },
      actions: [
        { id: 'accept', kind: 'api-call', dependsOn: [], sourceNodeId: 'clients', targetNodeId: 'api', operation: { apiId: 'realtime-api', apiVersion: 1, operationId: 'send' } },
        { id: 'connect', kind: 'realtime', dependsOn: ['accept'], nodeId: 'gateway', operation: 'connect', connectionPattern: 'client:{request}', channelPattern: overrides.channelPattern ?? 'room:shared' },
        { id: 'broadcast', kind: 'realtime', dependsOn: ['connect'], nodeId: 'gateway', operation: 'broadcast', connectionPattern: 'client:{request}', channelPattern: overrides.channelPattern ?? 'room:shared', messageBytes: overrides.messageBytes ?? 128 },
      ],
    }],
  }
  const experiment = project.experiments[0]!
  experiment.seed = `${id}-seed`
  experiment.workloads = [{ id: 'legacy-load', name: 'Compatibility load', sourceNodeId: 'clients', requestsPerSecond: 1, startAtSeconds: 5, durationSeconds: 1, pattern: 'constant', requestBytes: 128 }]
  experiment.operationWorkloads = [{
    id: 'realtime-operations', name: 'Realtime operations', sourceNodeId: 'clients',
    phases: [{ id: 'load', startAtSeconds: 0, durationSeconds: overrides.durationSeconds ?? 1, requestsPerSecond: overrides.requestsPerSecond ?? 10, pattern: 'constant' }],
    operationMix: [{ operation: { apiId: 'realtime-api', apiVersion: 1, operationId: 'send' }, interaction: { interactionId: 'realtime-flow', interactionVersion: 1 }, weight: 1, requestBytes: 128, keyDistribution: { kind: 'uniform', keySpaceSize: 1_000 } }],
  }]
  experiment.simulation = { durationSeconds: 2, sampleIntervalMs: 100, maxRequests: 1_000, traceLimit: overrides.traceLimit ?? 100, maxHops: 20 }
  return projectFileV3Schema.parse(project)
}

const details = (result: Awaited<ReturnType<typeof runSimulation>>) => result.nodes.find((node) => node.nodeId === 'gateway')!.details

describe('P2.6e executable Realtime Gateway behavior', () => {
  it('amplifies a shared channel while isolating per-key channels', async () => {
    const shared = await runSimulation(realtimeProject('realtime-shared'), 'realtime-shared-run')
    const isolated = await runSimulation(realtimeProject('realtime-isolated', { channelPattern: 'room:{key}' }), 'realtime-isolated-run')
    expect(Number(details(shared).realtimeMaximumChannelMembers)).toBeGreaterThan(1)
    expect(Number(details(shared).realtimeFanOutCopies)).toBeGreaterThan(Number(details(shared).realtimeBroadcasts))
    expect(Number(details(isolated).realtimeMaximumChannelMembers)).toBe(1)
    expect(Number(details(isolated).realtimeFanOutCopies)).toBe(Number(details(isolated).realtimeBroadcasts))
  })

  it('rejects excess long-lived connections and releases capacity after expiry', async () => {
    const bounded = await runSimulation(realtimeProject('realtime-capacity', { maxConnections: 2 }), 'realtime-capacity-run')
    expect(Number(details(bounded).realtimeAcceptedConnections)).toBe(2)
    expect(Number(details(bounded).realtimeRejectedConnections)).toBeGreaterThan(0)
    expect(bounded.summary.failedRequests).toBeGreaterThan(0)
    expect(bounded.events.some((event) => event.type === 'realtime-connection-rejected')).toBe(true)

    const expiring = await runSimulation(realtimeProject('realtime-expiry', { maxConnections: 2, connectionDurationMs: 80, requestsPerSecond: 5, durationSeconds: 1 }), 'realtime-expiry-run')
    expect(Number(details(expiring).realtimeAcceptedConnections)).toBeGreaterThan(2)
    expect(Number(details(expiring).realtimeExpiredConnections)).toBeGreaterThan(0)
  })

  it('makes message-drop and disconnect overflow policies diverge for slow clients', async () => {
    const base = { slowConnectionFraction: 1, slowConnectionBandwidthMbps: 0.001, messageBytes: 256, maxPendingBytesPerConnection: 512, requestsPerSecond: 20 }
    const dropped = await runSimulation(realtimeProject('realtime-drop', { ...base, overflowPolicy: 'drop-message' }), 'realtime-drop-run')
    const disconnected = await runSimulation(realtimeProject('realtime-disconnect', { ...base, overflowPolicy: 'disconnect' }), 'realtime-disconnect-run')
    expect(Number(details(dropped).realtimeDroppedCopies)).toBeGreaterThan(0)
    expect(Number(details(dropped).realtimeOverflowDisconnects)).toBe(0)
    expect(Number(details(disconnected).realtimeOverflowDisconnects)).toBeGreaterThan(0)
    expect(Number(details(disconnected).realtimeActiveConnections)).toBeLessThan(Number(details(dropped).realtimeActiveConnections))
  })

  it('retains realtime action and node aggregates with traceLimit zero', async () => {
    const result = await runSimulation(realtimeProject('realtime-no-traces', { traceLimit: 0 }), 'realtime-no-traces-run')
    expect(result.traces).toHaveLength(0)
    expect(result.events.some((event) => event.requestId)).toBe(false)
    expect(Number(details(result).realtimeBroadcasts)).toBeGreaterThan(0)
    const broadcast = result.actions.find((action) => action.actionId === 'broadcast')
    expect(broadcast).toMatchObject({ actionKind: 'realtime', completed: 10, failed: 0 })
    expect(Number(broadcast?.details?.realtimeFanOut)).toBeGreaterThan(0)
    expect(broadcast?.details?.realtimeChannelId).toBe('room:shared')
  })

  it('replays realtime domain events deterministically', async () => {
    const project = realtimeProject('realtime-replay', { slowConnectionFraction: 0.5, requestsPerSecond: 15 })
    const first = await runSimulation(project, 'realtime-replay-run')
    const second = await runSimulation(structuredClone(project), 'realtime-replay-run')
    expect(second.events).toEqual(first.events)
    expect(second.nodes).toEqual(first.nodes)
  })

  it('executes capacity-only traffic as connect, join, and broadcast behavior', async () => {
    const project = realtimeProject('realtime-capacity-only')
    project.modelingMode = 'capacity-only'
    project.definitions = { schemaVersion: 1, jsonSchemas: [], apis: [], dataModels: [], events: [], cacheKeys: [], workflows: [], interactions: [] }
    project.experiments[0]!.operationWorkloads = []
    project.experiments[0]!.workloads = [{ id: 'legacy-load', name: 'Capacity load', sourceNodeId: 'clients', requestsPerSecond: 5, startAtSeconds: 0, durationSeconds: 1, pattern: 'constant', requestBytes: 128 }]
    const result = await runSimulation(projectFileV3Schema.parse(project), 'realtime-capacity-only-run')
    expect(Number(details(result).realtimeAcceptedConnections)).toBe(result.summary.generatedRequests)
    expect(Number(details(result).realtimeBroadcasts)).toBe(result.summary.generatedRequests)
    expect(Number(details(result).realtimeFanOutCopies)).toBe(Number(details(result).realtimeBroadcasts))
  })
})
