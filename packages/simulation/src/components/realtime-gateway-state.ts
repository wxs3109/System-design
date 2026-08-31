export interface RealtimeGatewayStateConfig {
  maxConnections: number
  connectionDurationMs?: number
  maxChannelsPerConnection: number
  maxMembersPerChannel?: number
  maxPendingBytesPerConnection: number
  outboundBandwidthMbps?: number
  slowConnectionBandwidthMbps?: number
  overflowPolicy?: 'drop-message' | 'disconnect'
}

export interface RealtimeConnection {
  id: string
  connectedAtMs: number
  expiresAtMs: number
  bandwidthMbps: number
  slow: boolean
}

export interface RealtimeBroadcast {
  id: number
  channelId: string
  bytes: number
  publishedAtMs: number
}

export interface RealtimeDelivery {
  connectionId: string
  broadcast: RealtimeBroadcast
}

export type RealtimeConnectionResult =
  | { accepted: true; connection: RealtimeConnection; alreadyConnected: boolean }
  | { accepted: false; reason: 'connection-capacity' }

export type RealtimeJoinResult =
  | { accepted: true; alreadyMember: boolean }
  | { accepted: false; reason: 'connection-channel-capacity' | 'channel-member-capacity' }

export interface RealtimeBroadcastResult {
  broadcast: RealtimeBroadcast
  memberCount: number
  excludedConnections: number
  enqueued: RealtimeDelivery[]
  backpressured: RealtimeDelivery[]
  disconnectedConnectionIds: string[]
}

interface ConnectionState {
  connection: RealtimeConnection
  channelIds: Set<string>
  pending: ScheduledRealtimeDelivery[]
  pendingBytes: number
  nextAvailableAtMs: number
  enqueued: number
  delivered: number
  backpressured: number
}

interface ScheduledRealtimeDelivery extends RealtimeDelivery {
  deliverAtMs: number
}

export interface RealtimeAdvanceResult {
  expiredConnectionIds: string[]
  deliveredCopies: number
  deliveredBytes: number
}

const validateIdentifier = (value: string, label: string) => {
  if (value.trim().length === 0) throw new Error(`${label} must not be empty.`)
}

const validatePositiveInteger = (value: number, label: string) => {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} must be a positive integer.`)
}

const validateNonNegativeInteger = (value: number, label: string) => {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer.`)
}

const validatePositive = (value: number, label: string) => {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be positive.`)
}

/**
 * Models long-lived gateway connections, bidirectional channel membership,
 * broadcast amplification, and an independent outbound buffer per connection.
 */
export class RealtimeGatewayState {
  private readonly connections = new Map<string, ConnectionState>()
  private readonly channels = new Map<string, Set<string>>()
  private lastTimeMs = 0
  private nextBroadcastId = 0
  private peakConnections = 0
  private acceptedConnections = 0
  private rejectedConnections = 0
  private disconnectedConnections = 0
  private rejectedMemberships = 0
  private broadcasts = 0
  private publishedBytes = 0
  private attemptedFanOutCopies = 0
  private enqueuedCopies = 0
  private enqueuedBytes = 0
  private deliveredCopies = 0
  private deliveredBytes = 0
  private backpressuredCopies = 0
  private backpressuredBytes = 0
  private disconnectedDroppedCopies = 0
  private disconnectedDroppedBytes = 0
  private overflowDisconnects = 0
  private expiredConnections = 0
  private peakPendingBytes = 0

  constructor(readonly config: RealtimeGatewayStateConfig) {
    validatePositiveInteger(config.maxConnections, 'maxConnections')
    if (config.connectionDurationMs !== undefined) validatePositive(config.connectionDurationMs, 'connectionDurationMs')
    validatePositiveInteger(config.maxChannelsPerConnection, 'maxChannelsPerConnection')
    if (config.maxMembersPerChannel !== undefined) validatePositiveInteger(config.maxMembersPerChannel, 'maxMembersPerChannel')
    validateNonNegativeInteger(config.maxPendingBytesPerConnection, 'maxPendingBytesPerConnection')
    if (config.outboundBandwidthMbps !== undefined) validatePositive(config.outboundBandwidthMbps, 'outboundBandwidthMbps')
    if (config.slowConnectionBandwidthMbps !== undefined) validatePositive(config.slowConnectionBandwidthMbps, 'slowConnectionBandwidthMbps')
  }

  connect(connectionId: string, nowMs: number, options: { bandwidthMbps?: number; slow?: boolean } = {}): RealtimeConnectionResult {
    validateIdentifier(connectionId, 'Connection ID')
    if (options.bandwidthMbps !== undefined) validatePositive(options.bandwidthMbps, 'bandwidthMbps')
    this.validateTime(nowMs)
    this.advanceTo(nowMs)
    const current = this.connections.get(connectionId)
    if (current) {
      return { accepted: true, connection: current.connection, alreadyConnected: true }
    }
    if (this.connections.size >= this.config.maxConnections) {
      this.rejectedConnections += 1
      return { accepted: false, reason: 'connection-capacity' }
    }
    const durationMs = this.config.connectionDurationMs ?? Number.POSITIVE_INFINITY
    const bandwidthMbps = options.bandwidthMbps ?? this.config.outboundBandwidthMbps ?? 0
    const connection = { id: connectionId, connectedAtMs: nowMs, expiresAtMs: nowMs + durationMs, bandwidthMbps, slow: options.slow ?? false }
    this.connections.set(connectionId, { connection, channelIds: new Set(), pending: [], pendingBytes: 0, nextAvailableAtMs: nowMs, enqueued: 0, delivered: 0, backpressured: 0 })
    this.acceptedConnections += 1
    this.peakConnections = Math.max(this.peakConnections, this.connections.size)
    return { accepted: true, connection, alreadyConnected: false }
  }

  disconnect(connectionId: string, nowMs: number) {
    validateIdentifier(connectionId, 'Connection ID')
    this.validateTime(nowMs)
    this.advanceTo(nowMs)
    return this.removeConnection(connectionId, nowMs)
  }

  join(connectionId: string, channelId: string, nowMs: number): RealtimeJoinResult {
    validateIdentifier(connectionId, 'Connection ID')
    validateIdentifier(channelId, 'Channel ID')
    this.validateTime(nowMs)
    this.requireConnection(connectionId)
    this.advanceTo(nowMs)
    const connection = this.requireConnection(connectionId)
    if (connection.channelIds.has(channelId)) {
      return { accepted: true, alreadyMember: true }
    }
    if (connection.channelIds.size >= this.config.maxChannelsPerConnection) {
      this.rejectedMemberships += 1
      return { accepted: false, reason: 'connection-channel-capacity' }
    }
    const members = this.channels.get(channelId)
    if (members && members.size >= (this.config.maxMembersPerChannel ?? this.config.maxConnections)) {
      this.rejectedMemberships += 1
      return { accepted: false, reason: 'channel-member-capacity' }
    }
    const nextMembers = members ?? new Set<string>()
    nextMembers.add(connectionId)
    this.channels.set(channelId, nextMembers)
    connection.channelIds.add(channelId)
    return { accepted: true, alreadyMember: false }
  }

  leave(connectionId: string, channelId: string, nowMs: number) {
    validateIdentifier(connectionId, 'Connection ID')
    validateIdentifier(channelId, 'Channel ID')
    this.validateTime(nowMs)
    this.requireConnection(connectionId)
    this.advanceTo(nowMs)
    this.requireConnection(connectionId)
    return { left: this.removeMembership(connectionId, channelId) }
  }

  channelMemberCount(channelId: string) {
    validateIdentifier(channelId, 'Channel ID')
    return this.channels.get(channelId)?.size ?? 0
  }

  broadcast(channelId: string, bytes: number, nowMs: number, options: { excludeConnectionId?: string } = {}): RealtimeBroadcastResult {
    validateIdentifier(channelId, 'Channel ID')
    validatePositiveInteger(bytes, 'bytes')
    if (options.excludeConnectionId !== undefined) validateIdentifier(options.excludeConnectionId, 'Excluded connection ID')
    this.validateTime(nowMs)
    this.advanceTo(nowMs)
    const broadcast = { id: this.nextBroadcastId++, channelId, bytes, publishedAtMs: nowMs }
    const members = [...(this.channels.get(channelId) ?? [])].sort()
    const recipients = members.filter((connectionId) => connectionId !== options.excludeConnectionId)
    const enqueued: RealtimeDelivery[] = []
    const backpressured: RealtimeDelivery[] = []
    const disconnectedConnectionIds: string[] = []
    for (const connectionId of recipients) {
      const state = this.connections.get(connectionId)
      if (!state) continue
      const delivery = { connectionId, broadcast }
      if (state.pendingBytes + bytes > this.config.maxPendingBytesPerConnection) {
        state.backpressured += 1
        backpressured.push(delivery)
        if (this.config.overflowPolicy === 'disconnect') {
          this.removeConnection(connectionId, nowMs)
          this.overflowDisconnects += 1
          disconnectedConnectionIds.push(connectionId)
        }
      } else {
        const transferTimeMs = state.connection.bandwidthMbps === 0 ? Number.POSITIVE_INFINITY : (bytes * 8) / (state.connection.bandwidthMbps * 1_000)
        state.nextAvailableAtMs = Math.max(nowMs, state.nextAvailableAtMs) + transferTimeMs
        state.pending.push({ ...delivery, deliverAtMs: state.nextAvailableAtMs })
        state.pendingBytes += bytes
        state.enqueued += 1
        enqueued.push(delivery)
      }
    }
    this.broadcasts += 1
    this.publishedBytes += bytes
    this.attemptedFanOutCopies += recipients.length
    this.enqueuedCopies += enqueued.length
    this.enqueuedBytes += enqueued.length * bytes
    this.backpressuredCopies += backpressured.length
    this.backpressuredBytes += backpressured.length * bytes
    this.peakPendingBytes = Math.max(this.peakPendingBytes, this.totalPendingBytes())
    return { broadcast, memberCount: members.length, excludedConnections: members.length - recipients.length, enqueued, backpressured, disconnectedConnectionIds }
  }

  drain(connectionId: string, maxMessages: number, nowMs: number) {
    validateIdentifier(connectionId, 'Connection ID')
    validatePositiveInteger(maxMessages, 'maxMessages')
    this.validateTime(nowMs)
    this.requireConnection(connectionId)
    this.advanceTo(nowMs)
    const state = this.requireConnection(connectionId)
    const deliveries = state.pending.splice(0, maxMessages)
    const bytes = deliveries.reduce((total, delivery) => total + delivery.broadcast.bytes, 0)
    state.pendingBytes -= bytes
    state.delivered += deliveries.length
    this.deliveredCopies += deliveries.length
    this.deliveredBytes += bytes
    return { deliveries, bytes, pendingMessages: state.pending.length, pendingBytes: state.pendingBytes }
  }

  advanceTo(nowMs: number): RealtimeAdvanceResult {
    this.validateTime(nowMs)
    this.advance(nowMs)
    const expiredConnectionIds: string[] = []
    let deliveredCopies = 0
    let deliveredBytes = 0
    for (const [connectionId, state] of [...this.connections].sort(([left], [right]) => left.localeCompare(right))) {
      const deliveryCutoffMs = Math.min(nowMs, state.connection.expiresAtMs)
      let count = 0
      while (count < state.pending.length && state.pending[count]!.deliverAtMs <= deliveryCutoffMs) count += 1
      if (count > 0) {
        const deliveries = state.pending.splice(0, count)
        const bytes = deliveries.reduce((total, delivery) => total + delivery.broadcast.bytes, 0)
        state.pendingBytes -= bytes
        state.delivered += deliveries.length
        this.deliveredCopies += deliveries.length
        this.deliveredBytes += bytes
        deliveredCopies += deliveries.length
        deliveredBytes += bytes
      }
      if (state.connection.expiresAtMs <= nowMs) {
        this.removeConnection(connectionId, state.connection.expiresAtMs)
        this.expiredConnections += 1
        expiredConnectionIds.push(connectionId)
      }
    }
    return { expiredConnectionIds, deliveredCopies, deliveredBytes }
  }

  snapshot(nowMs: number) {
    const advanced = this.advanceTo(nowMs)
    const connections = [...this.connections.values()]
      .sort((left, right) => left.connection.id.localeCompare(right.connection.id))
      .map((state) => ({
        connectionId: state.connection.id, connectedAtMs: state.connection.connectedAtMs, connectedDurationMs: nowMs - state.connection.connectedAtMs,
        channelIds: [...state.channelIds].sort(), pendingMessages: state.pending.length, pendingBytes: state.pendingBytes,
        enqueued: state.enqueued, delivered: state.delivered, backpressured: state.backpressured,
      }))
    const channels = [...this.channels]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([channelId, members]) => ({ channelId, connectionIds: [...members].sort(), members: members.size }))
    return {
      activeConnections: connections.length, peakConnections: this.peakConnections, acceptedConnections: this.acceptedConnections,
      rejectedConnections: this.rejectedConnections, disconnectedConnections: this.disconnectedConnections, expiredConnections: this.expiredConnections, activeChannels: channels.length,
      channelMemberships: channels.reduce((total, channel) => total + channel.members, 0), maximumChannelMembers: Math.max(0, ...channels.map((channel) => channel.members)),
      rejectedMemberships: this.rejectedMemberships, broadcasts: this.broadcasts, publishedBytes: this.publishedBytes,
      attemptedFanOutCopies: this.attemptedFanOutCopies, enqueuedCopies: this.enqueuedCopies, enqueuedBytes: this.enqueuedBytes,
      deliveredCopies: this.deliveredCopies, deliveredBytes: this.deliveredBytes, backpressuredCopies: this.backpressuredCopies,
      backpressuredBytes: this.backpressuredBytes, overflowDisconnects: this.overflowDisconnects,
      disconnectedDroppedCopies: this.disconnectedDroppedCopies, disconnectedDroppedBytes: this.disconnectedDroppedBytes,
      pendingMessages: connections.reduce((total, connection) => total + connection.pendingMessages, 0),
      pendingBytes: connections.reduce((total, connection) => total + connection.pendingBytes, 0), peakPendingBytes: this.peakPendingBytes,
      expiredConnectionIds: advanced.expiredConnectionIds, drainedDeliveries: advanced.deliveredCopies, drainedBytes: advanced.deliveredBytes, connections, channels,
    }
  }

  private removeMembership(connectionId: string, channelId: string) {
    const connection = this.connections.get(connectionId)
    if (!connection?.channelIds.delete(channelId)) return false
    const members = this.channels.get(channelId)
    members?.delete(connectionId)
    if (members?.size === 0) this.channels.delete(channelId)
    return true
  }

  private removeConnection(connectionId: string, nowMs: number) {
    const state = this.connections.get(connectionId)
    if (!state) return { disconnected: false as const, dropped: [] as RealtimeDelivery[], droppedBytes: 0, channelIds: [] as string[] }
    const channelIds = [...state.channelIds].sort()
    for (const channelId of channelIds) this.removeMembership(connectionId, channelId)
    this.connections.delete(connectionId)
    this.disconnectedConnections += 1
    this.disconnectedDroppedCopies += state.pending.length
    this.disconnectedDroppedBytes += state.pendingBytes
    return {
      disconnected: true as const, connection: state.connection, connectedDurationMs: nowMs - state.connection.connectedAtMs,
      dropped: [...state.pending], droppedBytes: state.pendingBytes, channelIds,
    }
  }

  private requireConnection(connectionId: string) {
    const connection = this.connections.get(connectionId)
    if (!connection) throw new Error(`Unknown connection ${connectionId}.`)
    return connection
  }

  private totalPendingBytes() {
    let bytes = 0
    for (const connection of this.connections.values()) bytes += connection.pendingBytes
    return bytes
  }

  private validateTime(nowMs: number) {
    if (!Number.isFinite(nowMs) || nowMs < this.lastTimeMs) throw new Error('Virtual time must be finite and monotonic.')
  }

  private advance(nowMs: number) {
    this.lastTimeMs = nowMs
  }
}
