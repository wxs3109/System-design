import { describe, expect, it } from 'vitest'
import { CdnState, ObjectStorageState, PartitionedStreamState, ShardedDatabaseState, VirtualCacheState, stablePartition, stableRendezvousNode } from './data-state'

describe('virtual-time cache state', () => {
  it('tracks key-aware hits, misses and TTL expiry without reading wall-clock time', () => {
    const cache = new VirtualCacheState({ capacityEntries: 2, ttlMs: 100, evictionPolicy: 'lru' })
    expect(cache.read('user:1', 0)).toEqual({ outcome: 'miss' })
    cache.write('user:1', 10)
    expect(cache.read('user:1', 50)).toEqual({ outcome: 'hit', ageMs: 40 })
    expect(cache.read('user:1', 110)).toEqual({ outcome: 'expired' })
    expect(cache.snapshot(110)).toEqual({ hits: 1, misses: 2, hitRate: 1 / 3, evictions: 0, expirations: 1, entries: 0, occupancy: 0 })
  })

  it('evicts the least-recently-used key deterministically at bounded capacity', () => {
    const cache = new VirtualCacheState({ capacityEntries: 2, ttlMs: 1_000, evictionPolicy: 'lru' })
    cache.write('a', 0)
    cache.write('b', 1)
    cache.read('a', 2)
    expect(cache.write('c', 3)).toEqual({ evictedKey: 'b' })
    expect(cache.read('a', 4).outcome).toBe('hit')
    expect(cache.read('b', 4).outcome).toBe('miss')
    expect(cache.snapshot(4)).toMatchObject({ entries: 2, occupancy: 1, evictions: 1 })
  })

  it('expires stale capacity before inserting instead of reporting a false eviction', () => {
    const cache = new VirtualCacheState({ capacityEntries: 1, ttlMs: 10, evictionPolicy: 'fifo' })
    cache.write('stale', 0)
    expect(cache.write('fresh', 10)).toEqual({})
    expect(cache.snapshot(10)).toMatchObject({ entries: 1, expirations: 1, evictions: 0 })
  })

  it('reports keys expired by virtual-time maintenance exactly once', () => {
    const cache = new VirtualCacheState({ capacityEntries: 2, ttlMs: 10, evictionPolicy: 'fifo' })
    cache.write('a', 0)
    cache.write('b', 5)
    expect(cache.expire(10)).toEqual(['a'])
    expect(cache.expire(15)).toEqual(['b'])
    expect(cache.expire(20)).toEqual([])
    expect(cache.snapshot(20)).toMatchObject({ expirations: 2, entries: 0 })
  })

  it('keeps metric snapshots observational so sampling cannot consume an expiry event', () => {
    const cache = new VirtualCacheState({ capacityEntries: 1, ttlMs: 10, evictionPolicy: 'fifo' })
    cache.write('stale', 0)

    expect(cache.snapshot(10)).toMatchObject({ entries: 0, occupancy: 0, expirations: 0 })
    expect(cache.snapshot(20)).toMatchObject({ entries: 0, occupancy: 0, expirations: 0 })
    expect(cache.read('stale', 20)).toEqual({ outcome: 'expired' })
    expect(cache.snapshot(20)).toMatchObject({ entries: 0, occupancy: 0, expirations: 1 })
  })

  it('rejects virtual time moving backwards', () => {
    const cache = new VirtualCacheState({ capacityEntries: 1, ttlMs: 100, evictionPolicy: 'fifo' })
    cache.write('a', 20)
    expect(() => cache.read('a', 19)).toThrow(/monotonic/)
  })
})

describe('CDN state', () => {
  it('keeps independent POP caches and fills only the selected POP', () => {
    const cdn = new CdnState({ popCount: 2, popSelection: 'round-robin', capacityEntries: 1, ttlMs: 1_000, evictionPolicy: 'lru' })
    const first = cdn.read('video:1', 1_000, 0)
    expect(first).toMatchObject({ pop: 0, outcome: 'miss' })
    cdn.fill(first.pop, 'video:1', 1_000, 10)
    expect(cdn.read('video:1', 1_000, 20)).toMatchObject({ pop: 1, outcome: 'miss' })
    expect(cdn.read('video:1', 1_000, 30)).toMatchObject({ pop: 0, outcome: 'hit' })
    cdn.recordDelivery(3_000)
    expect(cdn.snapshot(30)).toMatchObject({ requests: 3, hits: 1, misses: 2, originFetches: 1, edgeBytes: 3_000, originBytes: 1_000 })
  })

  it('selects a stable POP for the same key under consistent hashing', () => {
    const cdn = new CdnState({ popCount: 4, popSelection: 'consistent-hash', capacityEntries: 2, ttlMs: 100, evictionPolicy: 'fifo' })
    const expected = stableRendezvousNode('asset:1', 4)
    const first = cdn.read('asset:1', 10, 0)
    cdn.fill(first.pop, 'asset:1', 10, 1)
    expect(first.pop).toBe(expected)
    expect(cdn.read('asset:1', 10, 2)).toMatchObject({ pop: expected, outcome: 'hit' })
    expect(cdn.read('asset:1', 10, 101)).toMatchObject({ pop: expected, outcome: 'expired' })
  })

  it('uses consistent rendezvous hashing when a POP is added', () => {
    for (let index = 0; index < 100; index += 1) {
      const before = stableRendezvousNode(`asset:${index}`, 4)
      const after = stableRendezvousNode(`asset:${index}`, 5)
      expect(after === before || after === 4).toBe(true)
    }
  })

  it('distributes rendezvous keys across a non-power-of-two POP count', () => {
    const counts = Array.from({ length: 5 }, () => 0)
    for (let index = 0; index < 10_000; index += 1) {
      const pop = stableRendezvousNode(`asset:${index}`, counts.length)
      counts[pop] = counts[pop]! + 1
    }
    expect(Math.max(...counts) / Math.min(...counts)).toBeLessThan(1.2)
  })
})

describe('partitioned stream state', () => {
  it('uses stable key partitioning and exposes consumer-group lag', () => {
    const stream = new PartitionedStreamState(3)
    const published = Array.from({ length: 6 }, (_, index) => stream.publish('key-' + index, 10, index))
    expect(published.map((message) => message.partition)).toEqual(published.map((_, index) => stablePartition('key-' + index, 3)))
    expect(stream.lag('slow')).toBe(6)
    const batch = stream.consume('slow', 2, 10)
    expect(batch).toHaveLength(2)
    expect(stream.lag('slow')).toBe(6)
    stream.acknowledge('slow', batch, 11)
    expect(stream.lag('slow')).toBe(4)
    expect(stream.snapshot('slow')).toMatchObject({ published: 6, consumed: 2, acknowledged: 2, lag: 4 })
  })

  it('keeps independent offsets for fast and slow consumer groups', () => {
    const stream = new PartitionedStreamState(2)
    for (let index = 0; index < 5; index += 1) stream.publish('same-hot-key', 1, index)
    const fastBatch = stream.consume('fast', 5, 5)
    stream.acknowledge('fast', fastBatch, 5)
    expect(stream.lag('fast')).toBe(0)
    expect(stream.lag('slow')).toBe(5)
    expect(stream.snapshot().partitionImbalance).toBe(1)
  })
})

describe('object storage state', () => {
  it('separates operations and successful byte throughput', () => {
    const storage = new ObjectStorageState()
    storage.record('write', 1_000, true, 100)
    storage.record('read', 500, true, 500)
    storage.record('read', 500, false, 1_000)
    expect(storage.snapshot(1_000)).toEqual({
      operations: 3, reads: 2, writes: 1, failedOperations: 1,
      readBytes: 500, writtenBytes: 1_000, failureRate: 1 / 3, byteThroughputPerSecond: 1_500,
    })
  })
})

describe('sharded database state', () => {
  it('routes a hot key to one stable shard and exposes the imbalance', () => {
    const database = new ShardedDatabaseState({ shardCount: 4, replicasPerShard: 0, readPreference: 'primary', replicationDelayMs: 0 })
    for (let index = 0; index < 10; index += 1) database.read('celebrity:1', index)
    const snapshot = database.snapshot(10)
    expect(snapshot.requestsByShard.filter((requests) => requests > 0)).toHaveLength(1)
    expect(snapshot.hottestShardShare).toBe(1)
  })

  it('models the explicit freshness/capacity tradeoff of replica reads', () => {
    const database = new ShardedDatabaseState({ shardCount: 1, replicasPerShard: 2, readPreference: 'replica-preferred', replicationDelayMs: 100 })
    database.write('order:1', 0)
    expect(database.read('order:1', 10)).toMatchObject({ role: 'replica', replica: 0, latestVersion: 1, visibleVersion: 0, staleVersions: 1, replicaLagMs: 90 })
    expect(database.read('order:1', 20)).toMatchObject({ role: 'replica', replica: 1, staleVersions: 1 })
    expect(database.read('order:1', 100)).toMatchObject({ role: 'replica', replica: 0, visibleVersion: 1, staleVersions: 0, replicaLagMs: 0 })
    expect(database.snapshot(100)).toMatchObject({ writes: 1, primaryReads: 0, replicaReads: 3, maxReplicaLagVersions: 0 })
  })
})
