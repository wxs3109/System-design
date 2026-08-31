import { describe, expect, it } from 'vitest'
import { createNode } from '@system-design/model'
import type { CompiledOperationAction } from '../compiler/operation-plan'
import { createComponentStateRuntime, type StatefulRequest } from './data-runtime'

const request = (id: number, operation: 'connect' | 'broadcast' | 'disconnect'): StatefulRequest => ({
  id, spanId: `span:${id}`, bytes: 128, key: 'shared',
  operationAction: {
    id: `${operation}:${id}`, kind: 'realtime', dependsOn: [], nodeId: 'gateway', edgeIds: [], handlerTimeMs: 0, descriptiveFields: [],
    realtime: { operation, connectionPattern: 'client:shared', channelPattern: 'room:{key}', messageBytes: 128 },
  } satisfies CompiledOperationAction,
})

const createRuntime = (slowConnectionFraction = 0) => {
  const gateway = createNode('realtime-gateway', 'gateway', { x: 0, y: 0 })
  if (gateway.type !== 'realtime-gateway') throw new Error('Expected Realtime Gateway')
  gateway.config = {
    ...gateway.config, connectionDurationMs: 10_000, outboundBandwidthMbps: 1, slowConnectionBandwidthMbps: 0.1,
    slowConnectionFraction, maxPendingBytesPerConnection: 1_000, jitterMs: 0, errorRate: 0,
  }
  return createComponentStateRuntime(gateway)!
}

const eventsOf = (completion: ReturnType<ReturnType<typeof createRuntime>['complete']>) => Array.isArray(completion) ? completion : completion.events

describe('Realtime Gateway component runtime', () => {
  it('commits connect and broadcast state only after successful completion', () => {
    const runtime = createRuntime()
    const connect = request(1, 'connect')
    expect(runtime.begin(connect, 0, () => 0).events).toEqual([])
    expect(runtime.snapshot(0).metrics).toMatchObject({ realtimeActiveConnections: 0, realtimeBroadcasts: 0 })
    expect(eventsOf(runtime.complete(connect, false, 1))).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'realtime-operation-failed' })]))
    expect(runtime.snapshot(1).metrics).toMatchObject({ realtimeActiveConnections: 0, realtimeBroadcasts: 0 })

    runtime.begin(connect, 2, () => 0)
    expect(eventsOf(runtime.complete(connect, true, 3))).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'realtime-connection-opened' }),
      expect.objectContaining({ type: 'realtime-channel-joined' }),
    ]))
    expect(runtime.snapshot(3).metrics).toMatchObject({ realtimeActiveConnections: 1, realtimeChannelMemberships: 1 })

    const broadcast = request(2, 'broadcast')
    expect(runtime.begin(broadcast, 4, () => 0).patch).toMatchObject({ realtimeFanOut: 1, realtimeChannelId: 'room:shared' })
    runtime.complete(broadcast, false, 5)
    expect(runtime.snapshot(5).metrics).toMatchObject({ realtimeBroadcasts: 0, realtimePendingMessages: 0 })
    runtime.begin(broadcast, 6, () => 0)
    expect(eventsOf(runtime.complete(broadcast, true, 7))).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'realtime-broadcast', attributes: expect.objectContaining({ fanOut: 1 }) })]))
    expect(runtime.snapshot(7).metrics).toMatchObject({ realtimeBroadcasts: 1, realtimeFanOutCopies: 1, realtimePendingMessages: 1 })
  })

  it('does not disconnect an existing client when the disconnect operation fails', () => {
    const runtime = createRuntime()
    const connect = request(1, 'connect')
    runtime.begin(connect, 0, () => 0)
    runtime.complete(connect, true, 1)
    const disconnect = request(2, 'disconnect')
    runtime.begin(disconnect, 2, () => 0)
    runtime.complete(disconnect, false, 3)
    expect(runtime.snapshot(3).metrics).toMatchObject({ realtimeActiveConnections: 1, realtimeDisconnectedConnections: 0 })
  })

  it('reports the original slow-client classification when an active connection is reused', () => {
    const runtime = createRuntime(0.5)
    const connect = request(1, 'connect')
    runtime.begin(connect, 0, () => 0)
    runtime.complete(connect, true, 1)

    runtime.begin(connect, 2, () => 1)
    expect(eventsOf(runtime.complete(connect, true, 3))).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'realtime-connection-opened',
        attributes: expect.objectContaining({ alreadyConnected: true, slow: true }),
      }),
    ]))
  })
})
