import { describe, expect, it } from 'vitest'
import { asciiCompare, compare, distribute, hashV1, makeInput, methods, parseInput, successor, tokenCompare, type Method } from './model'

// Fixed vectors independently generated with imurmurhash 0.1.4 (MIT, already in
// the tooling lockfile), passing Buffer.from(text, 'utf8').toString('latin1').
// Algorithm reference: Austin Appleby, public domain, SMHasher commit
// 07bb4de10a63e8cc2e1724865454eba635742383/src/MurmurHash3.cpp, x86_32.
const vectors: [string, number][] = [
  ['', 0], ['a', 1009084850], ['ab', 2613040991], ['abc', 3017643002], ['abcd', 1139631978], ['abcde', 3902511862],
  ['foo', 4138058784], ['hello', 613153351], ['The quick brown fox jumps over the lazy dog', 776992547],
  ['["key","hash-lab:0000"]', 4153388835], ['["token","node-a",0]', 1844459301],
  ['["key","你好"]', 1081092393], ['["key","é"]', 4158939576], ['["key","é"]', 505985328], ['["key","😀"]', 464058120],
]
describe('distribution-v1 hash contract', () => {
  it.each(vectors)('matches independent vector %s', (text, expected) => expect(hashV1(text)).toBe(expected))
  it('has fixed domain separators and does not normalize Unicode', () => {
    const input = makeInput('domain', 256)
    input.keys[0] = '你好'
    expect(distribute(input).assignments.find((item) => item.key === '你好')?.hash).toBe(1081092393)
    expect(hashV1('["key","é"]')).not.toBe(hashV1('["key","é"]'))
  })
})
describe('assignment and conservation', () => {
  it.each(methods)('matches a separate exhaustive owner lookup for %s', (method) => {
    const input = { ...makeInput('oracle', 256), method, virtualNodes: 8 }
    const actual = distribute(input)
    // Deliberately scan all independent token positions per key, rather than
    // reuse the model's binary search or result token list.
    const tokens = input.nodes.flatMap((nodeId) => Array.from({ length: method === 'vnodes' ? 8 : 1 }, (_, index) => ({ nodeId, index, hash: hashV1(JSON.stringify(['token', nodeId, index])) })))
    for (const item of actual.assignments) {
      const position = hashV1(JSON.stringify(['key', item.key]))
      let owner: string
      if (method === 'modulo') owner = [...input.nodes].sort()[position % input.nodes.length]!
      else {
        const clockwise = tokens.map((token) => ({ ...token, distance: (token.hash - position + 2 ** 32) % 2 ** 32 }))
        clockwise.sort((a, b) => a.distance - b.distance || (a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : a.index - b.index))
        owner = clockwise[0]!.nodeId
      }
      expect(item.owner).toBe(owner)
    }
    expect(actual.counts.reduce((sum, item) => sum + item.count, 0)).toBe(256)
    expect(distribute({ ...input, nodes: [...input.nodes].reverse(), keys: [...input.keys].reverse() })).toEqual(actual)
  })
  it('keeps token collisions and key collisions without losing records', () => {
    const result = distribute({ ...makeInput(), method: 'vnodes', virtualNodes: 8 }, () => 42)
    expect(result.tokens).toHaveLength(32)
    expect(result.assignments).toHaveLength(1024)
    expect(result.assignments.every((item) => item.owner === 'node-a' && item.token?.index === 0)).toBe(true)
    expect(result.min).toBe(0)
    expect(result.counts).toEqual([{ nodeId: 'node-a', count: 1024 }, { nodeId: 'node-b', count: 0 }, { nodeId: 'node-c', count: 0 }, { nodeId: 'node-d', count: 0 }])
  })
  it('uses exact hits, tie ordering and wraparound', () => {
    const tokens = [{ nodeId: 'z', index: 0, hash: 100 }, { nodeId: 'a', index: 1, hash: 20 }, { nodeId: 'a', index: 0, hash: 20 }].sort(tokenCompare)
    expect(successor(tokens, 20)).toEqual({ nodeId: 'a', index: 0, hash: 20 })
    expect(successor(tokens, 21).nodeId).toBe('z')
    expect(successor(tokens, 100).nodeId).toBe('z')
    expect(successor(tokens, 101)).toEqual(tokens[0])
    expect(successor(tokens, 0)).toEqual(tokens[0])
  })
  it('V=1 is exactly the single-token ring and a single node owns all keys', () => {
    const a = distribute({ ...makeInput(), method: 'ring' })
    const b = distribute({ ...makeInput(), method: 'vnodes', virtualNodes: 1 })
    expect(a.assignments).toEqual(b.assignments)
    for (const method of methods) expect(distribute({ ...makeInput(), method, nodes: ['only'] }).counts).toEqual([{ nodeId: 'only', count: 1024 }])
  })
  it.each(['ring', 'vnodes'] as Method[])('%s only remaps into added / out of removed nodes, across seeds and token counts', (method) => {
    for (const seed of ['a', 'b', 'c', 'd']) for (const virtualNodes of [1, 8, 32, 128]) {
      const input = { ...makeInput(seed, 256), method, virtualNodes }
      const before = distribute(input)
      const after = distribute({ ...input, nodes: [...input.nodes, 'new'] })
      const diff = compare(before, after)!
      expect(diff.transfers.every((item) => item.from === item.to || item.to === 'new')).toBe(true)
      expect(diff.transfers.reduce((sum, item) => sum + item.count, 0)).toBe(256)
      const removed = distribute({ ...input, nodes: input.nodes.filter((id) => id !== 'node-b') })
      expect(compare(before, removed)!.transfers.every((item) => item.from === item.to || item.from === 'node-b')).toBe(true)
      expect(distribute({ ...after.input, nodes: after.input.nodes.filter((id) => id !== 'new') })).toEqual(before)
    }
  })
  it('modulo compacts slots without renaming remaining members and can move unrelated keys', () => {
    const before = distribute(makeInput())
    const after = distribute({ ...before.input, nodes: ['node-a', 'node-c', 'node-d'] })
    expect(after.input.nodes).toEqual(['node-a', 'node-c', 'node-d'])
    expect(compare(before, after)!.transfers.some((item) => item.from !== 'node-b' && item.from !== item.to)).toBe(true)
  })
  it('separates controlled comparisons and rejects changed corpora or versions', () => {
    const input = makeInput()
    const before = distribute(input)
    expect(compare(before, before)?.kind).toBe('unchanged')
    expect(compare(before, distribute({ ...input, nodes: [...input.nodes, 'e'] }))?.kind).toBe('membership')
    expect(compare(before, distribute({ ...input, method: 'ring' }))?.kind).toBe('algorithm')
    expect(compare(before, distribute({ ...input, method: 'ring', nodes: [...input.nodes, 'e'] }))?.kind).toBe('combined')
    expect(compare(distribute({ ...input, method: 'vnodes', virtualNodes: 8 }), distribute({ ...input, method: 'vnodes', virtualNodes: 32 }))?.kind).toBe('virtualNodes')
    expect(compare(before, distribute(makeInput('different')))).toBeNull()
    expect(compare(before, { ...before, input: { ...input, modelVersion: 'future' } } as unknown as typeof before)).toBeNull()
  })
  it('validates stored input rather than accepting invalid cardinality or identities', () => {
    for (const patch of [{ modelVersion: 'v2' }, { generatorVersion: 'v2' }, { nodes: [] }, { nodes: ['a', 'a'] }, { nodes: ['中文'] }, { nodes: Array.from({ length: 13 }, (_, i) => String(i)) }, { keys: ['only'] }, { keys: Array(256).fill('same') }, { method: 'fake' }, { virtualNodes: 0 }, { datasetSeed: '' }]) expect(() => parseInput({ ...makeInput(), ...patch })).toThrow()
    expect(asciiCompare('Z', 'a')).toBe(-1)
  })
  it('computes every key and token at the maximum UI budget', () => {
    const started = performance.now()
    const result = distribute({ ...makeInput('max', 4096), nodes: Array.from({ length: 12 }, (_, i) => `n-${i}`), method: 'vnodes', virtualNodes: 128 })
    expect(result.tokens).toHaveLength(1536)
    expect(result.assignments).toHaveLength(4096)
    expect(result.counts.reduce((sum, item) => sum + item.count, 0)).toBe(4096)
    // Diagnostic only: wall time is never displayed as simulated throughput.
    console.info(`Maximum distribution compute: ${(performance.now() - started).toFixed(1)} ms`)
  })
})
