import { createRegisteredNode } from '@system-design/components'
import { createEmptyProject, projectFileV3Schema, type ProjectFile } from '@system-design/model'
import { inspectExerciseEvidence, observedQueue } from './exercise-evidence'
import { checkExerciseConstraints, makeExerciseEvaluation, readExerciseParameter } from './exercise-project'
import type { ExerciseCheck, ExerciseDefinition, ExerciseMetrics, ExerciseParameter } from './exercise-types'

const EXERCISE_ID = 'cache-pressure'
const CACHE_ID = 'practice-cache'
const DATABASE_ID = 'practice-cache-database'
const TRAFFIC_ID = 'practice-cache-traffic'
const WORKLOAD_ID = 'practice-cache-reads'
const SEED = 'practice:cache-pressure:v1'
const ARRIVAL_RATE = 200
const ARRIVAL_SECONDS = 10
const DURATION_SECONDS = 20
const KEY_SPACE_SIZE = 64
const MINIMUM_HIT_RATE = 0.85
const MAXIMUM_DATABASE_READ_RATIO = 0.15
const LATENCY_TARGET_MS = 50

const capacityParameter: ExerciseParameter = {
  id: 'cache-capacity', nodeId: CACHE_ID, field: 'capacityEntries', label: '缓存容量', unit: '条',
  choices: [8, 32, 64, 128].map((value) => ({ value, label: `${value} 条缓存` })),
}

const createCachePressureProject = (projectId = `exercise:${EXERCISE_ID}`): ProjectFile => {
  const project = createEmptyProject(projectId)
  project.name = '缓存为什么没有减轻数据库压力？'
  const traffic = createRegisteredNode('traffic', TRAFFIC_ID, { x: 80, y: 180 }, WORKLOAD_ID)
  traffic.name = '200 reads / second'
  const cache = createRegisteredNode('cache', CACHE_ID, { x: 390, y: 180 })
  cache.name = 'Read Cache'
  cache.config = {
    capacityEntries: 8, ttlMs: 60_000, evictionPolicy: 'lru', keySpaceSize: KEY_SPACE_SIZE, hotKeyProbability: 0,
    maxConcurrentRequests: 1_000, operationTimeMs: 1, jitterMs: 0, errorRate: 0, maxQueueSize: 10_000,
  }
  const database = createRegisteredNode('database', DATABASE_ID, { x: 710, y: 280 })
  database.name = 'Read Database'
  database.config = {
    maxConnections: 4, queryTimeMs: 40, jitterMs: 0, errorRate: 0, maxQueueSize: 10_000,
    shardCount: 1, replicasPerShard: 0, readPreference: 'primary', replicationDelayMs: 0,
    writeRatio: 0, keySpaceSize: KEY_SPACE_SIZE, hotKeyProbability: 0,
  }
  project.topology.nodes = [traffic, cache, database]
  project.topology.edges = [{
    id: 'practice-read-cache', source: TRAFFIC_ID, target: CACHE_ID, sourcePort: 'out', targetPort: 'in',
    sourceSemantic: 'request', targetSemantic: 'request', routingMode: 'weighted-one', weight: 1,
  }, {
    id: 'practice-cache-miss', source: CACHE_ID, target: DATABASE_ID, sourcePort: 'miss', targetPort: 'in',
    sourceSemantic: 'miss', targetSemantic: 'request', routingMode: 'weighted-one', weight: 1,
  }]
  const experiment = project.experiments[0]!
  experiment.seed = SEED
  experiment.workloads = [{
    id: WORKLOAD_ID, name: 'Fixed read demand', sourceNodeId: TRAFFIC_ID, requestsPerSecond: ARRIVAL_RATE,
    startAtSeconds: 0, durationSeconds: ARRIVAL_SECONDS, pattern: 'constant', requestBytes: 1_024,
  }]
  experiment.simulation = { durationSeconds: DURATION_SECONDS, sampleIntervalMs: 100, maxRequests: 3_000, traceLimit: 3_000, maxHops: 8 }
  return projectFileV3Schema.parse(project)
}

const closeTo = (actual: unknown, expected: number): boolean => typeof actual === 'number' && Number.isFinite(actual) && Math.abs(actual - expected) < 1e-9

const evaluateCachePressure: ExerciseDefinition['evaluate'] = (input, result) => {
  const checks: ExerciseCheck[] = []
  const metrics: ExerciseMetrics = {}
  const finish = () => makeExerciseEvaluation(checks, metrics, '缓存保留了反复访问的键，实际命中与数据库读取证据满足目标；增加更多容量仍无法免除冷启动的首次读取。')
  const parsed = projectFileV3Schema.safeParse(input)
  if (!parsed.success) {
    checks.push({ id: 'constraints', label: '题目约束', status: 'fail', message: '场景无效，请重新开始本题。' })
    return finish()
  }
  const project = parsed.data
  const constraints = checkExerciseConstraints(project, createCachePressureProject(project.id), [capacityParameter])
  checks.push(constraints)
  metrics.capacityEntries = readExerciseParameter(project, capacityParameter)
  if (constraints.status !== 'pass') return finish()
  const evidence = inspectExerciseEvidence(project, result, {
    sourceNodeId: TRAFFIC_ID, requiredNodeIds: [CACHE_ID, DATABASE_ID],
    observationStartSeconds: 0, observationEndSeconds: ARRIVAL_SECONDS, minimumLatencyMs: 1,
  })
  checks.push(evidence.check)
  Object.assign(metrics, evidence.metrics)
  if (evidence.check.status !== 'pass' || !result) return finish()

  const hits = result.events.filter((event) => event.nodeId === CACHE_ID && event.type === 'cache-hit')
  const misses = result.events.filter((event) => event.nodeId === CACHE_ID && event.type === 'cache-miss')
  const reads = result.events.filter((event) => event.nodeId === DATABASE_ID && event.type === 'database-read')
  const evictions = result.events.filter((event) => event.nodeId === CACHE_ID && event.type === 'cache-evicted')
  const cache = result.nodes.find((node) => node.nodeId === CACHE_ID)!
  const database = result.nodes.find((node) => node.nodeId === DATABASE_ID)!
  const cacheSamples = evidence.samplesByNode.get(CACHE_ID)!
  const lastCache = cacheSamples.at(-1)!.attributes
  const lastDatabase = evidence.samplesByNode.get(DATABASE_ID)!.at(-1)!.attributes
  const requests = new Set(result.events.filter((event) => event.type === 'request-generated' && event.nodeId === TRAFFIC_ID).map((event) => event.requestId))
  const missByRequest = new Map(misses.map((event) => [event.requestId, event]))
  const firstReadByKey = new Map<string, number>()
  for (const read of reads) {
    const key = String(read.attributes.key)
    firstReadByKey.set(key, Math.min(firstReadByKey.get(key) ?? Number.POSITIVE_INFINITY, read.timestampMs))
  }
  const decisions = [...hits, ...misses]
  const hitRate = hits.length / result.summary.generatedRequests
  // Cache resource.capacity is request concurrency. Occupancy binds evidence to entry capacity.
  const domainEvidence = decisions.length === requests.size && new Set(decisions.map((event) => event.requestId)).size === requests.size
    && decisions.every((event) => requests.has(event.requestId) && event.status === 'ok'
      && /^key:\d+$/.test(String(event.attributes.key)) && Number(String(event.attributes.key).slice(4)) < KEY_SPACE_SIZE)
    && reads.length === misses.length && new Set(reads.map((event) => event.requestId)).size === missByRequest.size
    && reads.every((event) => {
      const miss = missByRequest.get(event.requestId)
      return miss !== undefined && event.status === 'ok' && event.attributes.key === miss.attributes.key && event.timestampMs >= miss.timestampMs
    })
    && hits.every((hit) => (firstReadByKey.get(String(hit.attributes.key)) ?? Number.POSITIVE_INFINITY) <= hit.timestampMs)
    && cache.processedRequests === requests.size && database.processedRequests === reads.length
    && cache.details?.cacheHits === hits.length && cache.details?.cacheMisses === misses.length && closeTo(cache.details?.cacheHitRate, hitRate)
    && lastCache.cacheHits === hits.length && lastCache.cacheMisses === misses.length && closeTo(lastCache.cacheHitRate, hitRate)
    && cache.details?.cacheEvictions === evictions.length && lastCache.cacheEvictions === evictions.length
    && database.details?.primaryReads === reads.length && lastDatabase.primaryReads === reads.length
    && database.details?.databaseWrites === 0 && lastDatabase.databaseWrites === 0
    && cacheSamples.every((sample) => typeof sample.attributes.cacheEntries === 'number' && Number.isSafeInteger(sample.attributes.cacheEntries)
      && sample.attributes.cacheEntries >= 0 && sample.attributes.cacheEntries <= metrics.capacityEntries!
      && closeTo(sample.attributes.cacheOccupancy, sample.attributes.cacheEntries / metrics.capacityEntries!))
    && typeof lastCache.cacheEntries === 'number' && lastCache.cacheEntries > 0
  checks.push({ id: 'cache-evidence', label: '缓存与回源证据', status: domainEvidence ? 'pass' : 'inconclusive',
    message: domainEvidence ? '已核对每次命中或未命中、对应数据库读取、成功读取后的命中、淘汰计数和容量占用。'
      : '缺少一致的缓存命中、数据库读取或容量占用证据；请重新运行当前设计。' })
  if (!domainEvidence) return finish()

  metrics.cacheHitRate = hitRate
  metrics.databaseReads = reads.length
  metrics.databaseReadRatio = reads.length / result.summary.generatedRequests
  metrics.cacheEvictions = evictions.length
  metrics.databaseMaxQueue = observedQueue(evidence, DATABASE_ID)!.max
  checks.push({ id: 'completion', label: '请求完成', status: result.summary.failedRequests === 0 ? 'pass' : 'fail', actual: result.summary.failedRequests, expected: 0,
    message: result.summary.failedRequests === 0 ? '全部原定读取成功并完成；没有通过丢弃请求降低数据库负载。' : `${result.summary.failedRequests} 个请求失败，请检查运行。`,
  }, { id: 'cache-hits', label: '真实缓存命中', status: hitRate >= MINIMUM_HIT_RATE ? 'pass' : 'fail', actual: hitRate, expected: '≥ 85%',
    message: `${hits.length} 次命中、${misses.length} 次未命中，实际命中率 ${(hitRate * 100).toFixed(2)}%；目标至少 85%。`,
  }, { id: 'database-load', label: '数据库读取负载', status: metrics.databaseReadRatio <= MAXIMUM_DATABASE_READ_RATIO ? 'pass' : 'fail', actual: reads.length, expected: `≤ ${Math.floor(result.summary.generatedRequests * MAXIMUM_DATABASE_READ_RATIO)} 次`,
    message: `原定 ${result.summary.generatedRequests} 次读取中，${reads.length} 次访问数据库，占 ${(metrics.databaseReadRatio * 100).toFixed(2)}%；到达期间数据库最大采样积压为 ${metrics.databaseMaxQueue}。`,
  }, { id: 'latency', label: '完成请求 p95', status: result.summary.latencyP95Ms <= LATENCY_TARGET_MS ? 'pass' : 'fail', actual: result.summary.latencyP95Ms, expected: `≤ ${LATENCY_TARGET_MS} ms`,
    message: `包含冷启动与排队的完成请求 p95 为 ${result.summary.latencyP95Ms} ms，目标不超过 ${LATENCY_TARGET_MS} ms。`,
  })
  return finish()
}

export const cachePressureExercise: ExerciseDefinition = {
  id: EXERCISE_ID, version: 1,
  title: '缓存为什么没有减轻数据库压力？',
  summary: '从真实命中、淘汰和回源请求中，观察缓存容量与数据库负载的关系。',
  category: '缓存与数据访问', difficulty: '入门', estimatedMinutes: 12,
  introduction: '缓存已经放在数据库前面，但能否减少数据库访问，要看请求的键是否仍在缓存里。',
  givens: [
    { label: '读取流量', value: '200', unit: '请求/秒，持续 10 秒' },
    { label: '候选键集合', value: '64', unit: '个键，固定种子均匀采样' },
    { label: '缓存访问', value: '1', unit: 'ms；LRU；TTL 60 秒' },
    { label: '数据库', value: '4', unit: '个连接，每次读取 40 ms' },
  ],
  flow: ['固定读取流量', 'Cache：命中直接返回', '未命中才读取 Database', '成功读取后填入 Cache'],
  prompt: '先运行只有 8 条容量的空缓存，观察命中率、淘汰次数和数据库读取量。保持请求流量、键集合、TTL 和数据库配置不变，只调整缓存容量，减少回源与排队。每次运行都从空缓存开始，完整运行 20 秒，最后 10 秒用于排空。',
  objectives: [
    '保持固定的读取需求，只修改缓存条目容量。',
    '完整运行中缓存命中率至少 85%，数据库读取量不超过原定请求量的 15%。',
    '全部请求成功并完成，完成请求 p95 不超过 50 ms。',
    '用运行证据解释改善；多种满足目标的容量配置都可以通过。',
  ],
  observationNote: '先看缓存 miss 与数据库读取是否一一对应，再比较命中率和淘汰次数。冷启动的首次 miss 包含在指标中；最终排空不表示流量期间没有排队。',
  parameters: [capacityParameter], focusNodeId: CACHE_ID,
  hints: [
    '缓存能容纳的条目数，与可能被反复访问的键数是什么关系？',
    '每次 miss 都需要等待数据库。成功返回才填入缓存，同一键的并发 miss 不会自动合并。',
    '缓存足够容纳这组键后，继续加大容量是否还会减少首次读取？对比两个满足目标的配置。',
  ],
  boundary: '这是固定读取需求、固定键集合、LRU 与虚拟处理时间的学习模型。同一配置与种子可复现；不实现真实缓存服务器、数据库、更新一致性或跨节点失效。容量单位是条目，不是内存字节。',
  resultMetrics: [
    { key: 'cacheHitRate', label: '缓存命中率', format: 'percent' },
    { key: 'databaseReads', label: '数据库读取', unit: '次' },
    { key: 'cacheEvictions', label: '缓存淘汰', unit: '次' },
    { key: 'databaseMaxQueue', label: '到达期间最大采样积压', unit: '请求' },
    { key: 'latencyP95Ms', label: '完成请求 p95', unit: 'ms' },
  ],
  attemptMetric: { key: 'databaseReads', label: '数据库读取', unit: '次' },
  createProject: createCachePressureProject,
  evaluate: evaluateCachePressure,
}
