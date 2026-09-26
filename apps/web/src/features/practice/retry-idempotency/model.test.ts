import { describe, expect, it } from 'vitest'
import { atomicCreate, clientStatus, defaultConfig, isSettled, nextTimer, runProtocol, type Command, type RetryConfig, type StableStore } from './model'
import { scenarioCommands } from './lesson'

const config = (strategy: RetryConfig['strategy'] = 'idempotent') => ({ ...defaultConfig(), strategy })
const createFirst: Command[] = [{ type: 'submit' }, { type: 'deliver-request', requestId: 'request-1' }, { type: 'commit', requestId: 'request-1' }]
describe('interactive request/response transitions', () => {
  it('separates sent, received, committed and client-known state', () => {
    const sent = runProtocol(config(), [{ type: 'submit' }])
    expect(sent.store.tasks).toHaveLength(0)
    expect(sent.requests[0]!.location).toBe('network')
    const received = runProtocol(config(), createFirst.slice(0, 2))
    expect(received.store.tasks).toHaveLength(0)
    expect(received.requests[0]!.location).toBe('server')
    const committed = runProtocol(config(), createFirst)
    expect(committed.store.tasks).toHaveLength(1)
    expect(committed.store.records).toHaveLength(1)
    expect(committed.knownTaskIds).toHaveLength(0)
    const replied = runProtocol(config(), [...createFirst, { type: 'deliver-response', responseId: 'response-1' }])
    expect(replied.knownTaskIds).toEqual(['task-1'])
    expect(isSettled(replied)).toBe(true)
  })
  it('preserves committed effects when a response is dropped and the client times out', () => {
    const state = runProtocol(config('no-retry'), [...createFirst, { type: 'drop-response', responseId: 'response-1' }, { type: 'advance', ms: 500 }])
    expect(state.store.tasks).toHaveLength(1)
    expect(clientStatus(state)).toBe('unknown')
    expect(state.requests).toHaveLength(1)
    expect(state.knownTaskIds).toHaveLength(0)
  })
  it.each(['no-retry', 'retry', 'idempotent'] as const)('executes lost-response scenario under %s', (strategy) => {
    const settings = config(strategy)
    const state = runProtocol(settings, scenarioCommands(settings, 'response-lost'))
    expect(state.store.tasks).toHaveLength(strategy === 'retry' ? 2 : 1)
    expect(state.knownTaskIds).toEqual(strategy === 'no-retry' ? [] : strategy === 'retry' ? ['task-2'] : ['task-1'])
    expect(state.responses.filter((response) => response.outcome === 'replayed')).toHaveLength(strategy === 'idempotent' ? 1 : 0)
    expect(isSettled(state)).toBe(true)
  })
  it('requires retry progress when the first request never reached the server', () => {
    for (const strategy of ['no-retry', 'retry', 'idempotent'] as const) {
      const settings = config(strategy)
      const state = runProtocol(settings, scenarioCommands(settings, 'request-lost'))
      expect(state.store.tasks).toHaveLength(strategy === 'no-retry' ? 0 : 1)
      expect(clientStatus(state)).toBe(strategy === 'no-retry' ? 'unknown' : 'success')
    }
  })
  it('does not withdraw an old request on timeout or after a newer response succeeds', () => {
    const settings = config()
    const waiting = runProtocol(settings, [{ type: 'submit' }, { type: 'advance', ms: 600 }])
    expect(waiting.requests.map((request) => request.location)).toEqual(['network', 'network'])
    expect(waiting.requests.map((request) => request.wait)).toEqual(['timed-out', 'waiting'])
    const safe = runProtocol(settings, scenarioCommands(settings, 'late-request'))
    expect(safe.store.tasks).toHaveLength(1)
    expect(safe.responses.map((response) => response.outcome)).toEqual(['created', 'replayed'])
    const unsafe = config('retry')
    const duplicated = runProtocol(unsafe, scenarioCommands(unsafe, 'late-request'))
    expect(duplicated.store.tasks).toHaveLength(2)
    expect(duplicated.knownTaskIds).toEqual(['task-1', 'task-2'])
  })
  it('uses the same atomic guard for concurrent arrivals in either commit order', () => {
    const settings = config()
    const start: Command[] = [{ type: 'submit' }, { type: 'retry', key: settings.key, payload: settings.payload }, { type: 'deliver-request', requestId: 'request-1' }, { type: 'deliver-request', requestId: 'request-2' }]
    for (const order of [[1, 2], [2, 1]]) {
      const state = runProtocol(settings, [...start, ...order.map((id) => ({ type: 'commit' as const, requestId: `request-${id}` }))])
      expect(state.store.tasks).toHaveLength(1)
      expect(state.store.records).toHaveLength(1)
      expect(state.responses.map((response) => response.outcome)).toEqual(['created', 'replayed'])
      expect(state.store.tasks[0]!.requestId).toBe(`request-${order[0]}`)
    }
  })
  it('binds the key to normalized parameters and rejects a conflicting request', () => {
    const settings = config()
    const state = runProtocol(settings, [...createFirst, { type: 'retry', key: settings.key, payload: { ...settings.payload, format: '1080p' } }, { type: 'deliver-request', requestId: 'request-2' }, { type: 'commit', requestId: 'request-2' }, { type: 'deliver-response', responseId: 'response-2' }])
    expect(state.store.tasks).toHaveLength(1)
    expect(state.responses[1]!.outcome).toBe('conflict')
    expect(state.rejectedRequestIds).toEqual(['request-2'])
    expect(clientStatus(state)).toBe('rejected')
  })
  it('new retry keys and expired records do not protect the original logical intent', () => {
    const settings = config()
    const changedKey = runProtocol(settings, [...createFirst, { type: 'retry', key: 'new-key', payload: settings.payload }, { type: 'deliver-request', requestId: 'request-2' }, { type: 'commit', requestId: 'request-2' }])
    expect(changedKey.store.tasks).toHaveLength(2)
    const shortRetention = { ...settings, retentionMs: 200 }
    const expired = runProtocol(shortRetention, scenarioCommands(shortRetention, 'response-lost'))
    expect(expired.store.tasks).toHaveLength(2)
    expect(expired.events.some((event) => event.kind === 'dedupe-expired')).toBe(true)
  })
  it('maintains parameter normalization, caller scope and exact retention boundaries', () => {
    const request = { id: 'request-1', callerId: 'a', key: 'same-key', payload: { videoId: 'video-1', format: '720p' as const } }
    const first = atomicCreate({ tasks: [], records: [] }, request, 0, true, 200)
    const reordered = { ...request, payload: { format: '720p' as const, videoId: 'video-1' } }
    const replay = atomicCreate(first.store, reordered, 199, true, 200)
    expect(replay.outcome).toBe('replayed')
    expect(replay.store.records[0]!.expiresAt).toBe(200)
    expect(atomicCreate(first.store, request, 200, true, 200).outcome).toBe('created')
    expect(atomicCreate(first.store, { ...request, callerId: 'b' }, 10, true, 200).store.tasks).toHaveLength(2)
    expect(first.store.tasks).toHaveLength(1)
  })
  it('bounds retries, honors backoff, and stops sending after a delivered result', () => {
    const settings = config()
    const atTimeout = runProtocol(settings, [{ type: 'submit' }, { type: 'advance', ms: 500 }])
    expect(atTimeout.requests).toHaveLength(1)
    expect(nextTimer(atTimeout)).toBe(600)
    const exhausted = runProtocol(settings, [{ type: 'submit' }, { type: 'advance', ms: 10000 }])
    expect(exhausted.requests.map((request) => request.sentAt)).toEqual([0, 600, 1200])
    expect(exhausted.requests).toHaveLength(3)
    expect(nextTimer(exhausted)).toBeNull()
    const success = runProtocol(settings, [...createFirst, { type: 'deliver-response', responseId: 'response-1' }, { type: 'advance', ms: 10000 }])
    expect(success.requests).toHaveLength(1)
  })
  it('drops uncommitted inbox state on a crash but recovers committed task and key state', () => {
    const settings = config()
    const lostInbox = runProtocol(settings, [...createFirst.slice(0, 2), { type: 'crash' }, { type: 'restart' }])
    expect(lostInbox.store.tasks).toHaveLength(0)
    expect(lostInbox.requests[0]!.location).toBe('lost-on-crash')
    const recovered = runProtocol(settings, [...createFirst, { type: 'drop-response', responseId: 'response-1' }, { type: 'crash' }, { type: 'advance', ms: 600 }, { type: 'restart' }, { type: 'deliver-request', requestId: 'request-2' }, { type: 'commit', requestId: 'request-2' }, { type: 'deliver-response', responseId: 'response-2' }])
    expect(recovered.store.tasks).toHaveLength(1)
    expect(recovered.responses[1]!.outcome).toBe('replayed')
    expect(recovered.knownTaskIds).toEqual(['task-1'])
  })
  it('rejects invalid commands, truncated state transitions, unknown versions and runaway budgets', () => {
    expect(() => runProtocol({ ...config(), modelVersion: 'future' } as never, [])).toThrow('版本')
    expect(() => runProtocol(config(), [{ type: 'commit', requestId: 'request-1' }])).toThrow('不存在')
    expect(() => runProtocol(config(), [{ type: 'submit' }, { type: 'commit', requestId: 'request-1' }])).toThrow('尚未递送')
    expect(() => runProtocol(config(), Array(2))).toThrow('操作无效')
    expect(() => runProtocol(config(), [{ type: 'advance', ms: 120000 }, { type: 'advance', ms: 1 }])).toThrow('上限')
    expect(() => runProtocol(config(), Array(101).fill({ type: 'advance', ms: 1 }))).toThrow('范围')
    expect(() => runProtocol(config(), [...createFirst, { type: 'commit', requestId: 'request-1' }])).toThrow('尚未递送')
  })
  it('matches an independent map-based dedupe ledger across mixed identities and parameters', () => {
    let store: StableStore = { tasks: [], records: [] }
    const ledger = new Map<string, { format: string; taskId: string }>()
    let creations = 0
    for (let i = 0; i < 60; i++) {
      const callerId = i % 2 ? 'a' : 'b'
      const key = `key-${i % 7}`
      const format = i % 3 ? '720p' as const : '1080p' as const
      const identity = `${callerId}/${key}`
      const prior = ledger.get(identity)
      const outcome = prior ? prior.format === format ? 'replayed' : 'conflict' : 'created'
      if (!prior) ledger.set(identity, { format, taskId: `task-${++creations}` })
      const actual = atomicCreate(store, { id: `r-${i}`, callerId, key, payload: { videoId: 'video', format } }, i, true, 10000)
      expect(actual.outcome).toBe(outcome)
      store = actual.store
      expect(store.tasks).toHaveLength(creations)
      expect(store.records).toHaveLength(ledger.size)
    }
  })
})
