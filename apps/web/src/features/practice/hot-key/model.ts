import { asciiCompare, distribute, fingerprint, hashV1, makeInput, parseInput, same, type DistributionInput, type DistributionResult } from '../distribution/model'

export interface ReadRequest { id: string; index: number; atMs: number; key: string; gate: number; choice: number }
export interface Workload {
  version: 'reads-v1'
  sampler: 'murmur-counter-v1'
  seed: string
  count: number
  pattern: 'uniform' | 'hotspot'
  hotKey: string
  probability: number
  requests: ReadRequest[]
}
export interface CachePolicy { enabled: boolean; capacity: number; ttlMs: number }
export interface HotInput { modelVersion: 'hot-key-v1'; distribution: DistributionInput; workload: Workload; cache: CachePolicy }
export interface ReadEvent {
  id: string; index: number; atMs: number; key: string; owner: string
  outcome: 'bypass' | 'hit' | 'miss'
  expired: string[]; evicted: string | null; filled: boolean; expiresAt: number | null; backendRead: boolean
}
export interface ReadTotals { reads: number; bypasses: number; lookups: number; hits: number; misses: number; backendReads: number; expiries: number; evictions: number; fills: number }
export interface HotResult {
  modelVersion: 'hot-key-v1'
  distribution: DistributionResult
  totals: ReadTotals
  /** requests attributes offered reads to their key owner before cache;
   * backendReads counts the modeled accesses that actually reach that owner. */
  nodes: { nodeId: string; keys: number; requests: number; backendReads: number }[]
  keys: { key: string; owner: string; requests: number; backendReads: number }[]
  events: ReadEvent[]
  cacheEntries: { key: string; expiresAt: number }[]
  maxRequestShare: number
  observedHotShare: number
  hitRate: number | null
}
export interface HotComparison {
  kind: 'cache' | 'distribution' | 'workload' | 'combined' | 'unchanged' | 'incompatible'
  sameRequests: boolean
  sameSamples: boolean
  backendSaved: number | null
}
export const cacheOff: CachePolicy = { enabled: false, capacity: 64, ttlMs: 1000 }

/** Each index has two independent hash domains. UI edits never consume RNG state.
 * Uniform uses choice / 2^32. Hotspot uses gate / 2^32 < p; choice selects
 * uniformly from the remaining K-1 keys. Counter bytes use the existing hashV1.
 */
export function generateWorkload(distribution: DistributionInput, options: Partial<Omit<Workload, 'requests' | 'version' | 'sampler'>> = {}): Workload {
  const keys = parseInput(distribution).keys
  const settings = { seed: 'hot-reads', count: 10000, pattern: 'hotspot' as const, hotKey: keys[0]!, probability: .8, ...options }
  if (!keys.includes(settings.hotKey) || ![1000, 10000, 20000].includes(settings.count) || !['uniform', 'hotspot'].includes(settings.pattern) || ![.2, .8, .95].includes(settings.probability) || typeof settings.seed !== 'string' || !settings.seed.length || settings.seed.length > 80) throw new Error('读取负载参数无效。')
  const others = keys.filter((key) => key !== settings.hotKey)
  const requests = Array.from({ length: settings.count }, (_, index) => {
    const gate = hashV1(JSON.stringify(['read-v1', settings.seed, index, 'gate']))
    const choice = hashV1(JSON.stringify(['read-v1', settings.seed, index, 'choice']))
    const key = settings.pattern === 'uniform' ? keys[Math.floor(choice / 2 ** 32 * keys.length)]! : gate / 2 ** 32 < settings.probability ? settings.hotKey : others[Math.floor(choice / 2 ** 32 * others.length)]!
    return { id: `read-${String(index).padStart(5, '0')}`, index, atMs: index, key, gate, choice }
  })
  return { version: 'reads-v1', sampler: 'murmur-counter-v1', ...settings, requests }
}
export function defaultHotInput(): HotInput {
  const distribution = { ...makeInput('hot-key', 1024), method: 'vnodes' as const, virtualNodes: 32 }
  return { modelVersion: 'hot-key-v1', distribution, workload: generateWorkload(distribution), cache: { ...cacheOff } }
}
export function parseHotInput(value: unknown): HotInput {
  if (!value || typeof value !== 'object') throw new Error('缺少热点实验输入。')
  const input = value as HotInput
  const distribution = parseInput(input.distribution)
  const work = input.workload
  const cache = input.cache
  if (input.modelVersion !== 'hot-key-v1' || !work || work.version !== 'reads-v1' || work.sampler !== 'murmur-counter-v1') throw new Error('未知热点模型或采样器版本。')
  if (typeof work.seed !== 'string' || !work.seed.length || work.seed.length > 80 || ![1000, 10000, 20000].includes(work.count) || !['uniform', 'hotspot'].includes(work.pattern) || ![.2, .8, .95].includes(work.probability) || !distribution.keys.includes(work.hotKey)) throw new Error('读取负载参数无效。')
  const keys = new Set(distribution.keys)
  const uint = (n: number) => Number.isInteger(n) && n >= 0 && n < 2 ** 32
  if (!Array.isArray(work.requests) || work.requests.length !== work.count || work.requests.some((request, index) => !request || request.index !== index || request.atMs !== index || request.id !== `read-${String(index).padStart(5, '0')}` || !keys.has(request.key) || !uint(request.gate) || !uint(request.choice))) throw new Error('请求序列缺失、乱序或字段无效。')
  if (!cache || typeof cache.enabled !== 'boolean' || ![16, 64, 256].includes(cache.capacity) || ![100, 1000, 60000].includes(cache.ttlMs)) throw new Error('缓存策略无效。')
  return { modelVersion: 'hot-key-v1', distribution, workload: work, cache: { enabled: cache.enabled, capacity: cache.capacity, ttlMs: cache.ttlMs } }
}
export const hotFingerprint = (input: HotInput) => JSON.stringify([input.modelVersion, fingerprint(input.distribution), input.workload, input.cache.enabled ? input.cache : { enabled: false }])

/** Low-level sequential read model, also used with tiny explicit schedules in tests.
 * A Map in oldest-access order implements LRU. Expiry is global cleanup before
 * lookup; hits move an entry without renewing its fill-time TTL.
 */
export function executeReads(distribution: DistributionResult, workload: Pick<Workload, 'requests' | 'hotKey'>, cache: CachePolicy): HotResult {
  const totals: ReadTotals = { reads: 0, bypasses: 0, lookups: 0, hits: 0, misses: 0, backendReads: 0, expiries: 0, evictions: 0, fills: 0 }
  const entries = new Map<string, number>()
  const nodes = distribution.counts.map((item) => ({ nodeId: item.nodeId, keys: item.count, requests: 0, backendReads: 0 }))
  const keys = distribution.assignments.map((item) => ({ key: item.key, owner: item.owner, requests: 0, backendReads: 0 }))
  const nodeMap = new Map(nodes.map((node) => [node.nodeId, node]))
  const keyMap = new Map(keys.map((key) => [key.key, key]))
  const events = workload.requests.map((request) => {
    const key = keyMap.get(request.key)
    if (!key) throw new Error('请求指向未知 key。')
    const node = nodeMap.get(key.owner)!
    totals.reads++; key.requests++; node.requests++
    const expired: string[] = []
    if (cache.enabled) for (const [entry, expiresAt] of entries) if (expiresAt <= request.atMs) { entries.delete(entry); expired.push(entry); totals.expiries++ }
    let outcome: ReadEvent['outcome'] = 'bypass'
    let filled = false
    let evicted: string | null = null
    let expiresAt: number | null = null
    if (!cache.enabled) totals.bypasses++
    else {
      totals.lookups++
      const entry = entries.get(request.key)
      if (entry !== undefined) {
        outcome = 'hit'; totals.hits++; expiresAt = entry
        entries.delete(request.key); entries.set(request.key, entry)
      } else {
        outcome = 'miss'; totals.misses++; totals.fills++; filled = true
        if (entries.size >= cache.capacity) { evicted = entries.keys().next().value!; entries.delete(evicted); totals.evictions++ }
        expiresAt = request.atMs + cache.ttlMs
        entries.set(request.key, expiresAt)
      }
    }
    const backendRead = outcome !== 'hit'
    if (backendRead) { totals.backendReads++; key.backendReads++; node.backendReads++ }
    return { id: request.id, index: request.index, atMs: request.atMs, key: request.key, owner: key.owner, outcome, expired, evicted, filled, expiresAt, backendRead }
  })
  return { modelVersion: 'hot-key-v1', distribution, totals, nodes, keys, events,
    cacheEntries: [...entries].map(([key, expiresAt]) => ({ key, expiresAt })),
    maxRequestShare: Math.max(...nodes.map((node) => node.requests)) / (totals.reads || 1),
    observedHotShare: (keyMap.get(workload.hotKey)?.requests ?? 0) / (totals.reads || 1),
    hitRate: cache.enabled ? totals.hits / (totals.lookups || 1) : null }
}
export function runHotModel(value: HotInput): HotResult {
  const input = parseHotInput(value)
  const { seed, count, pattern, hotKey, probability } = input.workload
  if (!same(generateWorkload(input.distribution, { seed, count, pattern, hotKey, probability }), input.workload)) throw new Error('请求序列与声明的采样器、种子或负载不符。')
  return executeReads(distribute(input.distribution), input.workload, input.cache)
}
export function compareHot(beforeInput: HotInput, before: HotResult, afterInput: HotInput, after: HotResult): HotComparison {
  const a = beforeInput.workload
  const b = afterInput.workload
  const sameCorpus = same(beforeInput.distribution.keys, afterInput.distribution.keys) && beforeInput.distribution.modelVersion === afterInput.distribution.modelVersion
  const sameSamples = sameCorpus && a.version === b.version && a.sampler === b.sampler && a.seed === b.seed && a.count === b.count && a.requests.every((request, i) => request.gate === b.requests[i]?.gate && request.choice === b.requests[i]?.choice && request.atMs === b.requests[i]?.atMs)
  const sameRequests = sameSamples && a.requests.every((request, i) => request.id === b.requests[i]?.id && request.key === b.requests[i]?.key)
  const distributionChanged = fingerprint(beforeInput.distribution) !== fingerprint(afterInput.distribution)
  const cacheChanged = !same(beforeInput.cache.enabled ? beforeInput.cache : { enabled: false }, afterInput.cache.enabled ? afterInput.cache : { enabled: false })
  const workloadChanged = a.pattern !== b.pattern || a.hotKey !== b.hotKey || a.probability !== b.probability || !sameRequests
  const changes = [distributionChanged, cacheChanged, workloadChanged].filter(Boolean).length
  const kind = !sameSamples ? 'incompatible' : changes > 1 ? 'combined' : distributionChanged ? 'distribution' : cacheChanged ? 'cache' : workloadChanged ? 'workload' : 'unchanged'
  return { kind, sameRequests, sameSamples, backendSaved: sameRequests ? before.totals.backendReads - after.totals.backendReads : null }
}
export const topKeys = (result: HotResult) => [...result.keys].sort((a, b) => b.requests - a.requests || asciiCompare(a.key, b.key))
