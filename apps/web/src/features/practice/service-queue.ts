import { createRegisteredNode } from '@system-design/components'
import { createEmptyProject, projectFileV3Schema, type ProjectFile, type SimulationResult } from '@system-design/model'
import { inspectExerciseEvidence, observedQueue } from './exercise-evidence'
import { checkExerciseConstraints, makeExerciseEvaluation } from './exercise-project'
import type { ExerciseCheck, ExerciseDefinition, ExerciseEvaluation, ExerciseParameter } from './exercise-types'

const EXERCISE_ID = 'service-queue-replicas'
const SERVICE_ID = 'practice-service'
const TRAFFIC_ID = 'practice-traffic'
const WORKLOAD_ID = 'practice-requests'
const SEED = 'practice:service-queue-replicas:v1'
const ARRIVAL_RATE = 120
const ARRIVAL_SECONDS = 6
const SIMULATION_SECONDS = 20
const SAMPLE_INTERVAL_MS = 100
const CONCURRENCY = 10
const SERVICE_TIME_MS = 200
const MAX_ARRIVAL_QUEUE = 1
const LATENCY_TARGET_MS = 250
const MINIMUM_REPLICAS = Math.ceil(ARRIVAL_RATE * SERVICE_TIME_MS / 1_000 / CONCURRENCY)

const createServiceQueueProject = (projectId = `exercise:${EXERCISE_ID}`): ProjectFile => {
  const project = createEmptyProject(projectId)
  project.name = '增加副本能否解决排队？'
  const traffic = createRegisteredNode('traffic', TRAFFIC_ID, { x: 120, y: 180 }, WORKLOAD_ID)
  const service = createRegisteredNode('service', SERVICE_ID, { x: 460, y: 180 })
  traffic.name = '120 requests / second'
  service.name = 'API Service'
  service.config = {
    replicas: 1, concurrencyPerReplica: CONCURRENCY, serviceTimeMs: SERVICE_TIME_MS,
    jitterMs: 0, errorRate: 0, maxQueueSize: 10_000,
  }
  project.topology.nodes = [traffic, service]
  project.topology.edges = [{
    id: 'practice-traffic-to-service', source: TRAFFIC_ID, target: SERVICE_ID,
    sourcePort: 'out', targetPort: 'in', sourceSemantic: 'request', targetSemantic: 'request',
    weight: 1, routingMode: 'weighted-one',
  }]
  const experiment = project.experiments[0]!
  experiment.seed = SEED
  experiment.workloads = [{
    id: WORKLOAD_ID, name: 'Fixed exercise workload', sourceNodeId: TRAFFIC_ID,
    requestsPerSecond: ARRIVAL_RATE, startAtSeconds: 0, durationSeconds: ARRIVAL_SECONDS,
    pattern: 'constant', requestBytes: 1_024,
  }]
  experiment.simulation = {
    durationSeconds: SIMULATION_SECONDS, sampleIntervalMs: SAMPLE_INTERVAL_MS,
    maxRequests: 2_000, traceLimit: 2_000, maxHops: 8,
  }
  return projectFileV3Schema.parse(project)
}

const parameters: readonly ExerciseParameter[] = [{ id: 'service-replicas', nodeId: SERVICE_ID, field: 'replicas', label: 'API Service 副本数', unit: '副本', choices: [1, 2, 3, 4].map((value) => ({ value, label: `${value} 个副本` })) }]

const evaluateServiceQueue = (snapshot: ProjectFile, result?: SimulationResult): ExerciseEvaluation => {
  const passSummary = '在本题的固定模型中，已用最少副本处理原定负载，运行证据满足排队和延迟目标。'
  const parsed = projectFileV3Schema.safeParse(snapshot)
  if (!parsed.success) return makeExerciseEvaluation([{ id: 'constraints', label: '题目约束', status: 'fail', message: '场景无效，请重新开始。' }], {}, passSummary)
  const project = parsed.data
  const replicas = Number(project.topology.nodes.find((node) => node.id === SERVICE_ID)?.config.replicas)
  const checks: ExerciseCheck[] = [checkExerciseConstraints(project, createServiceQueueProject(project.id), parameters)]
  if (checks[0]!.status !== 'pass') return makeExerciseEvaluation(checks, { replicas }, passSummary)
  const evidence = inspectExerciseEvidence(project, result, { sourceNodeId: TRAFFIC_ID, requiredNodeIds: [SERVICE_ID], observationStartSeconds: 0, observationEndSeconds: ARRIVAL_SECONDS, minimumLatencyMs: SERVICE_TIME_MS })
  checks.push(evidence.check)
  const metrics = { ...evidence.metrics, replicas }
  if (evidence.check.status !== 'pass' || !result) return makeExerciseEvaluation(checks, metrics, passSummary)
  const queue = observedQueue(evidence, SERVICE_ID)!
  const summary = result.summary
  checks.push({ id: 'completion', label: '请求完成', status: summary.failedRequests === 0 && summary.errorRate === 0 ? 'pass' : 'fail', actual: summary.failedRequests, expected: 0,
    message: summary.failedRequests === 0 ? '原定请求全部成功，排空期间没有未完成请求。' : `${summary.failedRequests} 个请求失败；不能通过丢弃请求解决排队。` },
  { id: 'arrival-queue', label: '到达期间的队列', status: queue.max <= MAX_ARRIVAL_QUEUE ? 'pass' : 'fail', actual: queue.max, expected: `≤ ${MAX_ARRIVAL_QUEUE}`,
    message: `0–6 秒流量期间，采样队列最大 ${queue.max}，最后一个到达期采样为 ${queue.end}。停流后的排空不代表处理能力足够。` },
  { id: 'latency', label: '完成请求 p95', status: summary.latencyP95Ms <= LATENCY_TARGET_MS ? 'pass' : 'fail', actual: summary.latencyP95Ms, expected: `≤ ${LATENCY_TARGET_MS} ms`,
    message: `实际运行的 p95 为 ${summary.latencyP95Ms} ms，目标不超过 ${LATENCY_TARGET_MS} ms。` },
  { id: 'resource-efficiency', label: '最少副本', status: replicas <= MINIMUM_REPLICAS ? 'pass' : 'fail', actual: replicas, expected: `≤ ${MINIMUM_REPLICAS}`,
    message: replicas > MINIMUM_REPLICAS ? '当前配置使用了多余副本。每副本 10 个并发槽、每请求 0.2 秒，试着减少一个副本并重新验证。' : '副本数在最小可行候选范围内；是否足够仍由排队和延迟证据判断。' })
  return makeExerciseEvaluation(checks, { ...metrics, arrivalWindowMaxQueue: queue.max, arrivalWindowEndQueue: queue.end }, passSummary)
}

export const serviceQueueExercise: ExerciseDefinition = {
  id: EXERCISE_ID, version: 1,
  title: '增加副本能否解决排队？',
  summary: '预测瓶颈，调整副本，再用到达期间的队列和延迟验证。',
  category: '容量与排队', difficulty: '入门', estimatedMinutes: 10,
  introduction: '先运行 1 个副本观察基线，再选择你认为足够的副本数量。',
  givens: [{ label: '请求到达率', value: '120', unit: '/s' }, { label: '每次处理耗时', value: '200', unit: 'ms' }, { label: '每副本并发槽', value: '10' }],
  flow: ['流量', 'API Service', '运行证据'],
  prompt: 'API 每秒接收 120 个请求，持续 6 秒。每个副本有 10 个并发槽，每次处理固定耗时 200 ms。先运行一个副本的基线，预测需要多少副本，再仅调整副本数。总运行 20 秒，后 14 秒用于排空；目标是在 1–4 个副本中找到满足条件的最少数量。',
  objectives: ['保持每秒 120 请求、200 ms 处理耗时和其他实验条件，只调整 Service 副本数。', '0–6 秒到达期间，采样队列长度不超过 1，完成请求 p95 不超过 250 ms。', '全部请求成功并排空，以最少副本满足目标。'],
  observationNote: '前 6 秒持续注入请求，后 14 秒观察排空。最终队列变空，并不代表到达期间没有积压。',
  parameters, focusNodeId: SERVICE_ID,
  hints: ['固定耗时模型下，一个副本的处理能力约为 10 ÷ 0.2 = 50 请求/秒。比较总处理能力与 120 请求/秒，再用运行结果验证。增加副本后，也要检查是否还有多余资源。', '输出面板的全程吞吐和利用率包含排空期。本题的排队检查专门观察 0–6 秒到达窗口。'],
  boundary: '本题结论基于固定耗时与并发假设，不代表生产容量保证。',
  resultMetrics: [{ key: 'arrivalWindowMaxQueue', label: '到达期最大排队' }, { key: 'latencyP95Ms', label: '完成请求 p95', unit: 'ms' }],
  attemptMetric: { key: 'arrivalWindowMaxQueue', label: '最大排队' },
  createProject: createServiceQueueProject, evaluate: evaluateServiceQueue,
}
