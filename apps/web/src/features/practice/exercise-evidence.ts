import { getActiveExperiment, projectToScenario, type ProjectFile, type RuntimeEvent, type SimulationResult } from '@system-design/model'
import { getNodeBehavior } from '@system-design/simulation'
import type { ExerciseCheck, ExerciseMetrics } from './exercise-types'

export interface ExerciseEvidenceRequirements {
  sourceNodeId: string
  requiredNodeIds: readonly string[]
  observationStartSeconds: number
  observationEndSeconds: number
  minimumLatencyMs?: number
}

export interface ExerciseEvidence {
  check: ExerciseCheck
  metrics: ExerciseMetrics
  /** Full-run samples, including drain. Use observationSamples for load criteria. */
  samplesByNode: ReadonlyMap<string, readonly RuntimeEvent[]>
  observationSamples: ReadonlyMap<string, readonly RuntimeEvent[]>
}

/** Evidence contract for the current fixed, single-source constant-arrival exercises. */
export function inspectExerciseEvidence(project: ProjectFile, result: SimulationResult | undefined, requirements: ExerciseEvidenceRequirements): ExerciseEvidence {
  const metrics: ExerciseMetrics = {}
  const samplesByNode = new Map<string, RuntimeEvent[]>()
  const observationSamples = new Map<string, RuntimeEvent[]>()
  const response = (complete: boolean, message: string): ExerciseEvidence => ({
    check: { id: 'evidence', label: '完整运行证据', status: complete ? 'pass' : 'inconclusive', message }, metrics, samplesByNode, observationSamples,
  })
  if (!result) return response(false, '请完整运行当前设计，再根据这次运行的场景快照检查。')
  const experiment = getActiveExperiment(project)
  const runtimeNodes = projectToScenario(project).nodes
  const workloads = experiment.workloads.filter((workload) => workload.sourceNodeId === requirements.sourceNodeId)
  if (workloads.length !== 1 || workloads[0]?.pattern !== 'constant' || experiment.operationWorkloads.length > 0 || experiment.faults.some((fault) => fault.enabled !== false)) {
    return response(false, '当前检查器需要固定的单一常量流量和无故障实验，不能验证这次配置。')
  }
  const workload = workloads[0]!
  const summary = result.summary
  const durationMs = experiment.simulation.durationSeconds * 1_000
  const sampleIntervalMs = experiment.simulation.sampleIntervalMs
  const sampleCount = Math.floor(durationMs / sampleIntervalMs)
  const arrivalStartMs = workload.startAtSeconds * 1_000
  const arrivalEndMs = Math.min(durationMs, (workload.startAtSeconds + workload.durationSeconds) * 1_000)
  const expectedRequests = (arrivalEndMs - arrivalStartMs) / 1_000 * workload.requestsPerSecond
  metrics.generatedRequests = summary.generatedRequests
  metrics.completedRequests = summary.completedRequests
  metrics.failedRequests = summary.failedRequests
  metrics.unfinishedRequests = summary.generatedRequests - summary.completedRequests - summary.failedRequests
  metrics.latencyP95Ms = summary.latencyP95Ms

  const generated = result.events.filter((event) => event.type === 'request-generated' && event.nodeId === requirements.sourceNodeId)
  const generatedIds = new Set(generated.map((event) => event.requestId))
  const terminals = result.events.filter((event) => event.attributes.terminal === true && (event.type === 'request-completed' || event.type === 'request-failed'))
  const observationStartMs = requirements.observationStartSeconds * 1_000
  const observationEndMs = requirements.observationEndSeconds * 1_000
  let nodesMatch = requirements.requiredNodeIds.length > 0 && observationStartMs >= arrivalStartMs && observationEndMs <= arrivalEndMs && observationEndMs > observationStartMs

  for (const nodeId of requirements.requiredNodeIds) {
    const node = runtimeNodes.find((candidate) => candidate.id === nodeId)
    const reported = result.nodes.find((candidate) => candidate.nodeId === nodeId && candidate.nodeType === node?.type)
    // The final capture can follow the regular sampler at the same timestamp.
    const samples = [...new Map(result.events.filter((event) => event.type === 'node-snapshot' && event.nodeId === nodeId).map((event) => [event.timestampMs, event])).values()]
    samplesByNode.set(nodeId, samples)
    observationSamples.set(nodeId, samples.filter((event) => event.timestampMs >= observationStartMs && event.timestampMs < observationEndMs))
    const completedIds = new Set(result.events.filter((event) => event.type === 'request-completed' && event.nodeId === nodeId).map((event) => event.requestId))
    nodesMatch &&= !!node && !!reported && reported.processedRequests === completedIds.size && samples.length === sampleCount
      && samples.every((event, index) => event.timestampMs === (index + 1) * sampleIntervalMs
        && event.attributes.capacity === getNodeBehavior(node).capacity(node)
        && typeof event.attributes.queueLength === 'number' && Number.isFinite(event.attributes.queueLength) && event.attributes.queueLength >= 0)
      && observationSamples.get(nodeId)!.length > 0
  }

  const counts = [summary.generatedRequests, summary.completedRequests, summary.failedRequests]
  const complete = nodesMatch && result.scenarioId === project.id && result.seed === experiment.seed
    && result.simulatedDurationMs === durationMs && result.warnings.length === 0
    && result.events.every((event) => event.runId === result.runId)
    && counts.every((value) => Number.isSafeInteger(value) && value >= 0)
    && metrics.unfinishedRequests === 0 && expectedRequests > 0
    && Number.isFinite(summary.errorRate) && Math.abs(summary.errorRate - summary.failedRequests / summary.generatedRequests) <= 0.001
    && Number.isFinite(summary.latencyP95Ms) && summary.latencyP95Ms >= (requirements.minimumLatencyMs ?? 0)
    && generated.length === summary.generatedRequests && generatedIds.size === generated.length
    && generated.every((event) => event.requestId !== undefined)
    && Math.abs(summary.generatedRequests - expectedRequests) <= 1
    && generated.every((event, index) => Math.abs(event.timestampMs - (arrivalStartMs + index * 1_000 / workload.requestsPerSecond)) <= 0.01)
    && new Set(terminals.map((event) => event.requestId)).size === terminals.length
    && terminals.every((event) => generatedIds.has(event.requestId))
    && terminals.filter((event) => event.type === 'request-completed').length === summary.completedRequests
    && terminals.filter((event) => event.type === 'request-failed').length === summary.failedRequests
    && result.timeSeries.length === sampleCount
    && result.timeSeries.every((point, index) => Math.abs(point.timeSeconds * 1_000 - (index + 1) * sampleIntervalMs) <= 0.001 && Number.isFinite(point.queuedRequests) && point.queuedRequests >= 0)
  return response(complete, complete ? '已核对原定到达序列、完整采样、节点容量、场景身份及请求终态。' : '场景与结果不匹配，或运行存在截断、未完成请求、警告或缺失采样；不能据此判定通过。')
}

export function observedQueue(evidence: ExerciseEvidence, nodeId: string): { max: number; end: number } | undefined {
  if (evidence.check.status !== 'pass') return undefined
  const samples = evidence.observationSamples.get(nodeId)
  if (!samples?.length) return undefined
  return { max: Math.max(...samples.map((sample) => Number(sample.attributes.queueLength))), end: Number(samples.at(-1)!.attributes.queueLength) }
}
