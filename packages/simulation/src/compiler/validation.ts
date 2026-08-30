import { scenarioSchema, type Connection, type Scenario } from '@system-design/model'

export class SimulationValidationError extends Error {
  readonly problems: string[]

  constructor(problems: string[]) {
    super(problems.join(' '))
    this.name = 'SimulationValidationError'
    this.problems = problems
  }
}

export interface ScenarioValidation {
  scenario?: Scenario
  errors: string[]
  warnings: string[]
}

export const validateScenarioForSimulation = (input: unknown): ScenarioValidation => {
  const parsed = scenarioSchema.safeParse(input)
  if (!parsed.success) {
    return { errors: parsed.error.issues.map((issue) => `${issue.path.join('.') || 'scenario'}: ${issue.message}`), warnings: [] }
  }

  const scenario = parsed.data
  const errors: string[] = []
  const warnings: string[] = []
  const enabledNodes = new Map(scenario.nodes.filter((node) => !node.disabled).map((node) => [node.id, node]))
  const outgoing = new Map<string, Connection[]>()
  for (const edge of scenario.edges) {
    if (!enabledNodes.has(edge.source) || !enabledNodes.has(edge.target)) continue
    const list = outgoing.get(edge.source) ?? []
    list.push(edge)
    outgoing.set(edge.source, list)
  }

  if (enabledNodes.size === 0) errors.push('Add at least one enabled component before running.')
  if (scenario.workloads.length === 0) errors.push('Add a Traffic Generator with a workload before running.')
  for (const workload of scenario.workloads) {
    if (!enabledNodes.has(workload.sourceNodeId)) errors.push(`Workload ${workload.name} points to a disabled or missing source.`)
    else if ((outgoing.get(workload.sourceNodeId)?.length ?? 0) === 0) errors.push(`Traffic Generator ${enabledNodes.get(workload.sourceNodeId)?.name ?? workload.sourceNodeId} is not connected.`)
  }

  const reachable = new Set<string>()
  const visit = (nodeId: string) => {
    if (reachable.has(nodeId)) return
    reachable.add(nodeId)
    for (const edge of outgoing.get(nodeId) ?? []) visit(edge.target)
  }
  for (const workload of scenario.workloads) visit(workload.sourceNodeId)
  for (const node of enabledNodes.values()) if (!reachable.has(node.id)) warnings.push(`${node.name} is not reachable from any workload.`)
  return { scenario, errors, warnings }
}
