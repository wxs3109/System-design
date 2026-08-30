const stableHash = (key: string): number => {
  let hash = 0x811c9dc5
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

export const stablePartition = (key: string, partitionCount: number): number => {
  if (!Number.isInteger(partitionCount) || partitionCount < 1) throw new Error('partitionCount must be a positive integer.')
  return stableHash(key) % partitionCount
}

/** Rendezvous hashing keeps an existing key on its POP unless a newly added POP wins. */
export const stableRendezvousNode = (key: string, nodeCount: number): number => {
  if (!Number.isInteger(nodeCount) || nodeCount < 1) throw new Error('nodeCount must be a positive integer.')
  let selected = 0
  let bestScore = -1
  for (let node = 0; node < nodeCount; node += 1) {
    // Prefix the node identity. With FNV-1a, appending a small integer suffix
    // strongly correlates adjacent node scores and can badly skew non-power-
    // of-two node counts. Prefixing keeps rendezvous scores well distributed.
    const score = stableHash(`${node}\0${key}`)
    if (score > bestScore) { selected = node; bestScore = score }
  }
  return selected
}

const assertVirtualTime = (nowMs: number, previousMs: number) => {
  if (!Number.isFinite(nowMs) || nowMs < previousMs) throw new Error('Virtual time must be finite and monotonic.')
}

export interface CacheStateConfig {
  capacityEntries: number
  ttlMs: number
  evictionPolicy: 'lru' | 'fifo'
}

export type CacheReadResult =
  | { outcome: 'hit'; ageMs: number }
  | { outcome: 'miss' }
  | { outcome: 'expired' }

export interface CacheWriteResult {
  evictedKey?: string
}

export interface CacheSnapshot {
  hits: number
  misses: number
  hitRate: number
  evictions: number
  expirations: number
  entries: number
  occupancy: number
}

interface CacheEntry {
  insertedAtMs: number
  expiresAtMs: number
  sequence: number
  lastAccessSequence: number
}

export class VirtualCacheState {
  private readonly entries = new Map<string, CacheEntry>()
  private sequence = 0
  private lastTimeMs = 0
  private hits = 0
  private misses = 0
  private evictions = 0
  private expirations = 0

  constructor(readonly config: CacheStateConfig) {
    if (!Number.isInteger(config.capacityEntries) || config.capacityEntries < 1) throw new Error('capacityEntries must be a positive integer.')
    if (!Number.isFinite(config.ttlMs) || config.ttlMs <= 0) throw new Error('ttlMs must be positive.')
  }

  read(key: string, nowMs: number): CacheReadResult {
    this.advance(nowMs)
    const entry = this.entries.get(key)
    if (!entry) {
      this.misses += 1
      return { outcome: 'miss' }
    }
    if (entry.expiresAtMs <= nowMs) {
      this.entries.delete(key)
      this.expirations += 1
      this.misses += 1
      return { outcome: 'expired' }
    }
    this.hits += 1
    entry.lastAccessSequence = ++this.sequence
    return { outcome: 'hit', ageMs: nowMs - entry.insertedAtMs }
  }

  write(key: string, nowMs: number, ttlMs = this.config.ttlMs): CacheWriteResult {
    this.advance(nowMs)
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error('ttlMs must be positive.')
    this.removeExpired(nowMs)
    const current = this.entries.get(key)
    if (current) {
      current.insertedAtMs = nowMs
      current.expiresAtMs = nowMs + ttlMs
      current.lastAccessSequence = ++this.sequence
      return {}
    }

    let evictedKey: string | undefined
    if (this.entries.size >= this.config.capacityEntries) {
      const rank = this.config.evictionPolicy === 'lru' ? 'lastAccessSequence' : 'sequence'
      evictedKey = [...this.entries].reduce((oldest, candidate) => candidate[1][rank] < oldest[1][rank] ? candidate : oldest)[0]
      this.entries.delete(evictedKey)
      this.evictions += 1
    }
    const sequence = ++this.sequence
    this.entries.set(key, { insertedAtMs: nowMs, expiresAtMs: nowMs + ttlMs, sequence, lastAccessSequence: sequence })
    return evictedKey === undefined ? {} : { evictedKey }
  }

  delete(key: string, nowMs: number) {
    this.advance(nowMs)
    return this.entries.delete(key)
  }

  expire(nowMs: number): string[] {
    this.advance(nowMs)
    return this.removeExpired(nowMs)
  }

  snapshot(nowMs: number): CacheSnapshot {
    assertVirtualTime(nowMs, this.lastTimeMs)
    const reads = this.hits + this.misses
    const activeEntries = [...this.entries.values()].filter((entry) => entry.expiresAtMs > nowMs).length
    return {
      hits: this.hits,
      misses: this.misses,
      hitRate: reads === 0 ? 0 : this.hits / reads,
      evictions: this.evictions,
      expirations: this.expirations,
      entries: activeEntries,
      occupancy: activeEntries / this.config.capacityEntries,
    }
  }

  private advance(nowMs: number) {
    assertVirtualTime(nowMs, this.lastTimeMs)
    this.lastTimeMs = nowMs
  }

  private removeExpired(nowMs: number): string[] {
    const expiredKeys: string[] = []
    for (const [key, entry] of this.entries) {
      if (entry.expiresAtMs <= nowMs) {
        this.entries.delete(key)
        this.expirations += 1
        expiredKeys.push(key)
      }
    }
    return expiredKeys
  }
}

export interface CdnStateConfig extends CacheStateConfig {
  popCount: number
  popSelection: 'consistent-hash' | 'round-robin'
}

export interface CdnReadResult {
  pop: number
  outcome: CacheReadResult['outcome']
  ageMs?: number
}

export class CdnState {
  private readonly pops: VirtualCacheState[]
  private readonly requestsByPop: number[]
  private roundRobinCursor = 0
  private requests = 0
  private hits = 0
  private misses = 0
  private originFetches = 0
  private edgeBytes = 0
  private originBytes = 0

  constructor(readonly config: CdnStateConfig) {
    if (!Number.isInteger(config.popCount) || config.popCount < 1) throw new Error('popCount must be a positive integer.')
    this.pops = Array.from({ length: config.popCount }, () => new VirtualCacheState(config))
    this.requestsByPop = Array.from({ length: config.popCount }, () => 0)
  }

  read(key: string, bytes: number, nowMs: number): CdnReadResult {
    if (!Number.isInteger(bytes) || bytes < 0) throw new Error('bytes must be a non-negative integer.')
    const pop = this.selectPop(key)
    const result = this.pops[pop]!.read(key, nowMs)
    this.requests += 1
    this.requestsByPop[pop] = this.requestsByPop[pop]! + 1
    if (result.outcome === 'hit') this.hits += 1
    else this.misses += 1
    return { pop, outcome: result.outcome, ...('ageMs' in result ? { ageMs: result.ageMs } : {}) }
  }

  fill(pop: number, key: string, bytes: number, nowMs: number) {
    if (!this.pops[pop]) throw new Error(`Unknown CDN POP: ${pop}.`)
    const write = this.pops[pop]!.write(key, nowMs)
    this.originFetches += 1
    this.originBytes += bytes
    return write
  }

  recordDelivery(bytes: number) {
    if (!Number.isInteger(bytes) || bytes < 0) throw new Error('bytes must be a non-negative integer.')
    this.edgeBytes += bytes
  }

  expire(nowMs: number): Array<{ pop: number; key: string }> {
    return this.pops.flatMap((cache, pop) => cache.expire(nowMs).map((key) => ({ pop, key })))
  }

  snapshot(nowMs: number) {
    const snapshots = this.pops.map((cache) => cache.snapshot(nowMs))
    const maximum = Math.max(...this.requestsByPop)
    const minimum = Math.min(...this.requestsByPop)
    return {
      requests: this.requests, hits: this.hits, misses: this.misses, hitRate: this.requests === 0 ? 0 : this.hits / this.requests,
      originFetches: this.originFetches, edgeBytes: this.edgeBytes, originBytes: this.originBytes, requestsByPop: [...this.requestsByPop],
      popRequestImbalance: this.requests === 0 ? 0 : (maximum - minimum) / this.requests,
      evictions: snapshots.reduce((sum, snapshot) => sum + snapshot.evictions, 0),
      expirations: snapshots.reduce((sum, snapshot) => sum + snapshot.expirations, 0),
      entries: snapshots.reduce((sum, snapshot) => sum + snapshot.entries, 0),
    }
  }

  private selectPop(key: string) {
    if (this.config.popSelection === 'consistent-hash') return stableRendezvousNode(key, this.config.popCount)
    const pop = this.roundRobinCursor
    this.roundRobinCursor = (this.roundRobinCursor + 1) % this.config.popCount
    return pop
  }
}

export interface StreamMessage {
  partition: number
  offset: number
  key: string
  bytes: number
  publishedAtMs: number
}

interface ConsumerGroupState {
  committedOffsets: number[]
  nextPartition: number
}

export class PartitionedStreamState {
  private readonly messages: StreamMessage[][]
  private readonly groups = new Map<string, ConsumerGroupState>()
  private readonly publishedByPartition: number[]
  private lastTimeMs = 0
  private published = 0
  private consumed = 0
  private acknowledged = 0

  constructor(readonly partitionCount: number) {
    if (!Number.isInteger(partitionCount) || partitionCount < 1) throw new Error('partitionCount must be a positive integer.')
    this.messages = Array.from({ length: partitionCount }, () => [])
    this.publishedByPartition = Array.from({ length: partitionCount }, () => 0)
  }

  publish(key: string, bytes: number, nowMs: number): StreamMessage {
    this.advance(nowMs)
    if (!Number.isInteger(bytes) || bytes < 0) throw new Error('bytes must be a non-negative integer.')
    const partition = stablePartition(key, this.partitionCount)
    const bucket = this.messages[partition]!
    const message = { partition, offset: bucket.length, key, bytes, publishedAtMs: nowMs }
    bucket.push(message)
    this.publishedByPartition[partition] = this.publishedByPartition[partition]! + 1
    this.published += 1
    return message
  }

  consume(groupId: string, batchSize: number, nowMs: number): StreamMessage[] {
    this.advance(nowMs)
    if (!Number.isInteger(batchSize) || batchSize < 1) throw new Error('batchSize must be a positive integer.')
    const group = this.group(groupId)
    const cursors = group.committedOffsets.map((offset) => offset + 1)
    const batch: StreamMessage[] = []
    let emptyPartitions = 0
    let partition = group.nextPartition
    while (batch.length < batchSize && emptyPartitions < this.partitionCount) {
      const message = this.messages[partition]![cursors[partition]!]
      if (message) {
        batch.push(message)
        cursors[partition] = cursors[partition]! + 1
        emptyPartitions = 0
      } else {
        emptyPartitions += 1
      }
      partition = (partition + 1) % this.partitionCount
    }
    group.nextPartition = partition
    this.consumed += batch.length
    return batch
  }

  acknowledge(groupId: string, messages: readonly StreamMessage[], nowMs: number) {
    this.advance(nowMs)
    const group = this.group(groupId)
    const highestByPartition = new Map<number, number>()
    for (const message of messages) {
      const stored = this.messages[message.partition]?.[message.offset]
      if (!stored || stored.key !== message.key) throw new Error('Cannot acknowledge an unknown stream message.')
      highestByPartition.set(message.partition, Math.max(highestByPartition.get(message.partition) ?? -1, message.offset))
    }
    for (const [partition, offset] of highestByPartition) {
      const previous = group.committedOffsets[partition]!
      if (offset < previous) continue
      this.acknowledged += offset - previous
      group.committedOffsets[partition] = offset
    }
  }

  lag(groupId: string) {
    const group = this.group(groupId)
    return this.messages.reduce((total, partition, index) => total + partition.length - group.committedOffsets[index]! - 1, 0)
  }

  snapshot(groupId?: string) {
    const maximum = Math.max(...this.publishedByPartition)
    const minimum = Math.min(...this.publishedByPartition)
    return {
      published: this.published,
      consumed: this.consumed,
      acknowledged: this.acknowledged,
      publishedByPartition: [...this.publishedByPartition],
      partitionImbalance: this.published === 0 ? 0 : (maximum - minimum) / this.published,
      ...(groupId === undefined ? {} : { lag: this.lag(groupId) }),
    }
  }

  private group(groupId: string) {
    if (groupId.trim().length === 0) throw new Error('groupId must not be empty.')
    let group = this.groups.get(groupId)
    if (!group) {
      group = { committedOffsets: Array.from({ length: this.partitionCount }, () => -1), nextPartition: 0 }
      this.groups.set(groupId, group)
    }
    return group
  }

  private advance(nowMs: number) {
    assertVirtualTime(nowMs, this.lastTimeMs)
    this.lastTimeMs = nowMs
  }
}

export type ObjectStorageOperation = 'read' | 'write'

export class ObjectStorageState {
  private readonly startedAtMs: number
  private lastTimeMs: number
  private reads = 0
  private writes = 0
  private failedOperations = 0
  private readBytes = 0
  private writtenBytes = 0

  constructor(startedAtMs = 0) {
    if (!Number.isFinite(startedAtMs) || startedAtMs < 0) throw new Error('startedAtMs must be non-negative.')
    this.startedAtMs = startedAtMs
    this.lastTimeMs = startedAtMs
  }

  record(operation: ObjectStorageOperation, bytes: number, success: boolean, nowMs: number) {
    assertVirtualTime(nowMs, this.lastTimeMs)
    if (!Number.isInteger(bytes) || bytes < 0) throw new Error('bytes must be a non-negative integer.')
    this.lastTimeMs = nowMs
    if (operation === 'read') {
      this.reads += 1
      if (success) this.readBytes += bytes
    } else {
      this.writes += 1
      if (success) this.writtenBytes += bytes
    }
    if (!success) this.failedOperations += 1
  }

  snapshot(nowMs: number) {
    assertVirtualTime(nowMs, this.lastTimeMs)
    this.lastTimeMs = nowMs
    const elapsedSeconds = (nowMs - this.startedAtMs) / 1_000
    const operations = this.reads + this.writes
    return {
      operations,
      reads: this.reads,
      writes: this.writes,
      failedOperations: this.failedOperations,
      readBytes: this.readBytes,
      writtenBytes: this.writtenBytes,
      failureRate: operations === 0 ? 0 : this.failedOperations / operations,
      byteThroughputPerSecond: elapsedSeconds === 0 ? 0 : (this.readBytes + this.writtenBytes) / elapsedSeconds,
    }
  }
}

export interface ShardedDatabaseConfig {
  shardCount: number
  replicasPerShard: number
  readPreference: 'primary' | 'replica-preferred' | 'replica-only'
  replicationDelayMs: number
}

export interface DatabaseRoute {
  shard: number
  role: 'primary' | 'replica'
  replica?: number
  latestVersion: number
  visibleVersion: number
  staleVersions: number
  replicaLagMs: number
}

interface PendingReplication {
  version: number
  visibleAtMs: number
}

interface DatabaseReplicaState {
  visibleVersion: number
  pending: PendingReplication[]
  reads: number
}

interface DatabaseShardState {
  primaryVersion: number
  primaryReads: number
  writes: number
  replicas: DatabaseReplicaState[]
  nextReplica: number
}

export class ShardedDatabaseState {
  private readonly shards: DatabaseShardState[]
  private readonly requestsByShard: number[]
  private lastTimeMs = 0

  constructor(readonly config: ShardedDatabaseConfig) {
    if (!Number.isInteger(config.shardCount) || config.shardCount < 1) throw new Error('shardCount must be a positive integer.')
    if (!Number.isInteger(config.replicasPerShard) || config.replicasPerShard < 0) throw new Error('replicasPerShard must be a non-negative integer.')
    if (!Number.isFinite(config.replicationDelayMs) || config.replicationDelayMs < 0) throw new Error('replicationDelayMs must be non-negative.')
    if (config.readPreference === 'replica-only' && config.replicasPerShard === 0) throw new Error('replica-only reads require at least one replica per shard.')
    this.shards = Array.from({ length: config.shardCount }, () => ({
      primaryVersion: 0,
      primaryReads: 0,
      writes: 0,
      replicas: Array.from({ length: config.replicasPerShard }, () => ({ visibleVersion: 0, pending: [], reads: 0 })),
      nextReplica: 0,
    }))
    this.requestsByShard = Array.from({ length: config.shardCount }, () => 0)
  }

  shardForKey(key: string) {
    return stablePartition(key, this.config.shardCount)
  }

  write(key: string, nowMs: number): DatabaseRoute {
    this.advance(nowMs)
    const shardIndex = this.shardForKey(key)
    const shard = this.shards[shardIndex]!
    shard.primaryVersion += 1
    shard.writes += 1
    this.requestsByShard[shardIndex] = this.requestsByShard[shardIndex]! + 1
    for (const replica of shard.replicas) replica.pending.push({ version: shard.primaryVersion, visibleAtMs: nowMs + this.config.replicationDelayMs })
    return { shard: shardIndex, role: 'primary', latestVersion: shard.primaryVersion, visibleVersion: shard.primaryVersion, staleVersions: 0, replicaLagMs: 0 }
  }

  read(key: string, nowMs: number): DatabaseRoute {
    this.advance(nowMs)
    const shardIndex = this.shardForKey(key)
    const shard = this.shards[shardIndex]!
    this.requestsByShard[shardIndex] = this.requestsByShard[shardIndex]! + 1
    if (this.config.readPreference === 'primary' || shard.replicas.length === 0) {
      shard.primaryReads += 1
      return { shard: shardIndex, role: 'primary', latestVersion: shard.primaryVersion, visibleVersion: shard.primaryVersion, staleVersions: 0, replicaLagMs: 0 }
    }

    const replicaIndex = shard.nextReplica % shard.replicas.length
    shard.nextReplica = (shard.nextReplica + 1) % shard.replicas.length
    const replica = shard.replicas[replicaIndex]!
    replica.reads += 1
    const pendingCurrentVersion = [...replica.pending].reverse().find((entry) => entry.version <= shard.primaryVersion)
    return {
      shard: shardIndex,
      role: 'replica',
      replica: replicaIndex,
      latestVersion: shard.primaryVersion,
      visibleVersion: replica.visibleVersion,
      staleVersions: shard.primaryVersion - replica.visibleVersion,
      replicaLagMs: pendingCurrentVersion ? Math.max(0, pendingCurrentVersion.visibleAtMs - nowMs) : 0,
    }
  }

  snapshot(nowMs: number) {
    this.advance(nowMs)
    const totalRequests = this.requestsByShard.reduce((total, count) => total + count, 0)
    const replicas = this.shards.flatMap((shard) => shard.replicas.map((replica) => ({ shard, replica })))
    return {
      requestsByShard: [...this.requestsByShard],
      hottestShardShare: totalRequests === 0 ? 0 : Math.max(...this.requestsByShard) / totalRequests,
      writes: this.shards.reduce((total, shard) => total + shard.writes, 0),
      primaryReads: this.shards.reduce((total, shard) => total + shard.primaryReads, 0),
      replicaReads: replicas.reduce((total, value) => total + value.replica.reads, 0),
      maxReplicaLagVersions: replicas.reduce((maximum, value) => Math.max(maximum, value.shard.primaryVersion - value.replica.visibleVersion), 0),
      maxReplicaLagMs: replicas.reduce((maximum, value) => {
        const pending = value.replica.pending.at(-1)
        return Math.max(maximum, pending ? Math.max(0, pending.visibleAtMs - nowMs) : 0)
      }, 0),
    }
  }

  private advance(nowMs: number) {
    assertVirtualTime(nowMs, this.lastTimeMs)
    this.lastTimeMs = nowMs
    for (const shard of this.shards) {
      for (const replica of shard.replicas) {
        let applied = 0
        while (applied < replica.pending.length && replica.pending[applied]!.visibleAtMs <= nowMs) {
          replica.visibleVersion = replica.pending[applied]!.version
          applied += 1
        }
        if (applied > 0) replica.pending.splice(0, applied)
      }
    }
  }
}
