export interface TopicStateConfig {
  subscriptionIds: readonly string[]
  retentionMs: number
  maxRetainedMessages: number
}

export interface TopicMessage {
  id: number
  key: string
  bytes: number
  publishedAtMs: number
  expiresAtMs: number
}

export interface TopicDelivery {
  subscriptionId: string
  message: TopicMessage
  attempt: number
  deliveredAtMs: number
}

export interface TopicExpiredDelivery {
  subscriptionId: string
  message: TopicMessage
  wasInFlight: boolean
  cause: 'time-retention' | 'capacity-retention'
}

export interface TopicPublishResult {
  message: TopicMessage
  fanOut: number
  expired: TopicExpiredDelivery[]
}

export interface TopicDeliveryResult {
  deliveries: TopicDelivery[]
  expired: TopicExpiredDelivery[]
}

export interface TopicAcknowledgeResult {
  acknowledged: TopicMessage[]
  expired: TopicExpiredDelivery[]
}

interface SubscriptionMessageState {
  attempt: number
  deliveredAtMs?: number
}

interface SubscriptionState {
  messages: Map<number, SubscriptionMessageState>
  delivered: number
  acknowledged: number
  expired: number
}

const assertVirtualTime = (nowMs: number, previousMs: number) => {
  if (!Number.isFinite(nowMs) || nowMs < previousMs) throw new Error('Virtual time must be finite and monotonic.')
}

/** Models durable topic fan-out and independent subscription acknowledgement state. */
export class TopicState {
  private readonly messages = new Map<number, TopicMessage>()
  private readonly subscriptions = new Map<string, SubscriptionState>()
  private nextMessageId = 0
  private lastTimeMs = 0
  private published = 0
  private publishedBytes = 0
  private fanOutCopies = 0
  private expiredMessages = 0
  private timeExpiredMessages = 0
  private capacityExpiredMessages = 0

  constructor(readonly config: TopicStateConfig) {
    if (!Number.isFinite(config.retentionMs) || config.retentionMs <= 0) throw new Error('retentionMs must be positive.')
    if (!Number.isInteger(config.maxRetainedMessages) || config.maxRetainedMessages < 1) throw new Error('maxRetainedMessages must be a positive integer.')
    if (config.subscriptionIds.length < 1) throw new Error('At least one subscription is required.')
    const ids = config.subscriptionIds.map((id) => id.trim())
    if (ids.some((id) => id.length === 0)) throw new Error('Subscription IDs must not be empty.')
    if (new Set(ids).size !== ids.length) throw new Error('Subscription IDs must be unique.')
    for (const id of ids) this.subscriptions.set(id, { messages: new Map(), delivered: 0, acknowledged: 0, expired: 0 })
  }

  publish(key: string, bytes: number, nowMs: number): TopicPublishResult {
    assertVirtualTime(nowMs, this.lastTimeMs)
    if (key.trim().length === 0) throw new Error('Message key must not be empty.')
    if (!Number.isInteger(bytes) || bytes < 0) throw new Error('bytes must be a non-negative integer.')
    const expired = this.expire(nowMs)
    while (this.messages.size >= this.config.maxRetainedMessages) {
      const oldest = this.messages.values().next().value as TopicMessage | undefined
      if (!oldest) break
      expired.push(...this.removeMessage(oldest, 'capacity-retention'))
    }
    const message: TopicMessage = { id: this.nextMessageId++, key, bytes, publishedAtMs: nowMs, expiresAtMs: nowMs + this.config.retentionMs }
    this.messages.set(message.id, message)
    for (const subscription of this.subscriptions.values()) subscription.messages.set(message.id, { attempt: 0 })
    this.published += 1
    this.publishedBytes += bytes
    this.fanOutCopies += this.subscriptions.size
    return { message, fanOut: this.subscriptions.size, expired }
  }

  deliver(subscriptionId: string, batchSize: number, nowMs: number): TopicDeliveryResult {
    assertVirtualTime(nowMs, this.lastTimeMs)
    if (!Number.isInteger(batchSize) || batchSize < 1) throw new Error('batchSize must be a positive integer.')
    const subscription = this.subscription(subscriptionId)
    const expired = this.expire(nowMs)
    const deliveries: TopicDelivery[] = []
    for (const [messageId, state] of subscription.messages) {
      if (deliveries.length >= batchSize) break
      if (state.deliveredAtMs !== undefined) continue
      const message = this.messages.get(messageId)
      if (!message) continue
      state.attempt += 1
      state.deliveredAtMs = nowMs
      subscription.delivered += 1
      deliveries.push({ subscriptionId, message, attempt: state.attempt, deliveredAtMs: nowMs })
    }
    return { deliveries, expired }
  }

  acknowledge(subscriptionId: string, messageIds: readonly number[], nowMs: number): TopicAcknowledgeResult {
    assertVirtualTime(nowMs, this.lastTimeMs)
    const subscription = this.subscription(subscriptionId)
    const uniqueIds = new Set(messageIds)
    if (uniqueIds.size !== messageIds.length) throw new Error('Acknowledgement message IDs must be unique.')
    this.validateSettlement(subscriptionId, subscription, uniqueIds, nowMs, 'acknowledge')
    const expired = this.expire(nowMs)
    const expiredIds = new Set(expired.filter((delivery) => delivery.subscriptionId === subscriptionId).map((delivery) => delivery.message.id))
    const acknowledged: TopicMessage[] = []
    for (const messageId of uniqueIds) {
      if (expiredIds.has(messageId)) continue
      const state = subscription.messages.get(messageId)
      const message = this.messages.get(messageId)
      if (!state || !message) {
        if (Number.isInteger(messageId) && messageId >= 0 && messageId < this.nextMessageId) continue
        throw new Error(`Cannot acknowledge unknown message ${messageId} for subscription ${subscriptionId}.`)
      }
      if (state.deliveredAtMs === undefined) throw new Error(`Cannot acknowledge undelivered message ${messageId} for subscription ${subscriptionId}.`)
      subscription.messages.delete(messageId)
      subscription.acknowledged += 1
      acknowledged.push(message)
    }
    return { acknowledged, expired }
  }

  release(subscriptionId: string, messageIds: readonly number[], nowMs: number) {
    assertVirtualTime(nowMs, this.lastTimeMs)
    const subscription = this.subscription(subscriptionId)
    const uniqueIds = new Set(messageIds)
    this.validateSettlement(subscriptionId, subscription, uniqueIds, nowMs, 'release')
    const expired = this.expire(nowMs)
    const expiredIds = new Set(expired.filter((delivery) => delivery.subscriptionId === subscriptionId).map((delivery) => delivery.message.id))
    for (const messageId of uniqueIds) {
      if (expiredIds.has(messageId)) continue
      const state = subscription.messages.get(messageId)
      if (!state) {
        if (Number.isInteger(messageId) && messageId >= 0 && messageId < this.nextMessageId) continue
        throw new Error(`Cannot release unknown message ${messageId} for subscription ${subscriptionId}.`)
      }
      if (state.deliveredAtMs === undefined) throw new Error(`Cannot release undelivered message ${messageId} for subscription ${subscriptionId}.`)
      delete state.deliveredAtMs
    }
    return expired
  }

  expire(nowMs: number): TopicExpiredDelivery[] {
    this.advance(nowMs)
    const expired: TopicExpiredDelivery[] = []
    for (const [messageId, message] of this.messages) {
      if (message.expiresAtMs > nowMs) continue
      expired.push(...this.removeMessage(message, 'time-retention'))
    }
    return expired
  }

  snapshot(nowMs: number) {
    const expired = this.expire(nowMs)
    const subscriptions = [...this.subscriptions].map(([subscriptionId, state]) => {
      const values = [...state.messages]
      const inFlight = values.filter(([, message]) => message.deliveredAtMs !== undefined).length
      const oldest = values[0] === undefined ? undefined : this.messages.get(values[0][0])
      return {
        subscriptionId, backlog: state.messages.size, pending: state.messages.size - inFlight, inFlight,
        delivered: state.delivered, acknowledged: state.acknowledged, expired: state.expired,
        oldestUnacknowledgedAgeMs: oldest ? Math.max(0, nowMs - oldest.publishedAtMs) : 0,
      }
    })
    const totalBacklog = subscriptions.reduce((total, subscription) => total + subscription.backlog, 0)
    return {
      published: this.published, publishedBytes: this.publishedBytes, fanOutCopies: this.fanOutCopies,
      retainedMessages: this.messages.size, expiredMessages: this.expiredMessages, timeExpiredMessages: this.timeExpiredMessages, capacityExpiredMessages: this.capacityExpiredMessages, totalBacklog,
      maximumSubscriptionBacklog: Math.max(0, ...subscriptions.map((subscription) => subscription.backlog)),
      acknowledged: subscriptions.reduce((total, subscription) => total + subscription.acknowledged, 0),
      delivered: subscriptions.reduce((total, subscription) => total + subscription.delivered, 0),
      expiredDeliveries: subscriptions.reduce((total, subscription) => total + subscription.expired, 0),
      subscriptions, expired,
    }
  }

  private subscription(subscriptionId: string) {
    const subscription = this.subscriptions.get(subscriptionId)
    if (!subscription) throw new Error(`Unknown subscription ${subscriptionId}.`)
    return subscription
  }

  private removeMessage(message: TopicMessage, cause: TopicExpiredDelivery['cause']) {
    const expired: TopicExpiredDelivery[] = []
    for (const [subscriptionId, subscription] of this.subscriptions) {
      const state = subscription.messages.get(message.id)
      if (!state) continue
      subscription.messages.delete(message.id)
      subscription.expired += 1
      expired.push({ subscriptionId, message, wasInFlight: state.deliveredAtMs !== undefined, cause })
    }
    this.messages.delete(message.id)
    this.expiredMessages += 1
    if (cause === 'time-retention') this.timeExpiredMessages += 1
    else this.capacityExpiredMessages += 1
    return expired
  }

  private validateSettlement(subscriptionId: string, subscription: SubscriptionState, messageIds: ReadonlySet<number>, nowMs: number, operation: 'acknowledge' | 'release') {
    for (const messageId of messageIds) {
      if (!Number.isInteger(messageId) || messageId < 0 || messageId >= this.nextMessageId) {
        throw new Error(`Cannot ${operation} unknown message ${messageId} for subscription ${subscriptionId}.`)
      }
      const state = subscription.messages.get(messageId)
      const message = this.messages.get(messageId)
      if (state && state.deliveredAtMs === undefined && message && message.expiresAtMs > nowMs) {
        throw new Error(`Cannot ${operation} undelivered message ${messageId} for subscription ${subscriptionId}.`)
      }
    }
  }

  private advance(nowMs: number) {
    assertVirtualTime(nowMs, this.lastTimeMs)
    this.lastTimeMs = nowMs
  }
}
