import { stablePartition } from './data-state'

export type SearchMutationOperation = 'insert' | 'update' | 'delete'

export interface SearchIndexStateConfig {
  shardCount: number
  replicasPerShard: number
  indexingDelayMs: number
  refreshIntervalMs: number
  replicaRefreshDelayMs: number
  initialDocumentCount?: number
}

export interface SearchMutation {
  key: string
  operation: SearchMutationOperation
  version: number
  shard: number
  acceptedAtMs: number
  visibleAtMs: number
  replicaVisibleAtMs: number
}

export interface SearchReplicaRefresh { mutation: SearchMutation; replica: number }
export interface SearchRefreshResult { primary: SearchMutation[]; replicas: SearchReplicaRefresh[] }
export interface SearchQueryRoute { shard: number; role: 'primary' | 'replica'; replica?: number }
export interface SearchQueryResult {
  routes: SearchQueryRoute[]
  fanOut: number
  candidateCount: number
  resultCount: number
  visible: boolean
  stale: boolean
  latestVersion: number
  visibleVersion: number
  visibilityLagMs: number
  refresh: SearchRefreshResult
}

interface SearchDocumentState { version: number; present: boolean }
interface SearchCopyState { documents: Map<string, SearchDocumentState>; visibleDocuments: number }
interface SearchShardState { primary: SearchCopyState; replicas: SearchCopyState[] }
interface PendingMutation extends SearchMutation { sequence: number; primaryApplied: boolean; replicasApplied: boolean[] }

const emptyRefresh = (): SearchRefreshResult => ({ primary: [], replicas: [] })

/** Models near-real-time refresh visibility and per-copy routing, not analyzers, ranking, or segments. */
export class SearchIndexState {
  private readonly authoritative = new Map<string, SearchDocumentState>()
  private readonly pending: PendingMutation[] = []
  private readonly shards: SearchShardState[]
  private readonly nextCopyByShard: number[]
  private readonly queriesByShard: number[]
  private readonly initialDocumentCount: number
  private sequence = 0
  private lastTimeMs = 0
  private acceptedWrites = 0
  private acceptedDeletes = 0
  private indexedMutations = 0
  private replicaRefreshedMutations = 0
  private queries = 0
  private staleQueries = 0
  private primaryShardQueries = 0
  private replicaShardQueries = 0
  private candidatesMerged = 0

  constructor(readonly config: SearchIndexStateConfig) {
    if (!Number.isInteger(config.shardCount) || config.shardCount < 1) throw new Error('shardCount must be a positive integer.')
    if (!Number.isInteger(config.replicasPerShard) || config.replicasPerShard < 0) throw new Error('replicasPerShard must be a non-negative integer.')
    if (!Number.isFinite(config.indexingDelayMs) || config.indexingDelayMs < 0) throw new Error('indexingDelayMs must be non-negative.')
    if (!Number.isFinite(config.refreshIntervalMs) || config.refreshIntervalMs <= 0) throw new Error('refreshIntervalMs must be positive.')
    if (!Number.isFinite(config.replicaRefreshDelayMs) || config.replicaRefreshDelayMs < 0) throw new Error('replicaRefreshDelayMs must be non-negative.')
    if (!Number.isInteger(config.initialDocumentCount ?? 0) || (config.initialDocumentCount ?? 0) < 0) throw new Error('initialDocumentCount must be a non-negative integer.')
    this.initialDocumentCount = config.initialDocumentCount ?? 0
    this.shards = Array.from({ length: config.shardCount }, (_, shard) => {
      const visibleDocuments = Math.floor(this.initialDocumentCount / config.shardCount) + (shard < this.initialDocumentCount % config.shardCount ? 1 : 0)
      const copy = (): SearchCopyState => ({ documents: new Map(), visibleDocuments })
      return { primary: copy(), replicas: Array.from({ length: config.replicasPerShard }, copy) }
    })
    this.nextCopyByShard = Array.from({ length: config.shardCount }, () => 0)
    this.queriesByShard = Array.from({ length: config.shardCount }, () => 0)
  }

  accept(key: string, operation: SearchMutationOperation, nowMs: number): { mutation: SearchMutation; refresh: SearchRefreshResult } {
    const refresh = this.advance(nowMs)
    const current = this.authoritativeRecord(key)
    const version = current.version + 1
    const visibleAtMs = this.nextRefreshAtOrAfter(nowMs + this.config.indexingDelayMs)
    const mutation: PendingMutation = {
      key, operation, version, shard: stablePartition(key, this.config.shardCount), acceptedAtMs: nowMs, visibleAtMs,
      replicaVisibleAtMs: visibleAtMs + this.config.replicaRefreshDelayMs, sequence: ++this.sequence, primaryApplied: false,
      replicasApplied: Array.from({ length: this.config.replicasPerShard }, () => false),
    }
    this.authoritative.set(key, { version, present: operation !== 'delete' })
    this.pending.push(mutation)
    this.acceptedWrites += 1
    if (operation === 'delete') this.acceptedDeletes += 1
    return { mutation: this.publicMutation(mutation), refresh: this.combineRefresh(refresh, this.advance(nowMs)) }
  }

  query(key: string, resultLimit: number, nowMs: number): SearchQueryResult {
    if (!Number.isInteger(resultLimit) || resultLimit < 1) throw new Error('resultLimit must be a positive integer.')
    const refresh = this.advance(nowMs)
    const routes = Array.from({ length: this.config.shardCount }, (_, shard) => this.routeShard(shard))
    const keyRoute = routes[stablePartition(key, this.config.shardCount)]!
    const visible = this.copyRecord(this.copyForRoute(keyRoute), key)
    const latest = this.authoritativeRecord(key)
    const stale = latest.version !== visible.version || latest.present !== visible.present
    const candidateCount = routes.reduce((total, route) => total + Math.min(resultLimit, this.copyForRoute(route).visibleDocuments), 0)
    this.queries += 1
    this.candidatesMerged += candidateCount
    if (stale) this.staleQueries += 1
    return {
      routes, fanOut: routes.length, candidateCount, resultCount: Math.min(resultLimit, candidateCount), visible: visible.present, stale,
      latestVersion: latest.version, visibleVersion: visible.version, visibilityLagMs: stale ? this.visibilityLagFor(key, keyRoute, nowMs) : 0, refresh,
    }
  }

  advance(nowMs: number): SearchRefreshResult {
    this.assertTime(nowMs)
    this.lastTimeMs = nowMs
    const refresh = emptyRefresh()
    for (const mutation of this.pending) {
      if (!mutation.primaryApplied && mutation.visibleAtMs <= nowMs) {
        this.apply(this.shards[mutation.shard]!.primary, mutation)
        mutation.primaryApplied = true
        this.indexedMutations += 1
        refresh.primary.push(this.publicMutation(mutation))
      }
      if (mutation.replicaVisibleAtMs <= nowMs) mutation.replicasApplied.forEach((applied, replica) => {
        if (applied) return
        this.apply(this.shards[mutation.shard]!.replicas[replica]!, mutation)
        mutation.replicasApplied[replica] = true
        this.replicaRefreshedMutations += 1
        refresh.replicas.push({ mutation: this.publicMutation(mutation), replica })
      })
    }
    for (let index = this.pending.length - 1; index >= 0; index -= 1) {
      const mutation = this.pending[index]!
      if (mutation.primaryApplied && mutation.replicasApplied.every(Boolean)) this.pending.splice(index, 1)
    }
    return refresh
  }

  snapshot(nowMs: number) {
    const refresh = this.advance(nowMs)
    const maximum = Math.max(...this.queriesByShard)
    const minimum = Math.min(...this.queriesByShard)
    const primaryPending = this.pending.filter((mutation) => !mutation.primaryApplied)
    const replicaRefreshBacklog = this.pending.reduce((total, mutation) => total + mutation.replicasApplied.filter((applied) => !applied).length, 0)
    return {
      acceptedWrites: this.acceptedWrites, acceptedDeletes: this.acceptedDeletes, indexedMutations: this.indexedMutations,
      replicaRefreshedMutations: this.replicaRefreshedMutations, visibleDocuments: this.shards.reduce((total, shard) => total + shard.primary.visibleDocuments, 0),
      pendingMutations: primaryPending.length, replicaRefreshBacklog, queries: this.queries, staleQueries: this.staleQueries,
      staleQueryRate: this.queries === 0 ? 0 : this.staleQueries / this.queries, candidatesMerged: this.candidatesMerged,
      shardSearches: this.queries * this.config.shardCount, primaryShardQueries: this.primaryShardQueries, replicaShardQueries: this.replicaShardQueries,
      queriesByShard: [...this.queriesByShard], shardQueryImbalance: this.queries === 0 ? 0 : (maximum - minimum) / this.queries,
      maximumRefreshLagMs: this.pending.reduce((maximumLag, mutation) => Math.max(maximumLag,
        mutation.primaryApplied ? 0 : Math.max(0, mutation.visibleAtMs - nowMs),
        mutation.replicasApplied.some((applied) => !applied) ? Math.max(0, mutation.replicaVisibleAtMs - nowMs) : 0), 0),
      refresh,
    }
  }

  private routeShard(shard: number): SearchQueryRoute {
    this.queriesByShard[shard] = this.queriesByShard[shard]! + 1
    const copies = this.config.replicasPerShard + 1
    const selected = this.nextCopyByShard[shard]! % copies
    this.nextCopyByShard[shard] = (selected + 1) % copies
    if (selected === 0) { this.primaryShardQueries += 1; return { shard, role: 'primary' } }
    this.replicaShardQueries += 1
    return { shard, role: 'replica', replica: selected - 1 }
  }

  private copyForRoute(route: SearchQueryRoute) {
    return route.role === 'primary' ? this.shards[route.shard]!.primary : this.shards[route.shard]!.replicas[route.replica!]!
  }

  private apply(copy: SearchCopyState, mutation: PendingMutation) {
    const previous = this.copyRecord(copy, mutation.key)
    if (mutation.version <= previous.version) return
    const present = mutation.operation !== 'delete'
    if (previous.present !== present) copy.visibleDocuments += present ? 1 : -1
    copy.documents.set(mutation.key, { version: mutation.version, present })
  }

  private authoritativeRecord(key: string): SearchDocumentState { return this.authoritative.get(key) ?? { version: 0, present: this.baselineContains(key) } }
  private copyRecord(copy: SearchCopyState, key: string): SearchDocumentState { return copy.documents.get(key) ?? { version: 0, present: this.baselineContains(key) } }
  private baselineContains(key: string) {
    if (this.initialDocumentCount === 0) return false
    const match = /^key:(\d+)$/.exec(key)
    return match !== null && Number(match[1]) < this.initialDocumentCount
  }
  private visibilityLagFor(key: string, route: SearchQueryRoute, nowMs: number) {
    const pending = [...this.pending].reverse().find((mutation) => mutation.key === key && (route.role === 'primary' ? !mutation.primaryApplied : !mutation.replicasApplied[route.replica!]))
    return pending ? Math.max(0, (route.role === 'primary' ? pending.visibleAtMs : pending.replicaVisibleAtMs) - nowMs) : 0
  }
  private nextRefreshAtOrAfter(nowMs: number) { return Math.ceil(nowMs / this.config.refreshIntervalMs) * this.config.refreshIntervalMs }
  private assertTime(nowMs: number) { if (!Number.isFinite(nowMs) || nowMs < this.lastTimeMs) throw new Error('Virtual time must be finite and monotonic.') }
  private publicMutation(mutation: PendingMutation): SearchMutation {
    const { sequence: _sequence, primaryApplied: _primaryApplied, replicasApplied: _replicasApplied, ...value } = mutation
    return value
  }
  private combineRefresh(left: SearchRefreshResult, right: SearchRefreshResult): SearchRefreshResult { return { primary: [...left.primary, ...right.primary], replicas: [...left.replicas, ...right.replicas] } }
}
