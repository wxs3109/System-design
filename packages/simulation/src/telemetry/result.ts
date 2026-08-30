import type { RuntimeEvent, Scenario, SimulationResult } from '@system-design/model'
import { reduceLegacyTraces, reduceNodeMetrics, reduceSpans, reduceSummary, reduceTimeSeries } from './reducers'
import { round } from './math'

export interface CompletedRuntime {
  eventSink: { events: RuntimeEvent[] }
  warnings: string[]
  generated: number
  exceededHopLimit: boolean
}

export const buildSimulationResult = (simulation: CompletedRuntime, scenario: Scenario, runId: string, wallClockDurationMs: number): SimulationResult => {
  const events = simulation.eventSink.events.slice()
  const summary = reduceSummary(events, scenario.simulation.durationSeconds)
  const warnings = [...simulation.warnings]
  if (simulation.generated >= scenario.simulation.maxRequests) warnings.push(`Generation stopped at the maxRequests limit (${scenario.simulation.maxRequests}).`)
  if (simulation.exceededHopLimit) warnings.push(`At least one request exceeded the max hop limit (${scenario.simulation.maxHops}).`)
  const unfinished = summary.generatedRequests - summary.completedRequests - summary.failedRequests
  if (unfinished > 0) warnings.push(`${unfinished} request(s) were still in flight when virtual time ended.`)
  const nodeNames = new Map(scenario.nodes.map((node) => [node.id, node.name]))
  return {
    runId, scenarioId: scenario.id, seed: scenario.seed, simulatedDurationMs: scenario.simulation.durationSeconds * 1_000, wallClockDurationMs: round(wallClockDurationMs),
    summary, nodes: reduceNodeMetrics(events, scenario.nodes), timeSeries: reduceTimeSeries(events, scenario),
    traces: reduceLegacyTraces(events, nodeNames, scenario.simulation.traceLimit), events, spans: reduceSpans(events), warnings,
  }
}
