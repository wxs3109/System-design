import { describe, expect, it } from 'vitest'
import { TopicState } from './topic-state'

const createState = (retentionMs = 1_000, maxRetainedMessages = 100) => new TopicState({ subscriptionIds: ['email', 'analytics'], retentionMs, maxRetainedMessages })

describe('TopicState', () => {
  it('fans each publication into independent subscription backlogs', () => {
    const state = createState()
    expect(state.publish('order:1', 256, 10)).toMatchObject({ fanOut: 2, message: { id: 0, key: 'order:1', bytes: 256, expiresAtMs: 1_010 } })
    expect(state.publish('order:2', 512, 20)).toMatchObject({ fanOut: 2, message: { id: 1 } })

    expect(state.snapshot(20)).toMatchObject({
      published: 2, publishedBytes: 768, fanOutCopies: 4, retainedMessages: 2, totalBacklog: 4, maximumSubscriptionBacklog: 2,
      subscriptions: [
        { subscriptionId: 'email', backlog: 2, pending: 2, inFlight: 0 },
        { subscriptionId: 'analytics', backlog: 2, pending: 2, inFlight: 0 },
      ],
    })
  })

  it('delivers and acknowledges one subscription without advancing another', () => {
    const state = createState()
    state.publish('order:1', 100, 0)
    state.publish('order:2', 100, 1)
    const email = state.deliver('email', 1, 2)
    expect(email.deliveries).toMatchObject([{ subscriptionId: 'email', message: { id: 0 }, attempt: 1 }])
    expect(state.acknowledge('email', [0], 3).acknowledged).toMatchObject([{ id: 0 }])

    const analytics = state.deliver('analytics', 2, 4)
    expect(analytics.deliveries.map((delivery) => delivery.message.id)).toEqual([0, 1])
    expect(state.snapshot(4).subscriptions).toMatchObject([
      { subscriptionId: 'email', backlog: 1, acknowledged: 1 },
      { subscriptionId: 'analytics', backlog: 2, acknowledged: 0, inFlight: 2 },
    ])
  })

  it('does not redeliver an in-flight message until it is released', () => {
    const state = createState()
    state.publish('message:1', 10, 0)
    const first = state.deliver('email', 1, 1).deliveries[0]!
    expect(state.deliver('email', 1, 2).deliveries).toEqual([])
    state.release('email', [first.message.id], 3)
    expect(state.deliver('email', 1, 4).deliveries[0]).toMatchObject({ message: { id: 0 }, attempt: 2 })
  })

  it('expires acknowledged and unacknowledged copies at the retention boundary', () => {
    const state = createState(100)
    state.publish('message:1', 10, 5)
    const email = state.deliver('email', 1, 10).deliveries[0]!
    state.acknowledge('email', [email.message.id], 11)
    expect(state.snapshot(104)).toMatchObject({ retainedMessages: 1, totalBacklog: 1, expiredMessages: 0 })

    const snapshot = state.snapshot(105)
    expect(snapshot).toMatchObject({ retainedMessages: 0, totalBacklog: 0, expiredMessages: 1, expiredDeliveries: 1 })
    expect(snapshot.expired).toMatchObject([{ subscriptionId: 'analytics', message: { id: 0 }, wasInFlight: false }])
  })

  it('expires in-flight deliveries and reports their state', () => {
    const state = createState(10)
    state.publish('message:1', 10, 0)
    state.deliver('email', 1, 1)
    expect(state.expire(10)).toMatchObject([
      { subscriptionId: 'email', message: { id: 0 }, wasInFlight: true },
      { subscriptionId: 'analytics', message: { id: 0 }, wasInFlight: false },
    ])
    expect(state.snapshot(10)).toMatchObject({ expiredMessages: 1, expiredDeliveries: 2, totalBacklog: 0 })
  })

  it('applies bounded size retention across all subscriptions', () => {
    const state = createState(1_000, 1)
    state.publish('message:1', 10, 0)
    state.deliver('email', 1, 1)
    const second = state.publish('message:2', 20, 2)
    expect(second.expired).toMatchObject([
      { subscriptionId: 'email', message: { id: 0 }, wasInFlight: true, cause: 'capacity-retention' },
      { subscriptionId: 'analytics', message: { id: 0 }, wasInFlight: false, cause: 'capacity-retention' },
    ])
    expect(state.snapshot(2)).toMatchObject({ retainedMessages: 1, totalBacklog: 2, expiredMessages: 1, capacityExpiredMessages: 1, timeExpiredMessages: 0 })
  })

  it('treats acknowledgements that arrive after retention as expired instead of unknown', () => {
    const state = createState(10)
    state.publish('message:1', 10, 0)
    const delivery = state.deliver('email', 1, 1).deliveries[0]!
    const result = state.acknowledge('email', [delivery.message.id], 10)
    expect(result.acknowledged).toEqual([])
    expect(result.expired).toEqual(expect.arrayContaining([expect.objectContaining({ subscriptionId: 'email', message: expect.objectContaining({ id: 0 }), wasInFlight: true })]))
  })

  it('makes late and repeated settlement idempotent after cleanup', () => {
    const state = createState(10)
    state.publish('message:1', 10, 0)
    state.deliver('email', 1, 1)
    state.expire(10)
    expect(state.acknowledge('email', [0], 11).acknowledged).toEqual([])
    expect(state.release('email', [0], 12)).toEqual([])
    expect(() => state.acknowledge('email', [99], 13)).toThrow('unknown message')
  })

  it('validates subscriptions, delivery state, bytes and monotonic virtual time', () => {
    expect(() => new TopicState({ subscriptionIds: [], retentionMs: 1, maxRetainedMessages: 1 })).toThrow('subscription')
    expect(() => new TopicState({ subscriptionIds: ['same', 'same'], retentionMs: 1, maxRetainedMessages: 1 })).toThrow('unique')
    expect(() => new TopicState({ subscriptionIds: ['one'], retentionMs: 0, maxRetainedMessages: 1 })).toThrow('retentionMs')
    expect(() => new TopicState({ subscriptionIds: ['one'], retentionMs: 1, maxRetainedMessages: 0 })).toThrow('maxRetainedMessages')
    const state = createState()
    expect(() => state.publish('message', -1, 0)).toThrow('bytes')
    state.publish('message', 1, 1)
    expect(() => state.acknowledge('email', [0], 2)).toThrow('undelivered')
    expect(() => state.deliver('missing', 1, 2)).toThrow('Unknown subscription')
    state.snapshot(2)
    expect(() => state.snapshot(1)).toThrow('monotonic')
  })

  it('does not advance virtual time or expire messages when an operation is invalid', () => {
    const invalidPublish = createState(10)
    invalidPublish.publish('message:1', 1, 0)
    expect(() => invalidPublish.publish('message:2', -1, 10)).toThrow('bytes')
    expect(invalidPublish.snapshot(1)).toMatchObject({ retainedMessages: 1, expiredMessages: 0 })

    const invalidDelivery = createState(10)
    invalidDelivery.publish('message:1', 1, 0)
    expect(() => invalidDelivery.deliver('missing', 1, 10)).toThrow('Unknown subscription')
    expect(invalidDelivery.snapshot(1)).toMatchObject({ retainedMessages: 1, expiredMessages: 0 })

    const invalidAcknowledgement = createState(10)
    invalidAcknowledgement.publish('message:1', 1, 0)
    expect(() => invalidAcknowledgement.acknowledge('email', [0, 0], 10)).toThrow('unique')
    expect(invalidAcknowledgement.snapshot(1)).toMatchObject({ retainedMessages: 1, expiredMessages: 0 })

    const undeliveredAcknowledgement = createState(10)
    undeliveredAcknowledgement.publish('message:1', 1, 0)
    expect(() => undeliveredAcknowledgement.acknowledge('email', [0], 5)).toThrow('undelivered')
    expect(undeliveredAcknowledgement.snapshot(1)).toMatchObject({ retainedMessages: 1, expiredMessages: 0 })

    const unknownRelease = createState(10)
    unknownRelease.publish('message:1', 1, 0)
    expect(() => unknownRelease.release('email', [99], 10)).toThrow('unknown message')
    expect(unknownRelease.snapshot(1)).toMatchObject({ retainedMessages: 1, expiredMessages: 0 })
  })
})
