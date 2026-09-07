import { createRegisteredNode } from '@system-design/components'
import { createEmptyProject, projectFileV3Schema, type ProjectFile, type SimulationResult } from '@system-design/model'

export type ExerciseCheckStatus = 'pass' | 'fail' | 'inconclusive'

export interface ExerciseCheck {
  id: string
  label: string
  status: ExerciseCheckStatus
  message: string
  actual?: number
  expected?: number | string
}

export interface ExerciseMetrics {
  replicas?: number
  generatedRequests?: number
  completedRequests?: number
  failedRequests?: number
  unfinishedRequests?: number
  arrivalWindowMaxQueue?: number
  arrivalWindowEndQueue?: number
  latencyP95Ms?: number
}

export interface ExerciseEvaluation {
  status: ExerciseCheckStatus
  summary: string
  checks: ExerciseCheck[]
  metrics: ExerciseMetrics
}

/** Learning rules belong here; the simulation engine only sees a normal project. */
export interface ExerciseDefinition {
  id: string
  version: number
  title: string
  summary: string
  prompt: string
  objectives: readonly string[]
  editableParameter: { nodeId: string; field: string; label: string; min: number; max: number; step: number }
  createProject: (projectId?: string) => ProjectFile
  /** The caller must supply the immutable project snapshot used for this run. */
  evaluate: (projectSnapshot: ProjectFile, result?: SimulationResult) => ExerciseEvaluation
}

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

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

// Canvas positions and display names do not change the experiment. All execution fields do.
const fixedDesign = (project: ProjectFile) => ({
  ...project,
  name: '',
  topology: {
    ...project.topology,
    nodes: project.topology.nodes.map((node) => ({
      ...node, name: '', position: { x: 0, y: 0 },
      config: node.id === SERVICE_ID ? { ...node.config, replicas: 1 } : node.config,
    })).sort((left, right) => left.id.localeCompare(right.id)),
    edges: [...project.topology.edges].sort((left, right) => left.id.localeCompare(right.id)),
  },
})

const evaluation = (checks: ExerciseCheck[], metrics: ExerciseMetrics): ExerciseEvaluation => {
  const status = checks.some((check) => check.status === 'fail') ? 'fail'
    : checks.some((check) => check.status === 'inconclusive') ? 'inconclusive' : 'pass'
  const summary = status === 'pass'
    ? '在本题的固定模型中，已用最少副本处理原定负载，运行证据满足排队和延迟目标。'
    : status === 'inconclusive' ? '运行证据不足，请完整运行当前设计后再检查。'
      : '还有目标未满足。根据下方证据调整设计，再运行验证。'
  return { status, summary, checks, metrics }
}

const evaluateServiceQueue = (projectSnapshot: ProjectFile, result?: SimulationResult): ExerciseEvaluation => {
  const checks: ExerciseCheck[] = []
  const metrics: ExerciseMetrics = {}
  const parsed = projectFileV3Schema.safeParse(projectSnapshot)
  if (!parsed.success) {
    return evaluation([{ id: 'constraints', label: '题目约束', status: 'fail', message: '场景无效，请重置本题后重试。' }], metrics)
  }
  const project = parsed.data
  const replicas = project.topology.nodes.find((node) => node.id === SERVICE_ID)?.config.replicas
  const validReplicas = typeof replicas === 'number' && Number.isInteger(replicas) && replicas >= 1 && replicas <= 4
  if (typeof replicas === 'number') metrics.replicas = replicas
  const baseline = createServiceQueueProject(project.id)
  const constraintsMatch = validReplicas && stableJson(fixedDesign(project)) === stableJson(fixedDesign(baseline))
  checks.push({
    id: 'constraints', label: '题目约束', status: constraintsMatch ? 'pass' : 'fail',
    message: constraintsMatch ? '负载、处理耗时、并发槽和拓扑保持原定条件。' : '本题只允许把 API Service 副本数调整为 1–4；请恢复流量、耗时、拓扑和运行设置。',
  })
  if (!constraintsMatch) return evaluation(checks, metrics)
  if (!result) {
    checks.push({ id: 'evidence', label: '运行证据', status: 'inconclusive', message: '请先运行模拟，再根据这次运行的场景快照检查。' })
    return evaluation(checks, metrics)
  }

  const summary = result.summary
  metrics.generatedRequests = summary.generatedRequests
  metrics.completedRequests = summary.completedRequests
  metrics.failedRequests = summary.failedRequests
  metrics.unfinishedRequests = summary.generatedRequests - summary.completedRequests - summary.failedRequests
  metrics.latencyP95Ms = summary.latencyP95Ms
  const expectedSamples = SIMULATION_SECONDS * 1_000 / SAMPLE_INTERVAL_MS
  const expectedRequests = ARRIVAL_RATE * ARRIVAL_SECONDS
  const serviceMetrics = result.nodes.find((node) => node.nodeId === SERVICE_ID && node.nodeType === 'service')
  const snapshots = new Map(result.events.filter((event) => event.type === 'node-snapshot' && event.nodeId === SERVICE_ID).map((event) => [event.timestampMs, event]))
  const generated = result.events.filter((event) => event.type === 'request-generated' && event.nodeId === TRAFFIC_ID)
  const terminals = result.events.filter((event) => event.attributes.terminal === true && (event.type === 'request-completed' || event.type === 'request-failed'))
  const identityMatches = result.scenarioId === project.id && result.seed === SEED
    && result.events.every((event) => event.runId === result.runId)
    && [...snapshots.values()].every((event) => event.attributes.capacity === (replicas as number) * CONCURRENCY)
  // A final empty queue is insufficient: the complete arrival window must be observed.
  const samplesComplete = result.timeSeries.length === expectedSamples && result.timeSeries.every((point, index) => {
    const timeMs = (index + 1) * SAMPLE_INTERVAL_MS
    const snapshot = snapshots.get(timeMs)
    return point.timeSeconds === timeMs / 1_000 && snapshot !== undefined
      && Number.isFinite(point.queuedRequests) && point.queuedRequests >= 0
      && point.queuedRequests === snapshot.attributes.queueLength
  })
  // The current constant-arrival loop may include one request at a floating-point end boundary.
  const workloadComplete = summary.generatedRequests >= expectedRequests && summary.generatedRequests <= expectedRequests + 1
    && generated.length === summary.generatedRequests
    && generated.every((event, index) => Math.abs(event.timestampMs - index * 1_000 / ARRIVAL_RATE) <= 0.01)
  const terminalEvidenceMatches = terminals.filter((event) => event.type === 'request-completed').length === summary.completedRequests
    && terminals.filter((event) => event.type === 'request-failed').length === summary.failedRequests
    && serviceMetrics?.processedRequests === summary.completedRequests
  const completeEvidence = identityMatches && samplesComplete && workloadComplete && terminalEvidenceMatches
    && result.simulatedDurationMs === SIMULATION_SECONDS * 1_000
    && Number.isFinite(summary.latencyP95Ms) && summary.latencyP95Ms >= SERVICE_TIME_MS
    && metrics.unfinishedRequests === 0 && result.warnings.length === 0
  checks.push({
    id: 'evidence', label: '完整运行证据', status: completeEvidence ? 'pass' : 'inconclusive',
    message: completeEvidence ? '已核对原定到达序列、完整采样、场景身份及请求终态。'
      : '场景与结果不匹配，或运行存在截断、未完成请求、警告或缺失采样；不能据此判定通过。',
  })
  if (!completeEvidence) return evaluation(checks, metrics)

  const arrivalSamples = result.timeSeries.filter((point) => point.timeSeconds < ARRIVAL_SECONDS)
  metrics.arrivalWindowMaxQueue = Math.max(...arrivalSamples.map((point) => point.queuedRequests))
  metrics.arrivalWindowEndQueue = arrivalSamples.at(-1)!.queuedRequests
  checks.push({
    id: 'completion', label: '请求完成', status: summary.failedRequests === 0 && summary.errorRate === 0 ? 'pass' : 'fail',
    actual: summary.failedRequests, expected: 0,
    message: summary.failedRequests === 0 ? '原定请求全部成功，排空期间没有未完成请求。' : `${summary.failedRequests} 个请求失败；不能通过丢弃请求解决排队。`,
  }, {
    id: 'arrival-queue', label: '到达期间的队列', status: metrics.arrivalWindowMaxQueue <= MAX_ARRIVAL_QUEUE ? 'pass' : 'fail',
    actual: metrics.arrivalWindowMaxQueue, expected: `≤ ${MAX_ARRIVAL_QUEUE}`,
    message: `0–6 秒流量期间，采样队列最大 ${metrics.arrivalWindowMaxQueue}，最后一个到达期采样为 ${metrics.arrivalWindowEndQueue}。停流后的排空不代表处理能力足够。`,
  }, {
    id: 'latency', label: '完成请求 p95', status: summary.latencyP95Ms <= LATENCY_TARGET_MS ? 'pass' : 'fail',
    actual: summary.latencyP95Ms, expected: `≤ ${LATENCY_TARGET_MS} ms`,
    message: `实际运行的 p95 为 ${summary.latencyP95Ms} ms，目标不超过 ${LATENCY_TARGET_MS} ms。`,
  }, {
    id: 'resource-efficiency', label: '最少副本', status: (replicas as number) <= MINIMUM_REPLICAS ? 'pass' : 'fail',
    actual: replicas as number, expected: `≤ ${MINIMUM_REPLICAS}`,
    message: (replicas as number) > MINIMUM_REPLICAS
      ? '当前配置使用了多余副本。每副本 10 个并发槽、每请求 0.2 秒，试着减少一个副本并重新验证。'
      : '副本数在最小可行候选范围内；是否足够仍由排队和延迟证据判断。',
  })
  return evaluation(checks, metrics)
}

export const serviceQueueExercise: ExerciseDefinition = {
  id: EXERCISE_ID,
  version: 1,
  title: '增加副本能否解决排队？',
  summary: '预测瓶颈，调整副本，再用到达期间的队列和延迟验证。',
  prompt: 'API 每秒接收 120 个请求，持续 6 秒。每个副本有 10 个并发槽，每次处理固定耗时 200 ms。先运行一个副本的基线，预测需要多少副本，再仅调整副本数。总运行 20 秒，后 14 秒用于排空；目标是在 1–4 个副本中找到满足条件的最少数量。',
  objectives: [
    '保持每秒 120 请求、200 ms 处理耗时和其他实验条件，只调整 Service 副本数。',
    '0–6 秒到达期间，采样队列长度不超过 1，完成请求 p95 不超过 250 ms。',
    '全部请求成功并排空，以最少副本满足目标。',
    '结论仅适用于本题的固定耗时与并发模型，不代表生产系统容量保证。',
  ],
  editableParameter: { nodeId: SERVICE_ID, field: 'replicas', label: 'API Service 副本数', min: 1, max: 4, step: 1 },
  createProject: createServiceQueueProject,
  evaluate: evaluateServiceQueue,
}

export const exercises: readonly ExerciseDefinition[] = [serviceQueueExercise]
export const getExercise = (id: string): ExerciseDefinition | undefined => exercises.find((exercise) => exercise.id === id)
