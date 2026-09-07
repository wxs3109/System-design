import { createRegisteredNode } from '@system-design/components'
import { createEmptyProject, projectFileV3Schema, type ProjectFile, type SimulationResult } from '@system-design/model'
import { inspectExerciseEvidence, observedQueue } from './exercise-evidence'
import { checkExerciseConstraints, makeExerciseEvaluation, readExerciseParameter } from './exercise-project'
import type { ExerciseCheck, ExerciseDefinition, ExerciseParameter } from './exercise-types'

const EXERCISE_ID = 'database-bottleneck'
const TRAFFIC_ID = 'db-practice-traffic'
const SERVICE_ID = 'db-practice-service'
const DATABASE_ID = 'db-practice-database'
const WORKLOAD_ID = 'db-practice-workload'
const SEED = 'practice:database-bottleneck:v1'
const PASS_SUMMARY = '到达期间数据库队列受控，全部请求成功，端到端延迟满足目标。可以继续比较其他可行组合的资源开销。'

const parameters: readonly ExerciseParameter[] = [{
  id: 'service-replicas', nodeId: SERVICE_ID, field: 'replicas', label: 'API Service 副本数', unit: '个副本',
  choices: [1, 2, 4].map((value) => ({ value, label: `${value} 个副本` })),
}, {
  id: 'database-connections', nodeId: DATABASE_ID, field: 'maxConnections', label: '数据库并发连接数', unit: '个连接',
  choices: [4, 8, 12, 16].map((value) => ({ value, label: `${value} 个连接` })),
}]

const connection = (id: string, source: string, target: string) => ({
  id, source, target, sourcePort: 'out', targetPort: 'in', sourceSemantic: 'request' as const,
  targetSemantic: 'request' as const, weight: 1, routingMode: 'weighted-one' as const,
})

const createProject = (projectId = `exercise:${EXERCISE_ID}`): ProjectFile => {
  const project = createEmptyProject(projectId)
  project.name = '为什么增加 API 副本没有改善延迟？'
  const traffic = createRegisteredNode('traffic', TRAFFIC_ID, { x: 50, y: 180 }, WORKLOAD_ID)
  const service = createRegisteredNode('service', SERVICE_ID, { x: 350, y: 180 })
  const database = createRegisteredNode('database', DATABASE_ID, { x: 650, y: 180 })
  traffic.name = '100 requests / second'
  service.name = 'API Service'
  database.name = 'Primary Database'
  service.config = { replicas: 1, concurrencyPerReplica: 10, serviceTimeMs: 20, jitterMs: 0, errorRate: 0, maxQueueSize: 10_000 }
  database.config = {
    maxConnections: 4, queryTimeMs: 100, jitterMs: 0, errorRate: 0, maxQueueSize: 10_000,
    shardCount: 1, replicasPerShard: 0, readPreference: 'primary', replicationDelayMs: 0,
    writeRatio: 0, keySpaceSize: 1_000, hotKeyProbability: 0,
  }
  project.topology.nodes = [traffic, service, database]
  project.topology.edges = [
    connection('db-practice-to-api', TRAFFIC_ID, SERVICE_ID),
    connection('db-practice-to-database', SERVICE_ID, DATABASE_ID),
  ]
  const experiment = project.experiments[0]!
  experiment.seed = SEED
  experiment.workloads = [{
    id: WORKLOAD_ID, name: 'Fixed database exercise workload', sourceNodeId: TRAFFIC_ID,
    requestsPerSecond: 100, startAtSeconds: 0, durationSeconds: 6, pattern: 'constant', requestBytes: 1_024,
  }]
  experiment.simulation = { durationSeconds: 20, sampleIntervalMs: 100, maxRequests: 2_000, traceLimit: 2_000, maxHops: 8 }
  return projectFileV3Schema.parse(project)
}

const evaluate = (projectSnapshot: ProjectFile, result?: SimulationResult) => {
  const parsed = projectFileV3Schema.safeParse(projectSnapshot)
  if (!parsed.success) return makeExerciseEvaluation([{ id: 'constraints', label: '题目约束', status: 'fail', message: '场景无效，请重新开始本题。' }], {}, PASS_SUMMARY)
  const project = parsed.data
  const parameterMetrics = {
    serviceReplicas: readExerciseParameter(project, parameters[0]!),
    databaseConnections: readExerciseParameter(project, parameters[1]!),
  }
  const constraints = checkExerciseConstraints(project, createProject(project.id), parameters)
  if (constraints.status !== 'pass') return makeExerciseEvaluation([constraints], parameterMetrics, PASS_SUMMARY)

  const evidence = inspectExerciseEvidence(project, result, {
    sourceNodeId: TRAFFIC_ID, requiredNodeIds: [SERVICE_ID, DATABASE_ID],
    observationStartSeconds: 0, observationEndSeconds: 6, minimumLatencyMs: 120,
  })
  const checks: ExerciseCheck[] = [constraints, evidence.check]
  const metrics = { ...evidence.metrics, ...parameterMetrics }
  if (evidence.check.status !== 'pass') return makeExerciseEvaluation(checks, metrics, PASS_SUMMARY)

  const databaseQueue = observedQueue(evidence, DATABASE_ID)!
  const serviceQueue = observedQueue(evidence, SERVICE_ID)!
  const summary = result!.summary
  checks.push({
    id: 'completion', label: '请求完成', status: summary.failedRequests === 0 ? 'pass' : 'fail',
    actual: summary.failedRequests, expected: 0,
    message: summary.failedRequests === 0 ? '原定请求全部成功，排空结束后没有未完成请求。' : `${summary.failedRequests} 个请求失败；不能通过丢弃请求达到性能目标。`,
  }, {
    id: 'database-queue', label: '数据库到达期排队', status: databaseQueue.max <= 1 ? 'pass' : 'fail',
    actual: databaseQueue.max, expected: '≤ 1',
    message: `到达期间数据库最大采样队列为 ${databaseQueue.max}，Service 为 ${serviceQueue.max}。${databaseQueue.max > 1 ? '等待主要发生在数据库；继续增加 Service 副本不会增加数据库的处理额度。' : '数据库可以跟上本题的到达负载。'}`,
  }, {
    id: 'latency', label: '端到端完成请求 p95', status: summary.latencyP95Ms <= 150 ? 'pass' : 'fail',
    actual: summary.latencyP95Ms, expected: '≤ 150 ms',
    message: `实际运行 p95 为 ${summary.latencyP95Ms} ms，目标不超过 150 ms；该数值包含 Service、数据库处理和等待。`,
  })
  return makeExerciseEvaluation(checks, {
    ...metrics, databaseArrivalMaxQueue: databaseQueue.max, databaseArrivalEndQueue: databaseQueue.end,
    serviceArrivalMaxQueue: serviceQueue.max,
  }, PASS_SUMMARY)
}

export const databaseBottleneckExercise: ExerciseDefinition = {
  id: EXERCISE_ID,
  version: 1,
  title: '为什么增加 API 副本没有改善延迟？',
  summary: '沿请求链路寻找真正的受限资源，比较扩容 Service 与数据库的效果。',
  category: '容量与排队',
  difficulty: '入门',
  estimatedMinutes: 12,
  introduction: '先观察基线，再只增加 API Service 副本。比较结果后，决定下一步应该调整哪一个资源。',
  givens: [
    { label: '请求到达率', value: '100', unit: '/s' },
    { label: 'Service 本地处理', value: '20', unit: 'ms' },
    { label: '每次数据库查询', value: '100', unit: 'ms' },
  ],
  flow: ['流量', 'API Service', 'Database'],
  prompt: '每秒 100 个请求持续 6 秒，每个请求先使用 Service 的并发槽处理 20 ms，再访问数据库查询 100 ms。Service 每副本有 10 个并发槽，数据库初始只允许 4 个并发查询。选择 Service 副本数和数据库并发连接数，找出能够满足延迟与排队目标的方案。',
  objectives: [
    '保持原定流量、处理耗时和拓扑，只调整 Service 副本数与数据库并发连接数。',
    '0–6 秒到达期间，数据库采样队列不超过 1，端到端完成请求 p95 不超过 150 ms。',
    '全部请求成功并排空；多种满足目标的参数组合都可以通过。',
  ],
  observationNote: '前 6 秒持续注入请求，后 14 秒观察排空。比较两处的到达期队列；全程平均吞吐包含排空期，不适合直接判断瓶颈是否消失。',
  parameters,
  focusNodeId: DATABASE_ID,
  hints: [
    'Service 单副本的本地处理能力约为 10 ÷ 0.02 = 500 请求/秒，已经高于 100 请求/秒。先检查数据库处是否仍然积压。',
    '数据库初始处理能力约为 4 ÷ 0.1 = 40 查询/秒。增加 Service 副本不会增加数据库的并发查询额度。',
    '改变数据库并发额度后重新运行，观察它的队列与端到端延迟。满足目标后还可以尝试减少资源；本题接受多种可行组合。',
  ],
  boundary: '学习模型 · Service 并发槽只占用本地处理阶段，数据库用固定查询耗时与连接额度模拟资源竞争；未模拟数据库 CPU、磁盘和锁竞争，结论不保证生产数据库增加连接后的表现。',
  resultMetrics: [
    { key: 'databaseArrivalMaxQueue', label: '数据库到达期最大排队' },
    { key: 'serviceArrivalMaxQueue', label: 'Service 到达期最大排队' },
    { key: 'latencyP95Ms', label: '端到端完成请求 p95', unit: ' ms' },
  ],
  attemptMetric: { key: 'databaseArrivalMaxQueue', label: '数据库最大排队' },
  createProject,
  evaluate,
}
