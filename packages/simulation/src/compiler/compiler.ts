import { scenarioSchema, type Connection, type ComponentNode, type Scenario } from '@system-design/model'
import { getNodeBehavior } from '../components/behavior'

export interface CompiledScenario {
  scenario: Scenario
  nodes: Map<string, ComponentNode>
  outgoing: Map<string, Connection[]>
}

export const compileScenario = (input: unknown): CompiledScenario => {
  const scenario = scenarioSchema.parse(input)
  const nodes = new Map(scenario.nodes.filter((node) => !node.disabled).map((node) => [node.id, node]))
  nodes.forEach((node) => getNodeBehavior(node))
  const outgoing = new Map<string, Connection[]>()
  scenario.edges.forEach((edge) => {
    if (!nodes.has(edge.source) || !nodes.has(edge.target)) return
    const edges = outgoing.get(edge.source) ?? []
    edges.push(edge)
    outgoing.set(edge.source, edges)
  })
  return { scenario, nodes, outgoing }
}
