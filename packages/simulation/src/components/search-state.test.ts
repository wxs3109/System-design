import { describe, expect, it } from 'vitest'
import { SearchIndexState } from './search-state'

const config = { shardCount: 1, replicasPerShard: 0, indexingDelayMs: 75, refreshIntervalMs: 100, replicaRefreshDelayMs: 0 }

describe('SearchIndexState', () => {
  it('makes mutations visible only after indexing delay and the next refresh boundary', () => {
    const state = new SearchIndexState(config)
    expect(state.accept('document:1', 'insert', 10).mutation).toMatchObject({ version: 1, visibleAtMs: 100 })
    expect(state.query('document:1', 10, 99)).toMatchObject({ visible: false, stale: true, latestVersion: 1, visibleVersion: 0, visibilityLagMs: 1 })
    expect(state.query('document:1', 10, 100)).toMatchObject({ visible: true, stale: false, latestVersion: 1, visibleVersion: 1 })
  })

  it('keeps replica reads stale after primary refresh until replica delay elapses', () => {
    const state = new SearchIndexState({ ...config, replicasPerShard: 1, indexingDelayMs: 0, replicaRefreshDelayMs: 50 })
    state.accept('document:1', 'insert', 1)
    expect(state.query('document:1', 10, 100)).toMatchObject({ stale: false, visible: true, routes: [{ shard: 0, role: 'primary' }] })
    expect(state.query('document:1', 10, 100)).toMatchObject({ stale: true, visible: false, visibilityLagMs: 50, routes: [{ shard: 0, role: 'replica', replica: 0 }] })
    expect(state.query('document:1', 10, 150)).toMatchObject({ stale: false, visible: true })
    expect(state.snapshot(150)).toMatchObject({ indexedMutations: 1, replicaRefreshedMutations: 1, replicaRefreshBacklog: 0 })
  })

  it('keeps deletion stale until refresh', () => {
    const state = new SearchIndexState({ ...config, indexingDelayMs: 0 })
    state.accept('document:1', 'insert', 0)
    expect(state.query('document:1', 10, 0).visible).toBe(true)
    state.accept('document:1', 'delete', 1)
    expect(state.query('document:1', 10, 99)).toMatchObject({ visible: true, stale: true })
    expect(state.query('document:1', 10, 100)).toMatchObject({ visible: false, stale: false })
  })

  it('fans out across shards, round-robins copies, and counts merge candidates', () => {
    const state = new SearchIndexState({ ...config, shardCount: 2, replicasPerShard: 2, initialDocumentCount: 100 })
    expect(state.query('key:1', 10, 0)).toMatchObject({ fanOut: 2, candidateCount: 20, resultCount: 10, routes: [{ shard: 0, role: 'primary' }, { shard: 1, role: 'primary' }] })
    expect(state.query('key:1', 5, 0).routes).toEqual([{ shard: 0, role: 'replica', replica: 0 }, { shard: 1, role: 'replica', replica: 0 }])
    expect(state.query('key:1', 5, 0).routes).toEqual([{ shard: 0, role: 'replica', replica: 1 }, { shard: 1, role: 'replica', replica: 1 }])
    expect(state.snapshot(0)).toMatchObject({ queriesByShard: [3, 3], primaryShardQueries: 2, replicaShardQueries: 4, candidatesMerged: 40, visibleDocuments: 100 })
  })

  it('applies same-key mutations in version order', () => {
    const state = new SearchIndexState({ ...config, indexingDelayMs: 10 })
    state.accept('document:1', 'insert', 1)
    state.accept('document:1', 'delete', 2)
    state.accept('document:1', 'insert', 3)
    expect(state.query('document:1', 10, 100)).toMatchObject({ visible: true, stale: false, latestVersion: 3, visibleVersion: 3 })
  })

  it('does not invent baseline documents for arbitrary business keys', () => {
    const state = new SearchIndexState({ ...config, initialDocumentCount: 100 })
    expect(state.query('product:missing', 10, 0)).toMatchObject({ visible: false, stale: false })
    expect(state.query('key:99', 10, 0)).toMatchObject({ visible: true, stale: false })
  })

  it('rejects invalid configuration and non-monotonic time', () => {
    expect(() => new SearchIndexState({ ...config, replicaRefreshDelayMs: -1 })).toThrow('replicaRefreshDelayMs')
    const state = new SearchIndexState(config)
    state.query('document:1', 1, 10)
    expect(() => state.snapshot(9)).toThrow('monotonic')
  })
})
