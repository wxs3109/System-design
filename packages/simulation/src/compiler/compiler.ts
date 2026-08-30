import { parseProjectFile, projectToScenario, scenarioSchema, type ComponentNode, type Connection, type PortSemantic, type ProjectConnection, type ProjectFile, type ProjectFileV2, type RoutingMode, type Scenario } from '@system-design/model'
import { arePortSemanticsCompatible, componentRegistry } from '@system-design/components'
import { getNodeBehavior } from '../components/behavior'
import { compilePolicies, type CompiledPolicy } from '../policies/compiler'
import { compileOperationPlans, type CompiledOperations } from './operation-plan'

export type SimulationInput = Scenario | ProjectFileV2 | ProjectFile
export interface CompiledConnection {
  id: string
  source: string
  target: string
  sourcePort: string
  targetPort: string
  weight: number
  sourceSemantic: PortSemantic
  targetSemantic: PortSemantic
  routingMode: RoutingMode
}
export interface CompiledScenario {
  scenario: Scenario
  projectId: string
  experimentId: string
  nodes: Map<string, ComponentNode>
  outgoing: Map<string, CompiledConnection[]>
  edges: CompiledConnection[]
  policies: Map<string, CompiledPolicy[]>
  operations: CompiledOperations
}

const legacyConnection = (edge: Connection): CompiledConnection => ({ ...edge, sourceSemantic: 'request', targetSemantic: 'request', routingMode: 'weighted-one' })
const projectConnection = (edge: ProjectConnection): CompiledConnection => ({
  id: edge.id, source: edge.source, target: edge.target, sourcePort: edge.sourcePort, targetPort: edge.targetPort, weight: edge.weight,
  sourceSemantic: edge.sourceSemantic, targetSemantic: edge.targetSemantic, routingMode: edge.routingMode,
})

export const compileSimulationInput = (input: unknown): CompiledScenario => {
  const version = typeof input === 'object' && input !== null && 'schemaVersion' in input ? (input as { schemaVersion?: unknown }).schemaVersion : undefined
  let scenario: Scenario
  let edges: CompiledConnection[]
  let experimentId: string
  let policies = new Map<string, CompiledPolicy[]>()
  let project: ProjectFile | undefined
  if (version === 2 || version === 3) {
    project = parseProjectFile(input)
    const topologyNodes = new Map(project.topology.nodes.map((node) => [node.id, node]))
    for (const edge of project.topology.edges) {
      const source = topologyNodes.get(edge.source)!
      const target = topologyNodes.get(edge.target)!
      const sourcePort = componentRegistry.getPort(source, edge.sourcePort, 'output')
      const targetPort = componentRegistry.getPort(target, edge.targetPort, 'input')
      if (!sourcePort) throw new Error(`Edge ${edge.id} references unknown output port ${edge.sourcePort} on ${source.name}.`)
      if (!targetPort) throw new Error(`Edge ${edge.id} references unknown input port ${edge.targetPort} on ${target.name}.`)
      if (sourcePort.semantic !== edge.sourceSemantic || targetPort.semantic !== edge.targetSemantic) throw new Error(`Edge ${edge.id} semantics do not match its manifest ports.`)
      if (!arePortSemanticsCompatible(sourcePort.semantic, targetPort.semantic)) throw new Error(`Edge ${edge.id} connects incompatible ${sourcePort.semantic} -> ${targetPort.semantic} ports.`)
      if (edge.routingMode === 'async-publish' && (sourcePort.semantic !== 'publish' || targetPort.semantic !== 'consume')) throw new Error(`Edge ${edge.id} requires publish -> consume ports for async-publish routing.`)
      if (edge.routingMode !== 'async-publish' && sourcePort.semantic === 'publish') throw new Error(`Edge ${edge.id} must use async-publish routing for a publish port.`)
    }
    scenario = projectToScenario(project)
    edges = project.topology.edges.map(projectConnection)
    experimentId = project.activeExperimentId
    policies = compilePolicies(project.topology.policies)
  } else {
    scenario = scenarioSchema.parse(input)
    edges = scenario.edges.map(legacyConnection)
    experimentId = 'legacy-experiment'
  }
  const nodes = new Map(scenario.nodes.filter((node) => !node.disabled).map((node) => [node.id, node]))
  nodes.forEach((node) => getNodeBehavior(node))
  const outgoing = new Map<string, CompiledConnection[]>()
  edges.forEach((edge) => {
    if (!nodes.has(edge.source) || !nodes.has(edge.target)) return
    const list = outgoing.get(edge.source) ?? []
    list.push(edge)
    outgoing.set(edge.source, list)
  })
  for (const [source, sourceEdges] of outgoing) {
    const synchronousModes = new Set(sourceEdges.filter((edge) => edge.routingMode !== 'async-publish').map((edge) => edge.routingMode))
    if (synchronousModes.size > 1) throw new Error(`Node ${source} mixes synchronous routing modes. Split the behavior into explicit components.`)
  }
  const operations = project?.schemaVersion === 3 ? compileOperationPlans(project, edges, outgoing) : { phases: [], schedulerWorkloads: new Map(), plans: new Map(), warnings: [] }
  return { scenario, projectId: scenario.id, experimentId, nodes, outgoing, edges, policies, operations }
}

export const compileScenario = (input: unknown): CompiledScenario => compileSimulationInput(input)
