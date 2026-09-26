import { describe, expect, it } from 'vitest'
import { runSimulation } from '@system-design/simulation'
import { simulationInputSignature, type ProjectFile } from '@system-design/model'
import { createWorkbenchStore } from '../../lib/store'
import { createShortLinkProject, designEdge, shortLinkEditIssue, shortLinkExercise, shortLinkPreset, shortLinkTools } from './short-link'

describe('short-link open topology exercise', () => {
  it('accepts empty authoring but rejects it as a solution, and preserves fixed inputs', () => {
    const project = createShortLinkProject()
    expect(shortLinkEditIssue(project)).toBeUndefined()
    expect(shortLinkExercise.evaluate(project).status).toBe('fail')
    project.experiments[0]!.workloads[0]!.requestsPerSecond = 1
    expect(shortLinkEditIssue(project)).toContain('固定')
  })
  it.each([[false, 8, 64], [false, 12, 64], [true, 4, 64], [true, 4, 128]] as const)('accepts a genuine alternative topology (cache=%s, DB=%s, entries=%s)', async (cached, connections, entries) => {
    const project = shortLinkPreset('study', cached, connections, entries)
    // Workbench commands normalize component schemas before handing input to the worker.
    const normalized = createWorkbenchStore(project).getState().project
    const result = await runSimulation(normalized, 'alternative')
    const evaluation = shortLinkExercise.evaluate(normalized, result)
    expect(evaluation, JSON.stringify(evaluation)).toMatchObject({ status: 'pass' })
    expect(evaluation.metrics.databaseReads).toBe(cached ? result.nodes.find((n) => n.nodeType === 'database')!.processedRequests : 1000)
  })
  it('fails insufficient capacity after all requests drain', async () => {
    const project = shortLinkPreset('study', false, 2)
    const result = await runSimulation(project)
    expect(result.summary.completedRequests).toBe(1000)
    expect(shortLinkExercise.evaluate(project, result)).toMatchObject({ status: 'fail' })
  })
  it('evaluates roles and edges instead of authored IDs, names or declaration order', async () => {
    const project = shortLinkPreset('custom', false, 8)
    for (const node of project.topology.nodes.filter((n) => n.type !== 'traffic')) {
      const prior = node.id; node.id = `learner-${prior}`; node.name = `My ${node.type}`
      project.topology.edges.forEach((edge) => { if (edge.source === prior) edge.source = node.id; if (edge.target === prior) edge.target = node.id })
    }
    project.topology.nodes.reverse(); project.topology.edges.reverse()
    expect(shortLinkExercise.evaluate(project, await runSimulation(project)).status).toBe('pass')
  })
  it.each([
    (p: ProjectFile) => { p.topology.edges = p.topology.edges.filter((e) => e.source !== 'redirect') },
    (p: ProjectFile) => { p.topology.edges = [designEdge('short-link-readers', 'mappings')] },
    (p: ProjectFile) => { p.topology.nodes = p.topology.nodes.filter((n) => n.id !== 'mappings'); p.topology.edges = p.topology.edges.filter((e) => e.target !== 'mappings') },
    (p: ProjectFile) => { p.topology.edges.push(designEdge('short-link-readers', 'mappings')) },
    (p: ProjectFile) => { p.topology.nodes.push(shortLinkTools[0]!.create('extra-api', 1)) },
  ])('rejects bypasses, missing stores, extra paths and out-of-budget components', (change) => {
    const project = shortLinkPreset('invalid', false, 8); change(project)
    expect(shortLinkExercise.evaluate(project).status).toBe('fail')
  })
  it('rejects cache miss misrouting even if the engine returns success', async () => {
    const project = shortLinkPreset('wrong', true, 2)
    project.topology.edges = project.topology.edges.filter((e) => e.source !== 'code-cache')
    expect(shortLinkExercise.evaluate(project, await runSimulation(project)).status).toBe('fail')
  })
  it('rejects old input, missing path evidence and truncated events', async () => {
    const project = shortLinkPreset('evidence', true, 2)
    const result = await runSimulation(project)
    const changed = structuredClone(project); changed.topology.nodes.find((n) => n.type === 'cache')!.config.capacityEntries = 128
    expect(shortLinkExercise.evaluate(changed, result).status).toBe('inconclusive')
    const old = structuredClone(result); delete old.inputSignature
    expect(shortLinkExercise.evaluate(project, old).status).toBe('inconclusive')
    const missing = structuredClone(result); missing.events = missing.events.filter((e) => e.type !== 'database-read')
    expect(shortLinkExercise.evaluate(project, missing).status).toBe('inconclusive')
    const truncated = structuredClone(result); truncated.events = truncated.events.slice(0, 80)
    expect(shortLinkExercise.evaluate(project, truncated).status).toBe('inconclusive')
    expect(result.inputSignature).toBe(simulationInputSignature(project))
  })
})
