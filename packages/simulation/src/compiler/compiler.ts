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
  nodeRegions: Map<string, string>
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
  let nodeRegions = new Map<string, string>()
  if (version === 2 || version === 3) {
    project = componentRegistry.validateProject(parseProjectFile(input))
    const enabledProjectNodeIds = new Set(project.topology.nodes.filter((node) => !node.disabled).map((node) => node.id))
    const hasEnabledGlobalRouter = project.topology.nodes.some((node) => node.type === 'global-router' && !node.disabled)
    const regionMemberships = new Map<string, string[]>()
    for (const group of project.topology.groups.filter((candidate) => candidate.kind === 'region')) {
      for (const nodeId of group.nodeIds) regionMemberships.set(nodeId, [...(regionMemberships.get(nodeId) ?? []), group.id])
    }
    for (const [nodeId, regionIds] of regionMemberships) {
      if (regionIds.length > 1 && hasEnabledGlobalRouter && enabledProjectNodeIds.has(nodeId)) throw new Error(`Node ${nodeId} belongs to multiple regions (${regionIds.join(', ')}); Global Router requires unambiguous region membership.`)
      nodeRegions.set(nodeId, regionIds[0]!)
    }
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
    const node = nodes.get(source)
    if (node?.type === 'topic') {
      const subscriptions = sourceEdges.filter((edge) => edge.routingMode === 'async-publish')
      if (subscriptions.length > node.config.subscriptionCount) {
        throw new Error(`Topic ${source} has ${subscriptions.length} subscription edges but is configured for ${node.config.subscriptionCount}. Increase subscriptionCount or remove an edge.`)
      }
    }
  }
  for (const node of nodes.values()) {
    if (node.type !== 'global-router') continue
    const routes = (outgoing.get(node.id) ?? []).filter((edge) => edge.routingMode !== 'async-publish')
    if (routes.length === 0) throw new Error(`Global Router ${node.id} requires at least one synchronous route target.`)
    if (routes.some((edge) => edge.routingMode !== 'weighted-one')) throw new Error(`Global Router ${node.id} requires weighted-one route edges.`)
    if (node.config.routingPolicy === 'geo') {
      const missing = routes.filter((edge) => !nodeRegions.has(edge.target)).map((edge) => edge.target)
      if (missing.length > 0) throw new Error(`Global Router ${node.id} geo routing requires each target to belong to one region; missing: ${missing.join(', ')}.`)
    }
  }
  const operations = project?.schemaVersion === 3 ? compileOperationPlans(project, edges, outgoing) : { phases: [], schedulerWorkloads: new Map(), plans: new Map(), warnings: [] }
  return { scenario, projectId: scenario.id, experimentId, nodes, outgoing, edges, policies, operations, nodeRegions }
}

export const compileScenario = (input: unknown): CompiledScenario => compileSimulationInput(input)
