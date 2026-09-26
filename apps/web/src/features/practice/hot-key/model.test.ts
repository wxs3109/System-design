import { describe, expect, it } from 'vitest'
import { distribute, makeInput } from '../distribution/model'
import { cacheOff, compareHot, defaultHotInput, executeReads, generateWorkload, parseHotInput, runHotModel, type ReadRequest } from './model'

const distribution = distribute(makeInput('test', 256))
const [a, b, c] = distribution.input.keys as [string, string, string, ...string[]]
const read = (key: string, atMs: number, index: number): ReadRequest => ({ key, atMs, index, id: `r${index}`, gate: 0, choice: 0 })
const sequence = (items: [string, number][]) => ({ hotKey: a, requests: items.map(([key, time], index) => read(key, time, index)) })

describe('versioned read workload', () => {
  it('reuses indexed samples across probability/pattern changes and distribution edits', () => {
    const input = makeInput()
    const low = generateWorkload(input, { count: 1000, probability: .2 })
    const high = generateWorkload(input, { count: 1000, probability: .95 })
    const uniform = generateWorkload(input, { count: 1000, pattern: 'uniform' })
    const samples = (work: typeof low) => work.requests.map(({ id, index, atMs, gate, choice }) => ({ id, index, atMs, gate, choice }))
    expect(samples(low)).toEqual(samples(high))
    expect(samples(low)).toEqual(samples(uniform))
    expect(high.requests.filter((r) => r.key === high.hotKey).length).toBeGreaterThan(low.requests.filter((r) => r.key === low.hotKey).length)
    expect(generateWorkload({ ...input, nodes: ['other'], method: 'ring' }, { count: 1000, probability: .2 })).toEqual(low)
    expect(generateWorkload(input, { count: 1000, seed: 'different' }).requests).not.toEqual(low.requests)
  })
  it('checks each request against the declared branch and complete key population', () => {
    const input = makeInput('sampling', 256)
    for (const pattern of ['uniform', 'hotspot'] as const) {
      const work = generateWorkload(input, { pattern, count: 1000, probability: .8 })
      const others = input.keys.filter((key) => key !== work.hotKey)
      for (const request of work.requests) {
        const population = pattern === 'uniform' ? input.keys : others
        const chosen = population[Math.floor(request.choice * population.length / 4294967296)]
        expect(request.key).toBe(pattern === 'hotspot' && request.gate < .8 * 4294967296 ? work.hotKey : chosen)
      }
    }
  })
  it('rejects forged sequences, unknown versions, duplicate/missing/out-of-order requests', () => {
    const input = defaultHotInput()
    input.workload = generateWorkload(input.distribution, { count: 1000 })
    for (const change of [
      (value: typeof input) => { value.workload.requests.pop() },
      (value: typeof input) => { value.workload.requests[0]!.index = 2 },
      (value: typeof input) => { value.workload.requests[1]!.id = value.workload.requests[0]!.id },
      (value: typeof input) => { value.workload.requests[0]!.key = 'missing' },
    ]) { const invalid = structuredClone(input); change(invalid); expect(() => parseHotInput(invalid)).toThrow() }
    const forged = structuredClone(input)
    forged.workload.requests[0]!.key = input.distribution.keys.find((key) => key !== forged.workload.requests[0]!.key)!
    expect(() => runHotModel(forged)).toThrow('采样器')
    expect(() => parseHotInput({ ...input, modelVersion: 'future' })).toThrow('版本')
    expect(() => parseHotInput({ ...input, cache: { enabled: true, capacity: 0, ttlMs: 100 } })).toThrow('缓存策略')
  })
})
describe('sequential cache evidence', () => {
  it('counts bypass separately and starts cold on every run', () => {
    const workload = sequence([[a, 0], [a, 1], [a, 2]])
    const off = executeReads(distribution, workload, cacheOff)
    expect(off.totals).toMatchObject({ reads: 3, bypasses: 3, backendReads: 3, lookups: 0, hits: 0, misses: 0 })
    expect(off.hitRate).toBeNull()
    const policy = { enabled: true, capacity: 2, ttlMs: 100 }
    const on = executeReads(distribution, workload, policy)
    expect(on.events.map((event) => event.outcome)).toEqual(['miss', 'hit', 'hit'])
    expect(on.totals).toMatchObject({ bypasses: 0, lookups: 3, hits: 2, misses: 1, backendReads: 1, fills: 1 })
    expect(executeReads(distribution, workload, policy)).toEqual(on)
  })
  it('expires on the exact boundary without renewal; unrelated expiry is not a miss', () => {
    const result = executeReads(distribution, sequence([[a, 0], [b, 1], [a, 9], [c, 10], [a, 11]]), { enabled: true, capacity: 3, ttlMs: 10 })
    expect(result.events[2]).toMatchObject({ outcome: 'hit', expiresAt: 10, filled: false })
    expect(result.events[3]).toMatchObject({ expired: [a], outcome: 'miss' })
    expect(result.events[4]).toMatchObject({ expired: [b], outcome: 'miss', expiresAt: 21 })
    expect(result.totals).toMatchObject({ reads: 5, lookups: 5, hits: 1, misses: 4, expiries: 2, evictions: 0 })
    expect(result.cacheEntries).toEqual([{ key: c, expiresAt: 20 }, { key: a, expiresAt: 21 }])
    const exact = executeReads(distribution, sequence([[a, 0], [a, 10]]), { enabled: true, capacity: 1, ttlMs: 10 })
    expect(exact.events[1]).toMatchObject({ expired: [a], outcome: 'miss', filled: true })
    expect(exact.totals.misses).toBe(2)
  })
  it('evicts least recently accessed rather than earliest filled', () => {
    const result = executeReads(distribution, sequence([[a, 0], [b, 1], [a, 2], [c, 3], [b, 4]]), { enabled: true, capacity: 2, ttlMs: 100 })
    expect(result.events[3]).toMatchObject({ evicted: b, outcome: 'miss' })
    expect(result.events[4]).toMatchObject({ evicted: a, outcome: 'miss' })
    expect(result.totals.evictions).toBe(2)
    expect(result.cacheEntries).toEqual([{ key: c, expiresAt: 103 }, { key: b, expiresAt: 104 }])
  })
  it('agrees with an independent array-based LRU oracle and per-event conservation', () => {
    const work = generateWorkload(distribution.input, { count: 1000, probability: .2 })
    const result = executeReads(distribution, work, { enabled: true, capacity: 16, ttlMs: 100 })
    let entries: { key: string; expiry: number; touched: number }[] = []
    let misses = 0
    for (const request of work.requests) {
      entries = entries.filter((item) => item.expiry > request.atMs)
      const found = entries.find((item) => item.key === request.key)
      if (found) found.touched = request.index
      else {
        misses++
        if (entries.length === 16) { entries.sort((x, y) => x.touched - y.touched); entries.shift() }
        entries.push({ key: request.key, expiry: request.atMs + 100, touched: request.index })
      }
      expect(result.events[request.index]!.outcome).toBe(found ? 'hit' : 'miss')
    }
    const t = result.totals
    expect(t.backendReads).toBe(misses)
    expect(t.reads).toBe(t.bypasses + t.lookups)
    expect(t.lookups).toBe(t.hits + t.misses)
    expect(t.backendReads).toBe(t.bypasses + t.misses)
    expect(result.events.filter((event) => event.backendRead).length).toBe(t.backendReads)
    expect(result.nodes.reduce((sum, node) => sum + node.backendReads, 0)).toBe(t.backendReads)
    expect(result.keys.reduce((sum, key) => sum + key.requests, 0)).toBe(t.reads)
  })
  it('does not scatter a hot key across nodes or guarantee a high uniform-cache hit rate', () => {
    const input = defaultHotInput()
    input.workload = generateWorkload(input.distribution, { count: 1000, probability: .95 })
    const first = runHotModel(input)
    const second = runHotModel({ ...input, distribution: { ...input.distribution, virtualNodes: 128, nodes: [...input.distribution.nodes, 'new'] } })
    expect(first.observedHotShare).toBe(second.observedHotShare)
    expect(new Set(second.events.filter((event) => event.key === input.workload.hotKey).map((event) => event.owner)).size).toBe(1)
    expect(second.maxRequestShare).toBeGreaterThanOrEqual(second.observedHotShare)
    const on = runHotModel({ ...input, cache: { enabled: true, capacity: 16, ttlMs: 60000 } })
    expect(on.totals.backendReads).toBeLessThan(first.totals.backendReads / 5)
    const large = makeInput('large', 4096)
    const uniform = runHotModel({ ...input, distribution: large, workload: generateWorkload(large, { count: 10000, pattern: 'uniform' }), cache: { enabled: true, capacity: 16, ttlMs: 60000 } })
    expect(uniform.hitRate).toBeLessThan(.05)
  })
  it('separates workload and strategy comparisons and refuses incompatible request populations', () => {
    const input = defaultHotInput()
    input.workload = generateWorkload(input.distribution, { count: 1000 })
    const before = runHotModel(input)
    const change = (afterInput: typeof input) => compareHot(input, before, afterInput, runHotModel(afterInput))
    expect(change({ ...input, cache: { ...input.cache, enabled: true } })).toMatchObject({ kind: 'cache', sameRequests: true })
    expect(change({ ...input, distribution: { ...input.distribution, virtualNodes: 128 } }).kind).toBe('distribution')
    expect(change({ ...input, workload: generateWorkload(input.distribution, { count: 1000, probability: .2 }) })).toMatchObject({ kind: 'workload', sameSamples: true, sameRequests: false, backendSaved: null })
    expect(change({ ...input, workload: generateWorkload(input.distribution, { count: 1000, seed: 'other' }) }).kind).toBe('incompatible')
    expect(change({ ...input, cache: { ...input.cache, enabled: true }, distribution: { ...input.distribution, virtualNodes: 128 } }).kind).toBe('combined')
  })
})
