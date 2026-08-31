import { describe, expect, it } from 'vitest'
import { RealtimeGatewayState, type RealtimeGatewayStateConfig } from './realtime-gateway-state'

const createState = (overrides: Partial<RealtimeGatewayStateConfig> = {}) => new RealtimeGatewayState({
  maxConnections: 3, maxChannelsPerConnection: 2, maxMembersPerChannel: 3, maxPendingBytesPerConnection: 200, ...overrides,
})

describe('RealtimeGatewayState', () => {
  it('enforces long-lived connection capacity and releases it on disconnect', () => {
    const state = createState({ maxConnections: 2 })
    expect(state.connect('client-a', 0)).toMatchObject({ accepted: true, alreadyConnected: false })
    expect(state.connect('client-a', 1)).toMatchObject({ accepted: true, alreadyConnected: true })
    expect(state.connect('client-b', 2)).toMatchObject({ accepted: true })
    expect(state.connect('client-c', 3)).toEqual({ accepted: false, reason: 'connection-capacity' })

    expect(state.disconnect('client-a', 10)).toMatchObject({ disconnected: true, connectedDurationMs: 10 })
    expect(state.connect('client-c', 11)).toMatchObject({ accepted: true })
    expect(state.snapshot(11)).toMatchObject({
      activeConnections: 2, peakConnections: 2, acceptedConnections: 3, rejectedConnections: 1, disconnectedConnections: 1,
    })
  })

  it('keeps connection bandwidth and slow-client classification fixed when reconnecting an active ID', () => {
    const state = createState({ connectionDurationMs: 100 })
    expect(state.connect('client-a', 0, { bandwidthMbps: 0.1, slow: true })).toMatchObject({
      accepted: true, alreadyConnected: false, connection: { bandwidthMbps: 0.1, slow: true, expiresAtMs: 100 },
    })
    expect(state.connect('client-a', 10, { bandwidthMbps: 10, slow: false })).toMatchObject({
      accepted: true, alreadyConnected: true, connection: { bandwidthMbps: 0.1, slow: true, expiresAtMs: 100 },
    })
  })

  it('maintains bidirectional membership and enforces both membership limits', () => {
    const state = createState({ maxChannelsPerConnection: 1, maxMembersPerChannel: 1 })
    state.connect('client-a', 0)
    state.connect('client-b', 0)
    expect(state.join('client-a', 'room-1', 1)).toEqual({ accepted: true, alreadyMember: false })
    expect(state.join('client-a', 'room-1', 2)).toEqual({ accepted: true, alreadyMember: true })
    expect(state.join('client-a', 'room-2', 3)).toEqual({ accepted: false, reason: 'connection-channel-capacity' })
    expect(state.join('client-b', 'room-1', 4)).toEqual({ accepted: false, reason: 'channel-member-capacity' })

    expect(state.leave('client-a', 'room-1', 5)).toEqual({ left: true })
    expect(state.join('client-b', 'room-1', 6)).toEqual({ accepted: true, alreadyMember: false })
    expect(state.snapshot(6)).toMatchObject({
      activeChannels: 1, channelMemberships: 1, maximumChannelMembers: 1, rejectedMemberships: 2,
      connections: [
        { connectionId: 'client-a', channelIds: [] },
        { connectionId: 'client-b', channelIds: ['room-1'] },
      ],
      channels: [{ channelId: 'room-1', connectionIds: ['client-b'], members: 1 }],
    })
  })

  it('amplifies a broadcast into per-connection queues and drains them in FIFO order', () => {
    const state = createState()
    for (const id of ['sender', 'client-a', 'client-b']) { state.connect(id, 0); state.join(id, 'room-1', 0) }

    const first = state.broadcast('room-1', 40, 1, { excludeConnectionId: 'sender' })
    const second = state.broadcast('room-1', 60, 2, { excludeConnectionId: 'sender' })
    expect(first).toMatchObject({ memberCount: 3, excludedConnections: 1, enqueued: [{ connectionId: 'client-a' }, { connectionId: 'client-b' }], backpressured: [] })
    expect(second.broadcast.id).toBe(1)
    expect(state.drain('client-a', 2, 3)).toMatchObject({
      deliveries: [{ broadcast: { id: 0 } }, { broadcast: { id: 1 } }], bytes: 100, pendingMessages: 0, pendingBytes: 0,
    })
    expect(state.snapshot(3)).toMatchObject({
      broadcasts: 2, publishedBytes: 100, attemptedFanOutCopies: 4, enqueuedCopies: 4, enqueuedBytes: 200,
      deliveredCopies: 2, deliveredBytes: 100, pendingMessages: 2, pendingBytes: 100,
    })
  })

  it('disconnects an overflowing slow connection when configured', () => {
    const state = createState({ maxPendingBytesPerConnection: 100, overflowPolicy: 'disconnect' })
    state.connect('slow', 0)
    state.join('slow', 'room-1', 0)
    state.broadcast('room-1', 80, 1)

    expect(state.broadcast('room-1', 40, 2)).toMatchObject({
      enqueued: [], backpressured: [{ connectionId: 'slow' }], disconnectedConnectionIds: ['slow'],
    })
    expect(state.snapshot(2)).toMatchObject({
      activeConnections: 0, activeChannels: 0, overflowDisconnects: 1, backpressuredCopies: 1, backpressuredBytes: 40,
      disconnectedDroppedCopies: 1, disconnectedDroppedBytes: 80, pendingMessages: 0, pendingBytes: 0,
    })
  })

  it('backpressures only slow connections while healthy connections keep receiving', () => {
    const state = createState({ maxPendingBytesPerConnection: 100 })
    for (const id of ['fast', 'slow']) { state.connect(id, 0); state.join(id, 'room-1', 0) }
    state.broadcast('room-1', 80, 1)
    state.drain('fast', 1, 2)

    const second = state.broadcast('room-1', 40, 3)
    expect(second.enqueued.map((delivery) => delivery.connectionId)).toEqual(['fast'])
    expect(second.backpressured.map((delivery) => delivery.connectionId)).toEqual(['slow'])
    expect(state.snapshot(3)).toMatchObject({
      attemptedFanOutCopies: 4, enqueuedCopies: 3, backpressuredCopies: 1, backpressuredBytes: 40, pendingBytes: 120,
      connections: [
        { connectionId: 'fast', pendingBytes: 40, delivered: 1, backpressured: 0 },
        { connectionId: 'slow', pendingBytes: 80, delivered: 0, backpressured: 1 },
      ],
    })
  })

  it('drops a disconnected connection queue and removes empty channels', () => {
    const state = createState()
    state.connect('client-a', 0)
    state.join('client-a', 'room-1', 1)
    state.broadcast('room-1', 50, 2)
    expect(state.disconnect('client-a', 5)).toMatchObject({ disconnected: true, dropped: [{ broadcast: { id: 0 } }], droppedBytes: 50, channelIds: ['room-1'] })
    expect(state.disconnect('client-a', 6)).toMatchObject({ disconnected: false })
    expect(state.snapshot(6)).toMatchObject({
      activeConnections: 0, activeChannels: 0, channelMemberships: 0, disconnectedDroppedCopies: 1, disconnectedDroppedBytes: 50, pendingBytes: 0,
    })
  })

  it('drains each outbound queue according to that connection bandwidth', () => {
    const state = createState({ outboundBandwidthMbps: 1, slowConnectionBandwidthMbps: 0.1, maxPendingBytesPerConnection: 20_000 })
    state.connect('fast', 0)
    state.connect('slow', 0, { bandwidthMbps: 0.1 })
    for (const id of ['fast', 'slow']) state.join(id, 'room-1', 0)
    state.broadcast('room-1', 10_000, 0)

    expect(state.advanceTo(100)).toEqual({ expiredConnectionIds: [], deliveredCopies: 1, deliveredBytes: 10_000 })
    expect(state.snapshot(100)).toMatchObject({
      deliveredCopies: 1, deliveredBytes: 10_000, pendingMessages: 1, pendingBytes: 10_000, peakPendingBytes: 20_000,
      connections: [
        { connectionId: 'fast', pendingMessages: 0, delivered: 1 },
        { connectionId: 'slow', pendingMessages: 1, delivered: 0 },
      ],
    })
    expect(state.advanceTo(800)).toEqual({ expiredConnectionIds: [], deliveredCopies: 1, deliveredBytes: 10_000 })
  })

  it('expires connection lifetimes after draining only deliveries that completed in time', () => {
    const state = createState({ connectionDurationMs: 100, outboundBandwidthMbps: 1, maxPendingBytesPerConnection: 20_000 })
    state.connect('client-a', 0)
    state.join('client-a', 'room-1', 0)
    state.broadcast('room-1', 10_000, 0) // 80 ms at 1 Mbps: delivered before expiry.
    state.broadcast('room-1', 10_000, 0) // Completes at 160 ms: dropped at expiry.

    expect(state.advanceTo(100)).toEqual({ expiredConnectionIds: ['client-a'], deliveredCopies: 1, deliveredBytes: 10_000 })
    expect(state.snapshot(100)).toMatchObject({
      activeConnections: 0, activeChannels: 0, expiredConnections: 1, disconnectedConnections: 1,
      deliveredCopies: 1, deliveredBytes: 10_000, disconnectedDroppedCopies: 1, disconnectedDroppedBytes: 10_000,
    })
  })

  it('validates operations before advancing virtual time', () => {
    expect(() => createState({ maxConnections: 0 })).toThrow('maxConnections')
    expect(() => createState({ maxChannelsPerConnection: 0 })).toThrow('maxChannelsPerConnection')
    expect(() => createState({ maxMembersPerChannel: 0 })).toThrow('maxMembersPerChannel')
    expect(() => createState({ maxPendingBytesPerConnection: -1 })).toThrow('maxPendingBytesPerConnection')
    expect(() => createState({ connectionDurationMs: 0 })).toThrow('connectionDurationMs')
    expect(() => createState({ outboundBandwidthMbps: 0 })).toThrow('outboundBandwidthMbps')

    const state = createState()
    state.connect('client-a', 1)
    expect(() => state.join('missing', 'room-1', 10)).toThrow('Unknown connection')
    expect(() => state.broadcast('room-1', 0, 10)).toThrow('bytes')
    expect(() => state.drain('client-a', 0, 10)).toThrow('maxMessages')
    expect(state.snapshot(2)).toMatchObject({ activeConnections: 1, broadcasts: 0 })
    expect(() => state.snapshot(1)).toThrow('monotonic')
  })
})
