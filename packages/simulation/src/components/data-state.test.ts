import { describe, expect, it } from 'vitest'
import { ObjectStorageState, PartitionedStreamState, ShardedDatabaseState, VirtualCacheState, stablePartition } from './data-state'

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
