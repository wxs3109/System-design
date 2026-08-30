import type { Scenario } from '@system-design/model'
import { compileSimulationInput, type CompiledConnection, type CompiledScenario } from './compiler'

export class SimulationValidationError extends Error {
  readonly problems: string[]
  constructor(problems: string[]) { super(problems.join(' ')); this.name = 'SimulationValidationError'; this.problems = problems }
}

export interface ScenarioValidation { scenario?: Scenario; compiled?: CompiledScenario; errors: string[]; warnings: string[] }

export const validateScenarioForSimulation = (input: unknown): ScenarioValidation => {
  let compiled: CompiledScenario
  try { compiled = compileSimulationInput(input) } catch (cause) {
    if (cause instanceof Error && 'issues' in cause && Array.isArray(cause.issues)) {
      const issues = cause.issues as { path: PropertyKey[]; message: string }[]
      return { errors: issues.map((issue) => `${issue.path.join('.') || 'scenario'}: ${issue.message}`), warnings: [] }
    }
    return { errors: [cause instanceof Error ? cause.message : 'Invalid simulation input.'], warnings: [] }
  }
  const { scenario, nodes: enabledNodes, outgoing } = compiled
  const errors: string[] = []
  const warnings: string[] = []
  if (enabledNodes.size === 0) errors.push('Add at least one enabled component before running.')
  const schedulers = [...enabledNodes.values()].filter((node) => node.type === 'scheduler')
  if (scenario.workloads.length === 0 && compiled.operations.phases.length === 0 && schedulers.length === 0) errors.push('Add a Traffic Generator with a workload or a Scheduler before running.')
  for (const workload of scenario.workloads) {
    if (!enabledNodes.has(workload.sourceNodeId)) errors.push(`Workload ${workload.name} points to a disabled or missing source.`)
    else if ((outgoing.get(workload.sourceNodeId)?.length ?? 0) === 0) errors.push(`Traffic Generator ${enabledNodes.get(workload.sourceNodeId)?.name ?? workload.sourceNodeId} is not connected.`)
  }
  for (const phase of compiled.operations.phases) {
    if (!enabledNodes.has(phase.sourceNodeId)) errors.push(`Operation workload ${phase.workloadId} points to a disabled or missing source.`)
  }
  for (const scheduler of schedulers) if ((outgoing.get(scheduler.id)?.length ?? 0) === 0) errors.push(`Scheduler ${scheduler.name} is not connected.`)
  const reachable = new Set<string>()
  const visit = (nodeId: string) => { if (reachable.has(nodeId)) return; reachable.add(nodeId); for (const edge of outgoing.get(nodeId) ?? []) visit(edge.target) }
  for (const workload of scenario.workloads) visit(workload.sourceNodeId)
  for (const phase of compiled.operations.phases) visit(phase.sourceNodeId)
  for (const scheduler of schedulers) visit(scheduler.id)
  for (const node of enabledNodes.values()) if (!reachable.has(node.id)) warnings.push(`${node.name} is not reachable from any workload.`)
  warnings.push(...compiled.operations.warnings)
  return { scenario, compiled, errors, warnings }
}

export const routingMode = (edges: readonly CompiledConnection[]) => edges[0]?.routingMode ?? 'weighted-one'
