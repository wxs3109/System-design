import type { NodeMetrics, Scenario, SimulationResult } from '@system-design/model'
import type { RuntimeNode } from '../runtime/types'
import { percentile, round } from './math'

export interface CompletedRuntime {
  runtimes: Map<string, RuntimeNode>
  successfulLatencies: number[]
  warnings: string[]
  timeSeries: SimulationResult['timeSeries']
  traces: SimulationResult['traces']
  generated: number
  completed: number
  failed: number
  exceededHopLimit: boolean
}

export const buildSimulationResult = (
  simulation: CompletedRuntime,
  scenario: Scenario,
  runId: string,
  wallClockDurationMs: number,
): SimulationResult => {
  const sortedLatencies = simulation.successfulLatencies.slice().sort((left, right) => left - right)
  const nodes: NodeMetrics[] = [...simulation.runtimes.values()].filter((runtime) => runtime.node.type !== 'traffic').map((runtime) => ({
    nodeId: runtime.node.id, nodeName: runtime.node.name, nodeType: runtime.node.type, processedRequests: runtime.processed, failedRequests: runtime.failed,
    utilization: round(Math.min(1, runtime.resource.utilization)), averageQueueLength: round(runtime.waiting.averageLength), maxQueueLength: runtime.maxWaiting,
  }))
  if (simulation.generated >= scenario.simulation.maxRequests) simulation.warnings.push(`Generation stopped at the maxRequests limit (${scenario.simulation.maxRequests}).`)
  if (simulation.exceededHopLimit) simulation.warnings.push(`At least one request exceeded the max hop limit (${scenario.simulation.maxHops}).`)
  const unfinished = simulation.generated - simulation.completed - simulation.failed
  if (unfinished > 0) simulation.warnings.push(`${unfinished} request(s) were still in flight when virtual time ended.`)
  return {
    runId, scenarioId: scenario.id, seed: scenario.seed, simulatedDurationMs: scenario.simulation.durationSeconds * 1_000, wallClockDurationMs: round(wallClockDurationMs),
    summary: {
      generatedRequests: simulation.generated, completedRequests: simulation.completed, failedRequests: simulation.failed,
      throughputPerSecond: round(simulation.completed / scenario.simulation.durationSeconds), errorRate: round(simulation.generated === 0 ? 0 : simulation.failed / simulation.generated),
      latencyP50Ms: round(percentile(sortedLatencies, 0.5)), latencyP95Ms: round(percentile(sortedLatencies, 0.95)), latencyP99Ms: round(percentile(sortedLatencies, 0.99)),
    },
    nodes, timeSeries: simulation.timeSeries, traces: simulation.traces, warnings: simulation.warnings,
  }
}
