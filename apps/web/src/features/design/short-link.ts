import { createRegisteredNode } from '@system-design/components'
import { createEmptyProject, projectFileV3Schema, simulationInputSignature, type ProjectFile, type RuntimeEvent } from '@system-design/model'
import { inspectExerciseEvidence } from '../practice/exercise-evidence'
import { makeExerciseEvaluation, stableJson } from '../practice/exercise-project'
import type { ExerciseCheck } from '../practice/exercise-types'
import type { DesignExercise, DesignTool } from './types'

const SOURCE = 'short-link-readers'
const KEY_COUNT = 64
export const shortLinkTools: readonly DesignTool[] = [
  { type: 'service', label: '跳转 Service', limit: 1, fields: [{ key: 'replicas', label: 'Service 副本', values: [1, 2, 3] }], create: (id, index) => {
    const node = createRegisteredNode('service', id, { x: 330, y: 100 + index * 120 })
    node.name = 'Redirect Service'
    node.config = { replicas: 1, concurrencyPerReplica: 4, serviceTimeMs: 10, jitterMs: 0, errorRate: 0, maxQueueSize: 5000 }
    return node
  } },
  { type: 'database', label: '映射 Database', limit: 1, fields: [{ key: 'maxConnections', label: '数据库连接', values: [2, 4, 8, 12] }], create: (id, index) => {
    const node = createRegisteredNode('database', id, { x: 910, y: 100 + index * 120 })
    node.name = 'Code → URL Database'
    node.config = { maxConnections: 2, queryTimeMs: 40, jitterMs: 0, errorRate: 0, maxQueueSize: 5000, shardCount: 1, replicasPerShard: 0, readPreference: 'primary', replicationDelayMs: 0, writeRatio: 0, keySpaceSize: KEY_COUNT, hotKeyProbability: 0 }
    return node
  } },
  { type: 'cache', label: '映射 Cache（可选）', limit: 1, fields: [{ key: 'capacityEntries', label: '缓存条目', values: [8, 32, 64, 128] }], create: (id, index) => {
    const node = createRegisteredNode('cache', id, { x: 620, y: 100 + index * 120 })
    node.name = 'Code → URL Cache'
    node.config = { capacityEntries: 8, ttlMs: 60000, evictionPolicy: 'lru', keySpaceSize: KEY_COUNT, hotKeyProbability: 0, maxConcurrentRequests: 1000, operationTimeMs: 1, jitterMs: 0, errorRate: 0, maxQueueSize: 5000 }
    return node
  } },
]

export const designEdge = (source: string, target: string, port: 'out' | 'miss' = 'out') => ({ id: `${source}:${port}:${target}`, source, target, sourcePort: port, targetPort: 'in', sourceSemantic: port === 'miss' ? 'miss' as const : 'request' as const, targetSemantic: 'request' as const, routingMode: 'weighted-one' as const, weight: 1 })

export function createShortLinkProject(id = 'design:short-link:v1'): ProjectFile {
  const project = createEmptyProject(id)
  project.name = '短链接 · 读取路径'
  const source = createRegisteredNode('traffic', SOURCE, { x: 40, y: 100 }, 'short-link-reads')
  source.name = '固定短码读取'
  project.topology.nodes = [source]
  const experiment = project.experiments[0]!
  experiment.seed = 'short-link-read-path-v1'
  experiment.workloads = [{ id: 'short-link-reads', name: '200 reads/s · 64 existing codes', sourceNodeId: SOURCE, requestsPerSecond: 200, pattern: 'constant', startAtSeconds: 0, durationSeconds: 5, requestBytes: 512 }]
  experiment.simulation = { durationSeconds: 25, sampleIntervalMs: 250, maxRequests: 1500, traceLimit: 1500, maxHops: 8 }
  return projectFileV3Schema.parse(project)
}

export function shortLinkPreset(id: string, cache: boolean, connections: number, capacity = 64): ProjectFile {
  const project = createShortLinkProject(id)
  const service = shortLinkTools[0]!.create('redirect', 0)
  const database = shortLinkTools[1]!.create('mappings', 0)
  database.config.maxConnections = connections
  project.topology.nodes.push(service, database)
  project.topology.edges.push(designEdge(SOURCE, service.id))
  if (cache) {
    const node = shortLinkTools[2]!.create('code-cache', 0)
    node.config.capacityEntries = capacity
    project.topology.nodes.push(node)
    project.topology.edges.push(designEdge(service.id, node.id), designEdge(node.id, database.id, 'miss'))
  } else project.topology.edges.push(designEdge(service.id, database.id))
  return projectFileV3Schema.parse(project)
}

export function shortLinkEditIssue(project: ProjectFile): string | undefined {
  const baseline = createShortLinkProject(project.id)
  const normalized = structuredClone(project)
  normalized.name = baseline.name
  normalized.topology = structuredClone(baseline.topology)
  if (stableJson(normalized) !== stableJson(baseline)) return '流量、种子、运行时间及业务定义是固定实验条件，请恢复初始场景。'
  if (project.topology.groups.length || project.topology.policies.length) return '本关不支持额外分组或策略。'
  const sources = project.topology.nodes.filter((node) => node.type === 'traffic')
  if (sources.length !== 1 || !sources[0] || stableJson({ ...sources[0], name: baseline.topology.nodes[0]!.name, position: baseline.topology.nodes[0]!.position }) !== stableJson(baseline.topology.nodes[0])) return '必须保留固定的短码读取源。'
  for (const tool of shortLinkTools) {
    const nodes = project.topology.nodes.filter((node) => node.type === tool.type)
    if (nodes.length > tool.limit) return `${tool.label} 最多 ${tool.limit} 个。`
    for (const node of nodes) {
      const expected = tool.create(node.id, 0)
      const actual = structuredClone(node)
      actual.name = expected.name; actual.position = expected.position
      for (const field of tool.fields) {
        if (!field.values.includes(Number(node.config[field.key]))) return `${field.label} 必须选用题目给定的值。`
        actual.config[field.key] = expected.config[field.key]
      }
      if (stableJson(actual) !== stableJson(expected)) return `${tool.label} 只允许调整列出的参数；处理耗时、键空间和错误率不可修改。`
    }
  }
  if (project.topology.nodes.some((node) => node.type !== 'traffic' && !shortLinkTools.some((tool) => tool.type === node.type))) return '本关只允许 Service、Database 和可选 Cache。'
  if (project.topology.edges.some((edge) => edge.routingMode !== 'weighted-one' || edge.weight !== 1 || edge.targetPort !== 'in' || edge.targetSemantic !== 'request' || !['out', 'miss'].includes(edge.sourcePort) || edge.sourceSemantic !== (edge.sourcePort === 'miss' ? 'miss' : 'request'))) return '本关只允许同步请求连接；缓存未命中必须使用 miss 出口。'
  return undefined
}

export const shortLinkExercise: DesignExercise = {
  id: 'design-short-link', version: 1, kind: 'design', title: '短链接设计：跳转读取路径', category: '综合设计', difficulty: '基础', estimatedMinutes: 30,
  summary: '从空白搭建短码读取路径，比较数据库扩容与缓存方案，用每次请求的证据验证设计。',
  introduction: '营销活动把一个短码推成热门链接。用户希望点开即跳转，但所有请求直接落到小数据库时，排队会迅速增加。',
  pains: ['读多写少：同一个映射会被重复访问。', '活动流量让数据库连接成为瓶颈；仅增加 API 副本可能无效。', '缓存能够减轻读取压力，但冷启动仍需要正确回源，不能凭空返回成功。'],
  requirements: ['产品需求：创建短链接、按短码跳转、处理不存在或过期的短码。', '本关验证：读取已经存在的 64 个不可变短码；每次读取必须经过跳转服务并获得映射。', '固定 200 请求/秒，持续 5 秒，最后 20 秒排空；全部成功，p95 ≤ 250 ms。', '最多 1 个 Service（1–3 副本）、1 个 Database（2–12 连接）、1 个可选 Cache（8–128 条）。'],
  contracts: [
    { name: 'POST /links', description: '产品设计接口：longUrl → code；需要讨论唯一性与创建幂等。本关不执行创建。' },
    { name: 'GET /:code', description: '查 code → longUrl，再返回跳转；本关模拟查询路径和耗时，不发送真实 HTTP 302。' },
    { name: 'Link(code PK, longUrl, expiresAt)', description: 'code 唯一索引支持点查；缓存键 link:{code}。当前固定已有键，不模拟 URL 值或过期业务。' },
  ],
  decisions: ['为什么数据库连接数足够时可以不用缓存？', 'Cache 方案节省了多少数据库读取，增加了哪些运行维护成本？', '如果短链接允许撤销，60 秒 TTL 会带来什么业务风险？'],
  exclusions: ['短码生成与碰撞处理、恶意链接审查、统计去重。', '创建/修改/撤销一致性、过期与不存在的短码、多地域故障。', '本题通过只证明固定读取场景达到目标，不代表完整短链接产品已经实现。'],
  relatedLabs: [{ id: 'cache-pressure', title: '缓存压力' }, { id: 'database-bottleneck', title: '数据库瓶颈' }, { id: 'hot-key', title: 'Hot Key' }, { id: 'retry-idempotency', title: '重试与幂等' }],
  givens: [{ label: '固定流量', value: '200', unit: '请求/秒' }, { label: '已有短码', value: '64', unit: '个' }, { label: '延迟目标', value: '≤ 250', unit: 'ms p95' }],
  flow: ['需求与痛点', '搭建读取路径', '运行验证', '比较取舍'],
  prompt: '从读取源开始添加 Service 和 Database，连接路径后运行。尝试增大数据库连接数，或者加 Cache 并连接 miss 回源；不要通过改低流量或删掉访问步骤降低延迟。',
  objectives: ['每次请求经过 Service。', '每次请求有数据库读取或来源可解释的缓存命中。', '全部请求成功，p95 ≤ 250 ms，并遵守资源预算。'],
  observationNote: '每次运行从空缓存开始。指标包含冷启动，结束时排空不代表流量期间没有排队。',
  parameters: [], focusNodeId: SOURCE,
  hints: ['数据库单连接每 40 ms 处理一次，200 请求/秒需要多少并发？', '缓存命中在缓存处结束；只将 miss 出口连向 Database。', '先保留失败基线，再运行另一个方案，对比数据库读取次数和 p95。'],
  boundary: '固定已有键的容量模型；没有真实短码存储服务。虚拟延迟不等于生产性能，连接和缓存条目也不是云价格。',
  resultMetrics: [{ key: 'latencyP95Ms', label: '完成请求 p95', unit: 'ms' }, { key: 'databaseReads', label: '数据库读取', unit: '次' }, { key: 'cacheHitRate', label: '缓存命中率', format: 'percent' }, { key: 'databaseConnections', label: '数据库连接', unit: '个' }],
  attemptMetric: { key: 'latencyP95Ms', label: 'p95', unit: 'ms' }, sourceId: SOURCE, tools: shortLinkTools, editIssue: shortLinkEditIssue, createProject: createShortLinkProject,
  presets: [
    { id: 'baseline', title: '载入失败基线', description: '2 个数据库连接，无缓存；观察实际排队。', create: (id) => shortLinkPreset(id, false, 2) },
    { id: 'direct', title: '参考：数据库扩容', description: '8 个连接，直接读取；运行后才能判定。', create: (id) => shortLinkPreset(id, false, 8) },
    { id: 'cache', title: '参考：缓存分担读取', description: '4 个连接 + 64 条缓存；比较冷启动和回源量。', create: (id) => shortLinkPreset(id, true, 4) },
  ],
  evaluate: (input, result) => {
    const checks: ExerciseCheck[] = []
    const metrics: Record<string, number | undefined> = {}
    const finish = () => makeExerciseEvaluation(checks, metrics, '读取路径、完整运行与性能目标均已验证。请比较另一种方案，再解释成本与一致性取舍。')
    const parsed = projectFileV3Schema.safeParse(input)
    const issue = parsed.success ? shortLinkEditIssue(parsed.data) : '项目无效。'
    checks.push({ id: 'constraints', label: '固定需求与资源边界', status: issue ? 'fail' : 'pass', message: issue ?? '固定需求与所有组件参数均在题目范围内。' })
    if (issue || !parsed.success) return finish()
    const project = parsed.data
    const service = project.topology.nodes.find((node) => node.type === 'service')
    const database = project.topology.nodes.find((node) => node.type === 'database')
    const cache = project.topology.nodes.find((node) => node.type === 'cache')
    const edges = project.topology.edges
    const expected = service && database ? [designEdge(SOURCE, service.id), ...(cache ? [designEdge(service.id, cache.id), designEdge(cache.id, database.id, 'miss')] : [designEdge(service.id, database.id)])] : []
    const path = !!service && !!database && edges.length === expected.length && expected.every((e) => edges.some((actual) => actual.source === e.source && actual.target === e.target && actual.sourcePort === e.sourcePort))
    checks.push({ id: 'path', label: '读取路径', status: path ? 'pass' : 'fail', message: path ? 'Service → Database 或 Service → Cache → miss → Database 路径完整。' : '必须连接读取源 → Service → Database；可在中间加入 Cache，其 miss 出口回源，hit 在缓存返回。不能绕过数据库或留下孤立组件。' })
    if (!path || !service || !database) return finish()
    if (result && result.inputSignature !== simulationInputSignature(project)) {
      checks.push({ id: 'evidence', label: '运行快照', status: 'inconclusive', message: '运行输入与当前设计不一致，或旧记录没有输入签名；请重新运行。' })
      return finish()
    }
    const evidence = inspectExerciseEvidence(project, result, { sourceNodeId: SOURCE, requiredNodeIds: project.topology.nodes.filter((n) => n.type !== 'traffic').map((n) => n.id), observationStartSeconds: 0, observationEndSeconds: 5, minimumLatencyMs: 10 })
    checks.push(evidence.check); Object.assign(metrics, evidence.metrics)
    if (!result || evidence.check.status !== 'pass') return finish()
    const generated = result.events.filter((e) => e.type === 'request-generated')
    const serviceCompletions = result.events.filter((e) => e.type === 'request-completed' && e.nodeId === service.id)
    const reads = result.events.filter((e) => e.type === 'database-read' && e.nodeId === database.id)
    const hits = result.events.filter((e) => e.type === 'cache-hit' && e.nodeId === cache?.id)
    const misses = result.events.filter((e) => e.type === 'cache-miss' && e.nodeId === cache?.id)
    const forRequest = (events: RuntimeEvent[], id: string | undefined) => events.filter((e) => e.requestId === id)
    const domain = generated.every((g) => {
      if (forRequest(serviceCompletions, g.requestId).length !== 1) return false
      const read = forRequest(reads, g.requestId)
      if (!cache) return read.length === 1 && read[0]!.status === 'ok'
      const hit = forRequest(hits, g.requestId); const miss = forRequest(misses, g.requestId)
      if (hit.length + miss.length !== 1) return false
      if (miss.length) return read.length === 1 && read[0]!.status === 'ok' && read[0]!.attributes.key === miss[0]!.attributes.key && read[0]!.sequence > miss[0]!.sequence
      return !read.length && reads.some((r) => r.status === 'ok' && r.attributes.key === hit[0]!.attributes.key && r.sequence < hit[0]!.sequence)
    }) && result.nodes.find((n) => n.nodeId === database.id)?.processedRequests === reads.length
    metrics.databaseReads = reads.length; metrics.cacheHitRate = hits.length / generated.length; metrics.databaseConnections = Number(database.config.maxConnections)
    checks.push({ id: 'request-path-evidence', label: '逐请求读取证据', status: domain ? 'pass' : 'inconclusive', message: domain ? `${generated.length} 个请求均经过 Service；${reads.length} 次数据库读取，${hits.length} 次缓存命中。每次命中都有此前同键成功读取。` : '缺少逐请求服务访问、数据库读取或有效缓存来源，不能将成功终态当成正确读取。' })
    if (!domain) return finish()
    checks.push({ id: 'completion', label: '全部完成', status: result.summary.failedRequests === 0 ? 'pass' : 'fail', message: `${result.summary.completedRequests} 成功、${result.summary.failedRequests} 失败；目标无失败。` })
    checks.push({ id: 'latency', label: 'p95 ≤ 250 ms', status: result.summary.latencyP95Ms <= 250 ? 'pass' : 'fail', message: `实测 p95 ${result.summary.latencyP95Ms} ms；目标 ≤ 250 ms。` })
    return finish()
  },
}
