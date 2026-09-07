import { beforeAll, describe, expect, it } from 'vitest'
import { type ProjectFile, type SimulationResult } from '@system-design/model'
import { runSimulation } from '@system-design/simulation'
import { exercises, getExercise, serviceQueueExercise } from './exercises'

const projectWithReplicas = (replicas: number) => {
  const project = serviceQueueExercise.createProject('practice-test-attempt')
  project.topology.nodes.find((node) => node.id === serviceQueueExercise.editableParameter.nodeId)!.config.replicas = replicas
  return project
}

describe('service queue exercise', () => {
  let solvedProject: ProjectFile
  let solvedResult: SimulationResult

  beforeAll(async () => {
    solvedProject = projectWithReplicas(3)
    solvedResult = await runSimulation(solvedProject, 'three-replicas')
  })

  it('creates independent ordinary projects with versioned exercise metadata', () => {
    const first = serviceQueueExercise.createProject('attempt-one')
    const second = serviceQueueExercise.createProject('attempt-two')
    first.topology.nodes[1]!.config.replicas = 4

    expect(second.id).toBe('attempt-two')
    expect(second.topology.nodes[1]!.config.replicas).toBe(1)
    expect(first.modelingMode).toBe('capacity-only')
    expect(serviceQueueExercise.version).toBe(1)
    expect(getExercise(serviceQueueExercise.id)).toBe(serviceQueueExercise)
    expect(getExercise('not-an-exercise')).toBeUndefined()
    expect(exercises).toContain(serviceQueueExercise)
  })

  it('fails the one-replica baseline despite a successfully drained final queue', async () => {
    const project = projectWithReplicas(1)
    const result = await runSimulation(project, 'one-replica')
    const checked = serviceQueueExercise.evaluate(project, result)

    expect(result.summary.completedRequests).toBe(result.summary.generatedRequests)
    expect(result.summary.failedRequests).toBe(0)
    expect(result.timeSeries.at(-1)?.queuedRequests).toBe(0)
    expect(checked.status).toBe('fail')
    expect(checked.checks.find((check) => check.id === 'evidence')?.status).toBe('pass')
    expect(checked.checks.find((check) => check.id === 'arrival-queue')?.status).toBe('fail')
    expect(checked.metrics.arrivalWindowEndQueue).toBeGreaterThan(300)
    expect(checked.metrics.latencyP95Ms).toBeGreaterThan(250)
  })

  it('still fails at two replicas because arrival-time accumulation and latency remain', async () => {
    const project = projectWithReplicas(2)
    const result = await runSimulation(project, 'two-replicas')
    const checked = serviceQueueExercise.evaluate(project, result)

    expect(checked.status).toBe('fail')
    expect(checked.checks.find((check) => check.id === 'arrival-queue')?.status).toBe('fail')
    expect(checked.metrics.arrivalWindowEndQueue).toBeGreaterThan(80)
  })

  it('passes three replicas only with complete runtime evidence and successful requests', () => {
    const checked = serviceQueueExercise.evaluate(solvedProject, solvedResult)

    expect(checked.status).toBe('pass')
    expect(checked.checks.every((check) => check.status === 'pass')).toBe(true)
    expect(checked.metrics).toMatchObject({ replicas: 3, failedRequests: 0, unfinishedRequests: 0, arrivalWindowMaxQueue: 0, latencyP95Ms: 200 })
    expect(checked.metrics.generatedRequests).toBeGreaterThanOrEqual(720)
  })

  it('asks for a smaller candidate when four replicas satisfy performance with excess capacity', async () => {
    const project = projectWithReplicas(4)
    const result = await runSimulation(project, 'four-replicas')
    const checked = serviceQueueExercise.evaluate(project, result)

    expect(checked.status).toBe('fail')
    expect(checked.checks.find((check) => check.id === 'arrival-queue')?.status).toBe('pass')
    expect(checked.checks.find((check) => check.id === 'resource-efficiency')?.status).toBe('fail')
  })

  it.each(['arrival-rate', 'processing-time'] as const)('rejects solving by changing %s', async (change) => {
    const project = projectWithReplicas(1)
    if (change === 'arrival-rate') project.experiments[0]!.workloads[0]!.requestsPerSecond = 10
    else project.topology.nodes[1]!.config.serviceTimeMs = 1
    const result = await runSimulation(project, `changed-${change}`)

    expect(result.summary.failedRequests).toBe(0)
    const checked = serviceQueueExercise.evaluate(project, result)
    expect(checked.status).toBe('fail')
    expect(checked.checks.find((check) => check.id === 'constraints')?.status).toBe('fail')
  })

  it('accepts layout and display-name changes without altering evaluation', () => {
    const project = structuredClone(solvedProject)
    project.name = 'My attempt'
    project.topology.nodes[0]!.position = { x: 1000, y: -50 }
    project.topology.nodes[1]!.name = 'My API'
    project.topology.nodes.reverse()

    expect(serviceQueueExercise.evaluate(project, solvedResult).status).toBe('pass')
  })

  it('rejects changes to other execution fields or the replica budget', () => {
    const altered = [
      (project: ProjectFile) => { project.topology.nodes[1]!.config.concurrencyPerReplica = 20 },
      (project: ProjectFile) => { project.topology.nodes[1]!.config.replicas = 5 },
      (project: ProjectFile) => { project.topology.nodes[1]!.disabled = true },
      (project: ProjectFile) => { project.topology.edges = [] },
    ]
    for (const alter of altered) {
      const project = structuredClone(solvedProject)
      alter(project)
      expect(serviceQueueExercise.evaluate(project, solvedResult).status).toBe('fail')
    }
  })

  it('cannot pass before running or with a different scene, seed or replica snapshot', async () => {
    expect(serviceQueueExercise.evaluate(solvedProject).status).toBe('inconclusive')
    expect(serviceQueueExercise.evaluate(solvedProject, { ...solvedResult, scenarioId: 'other-attempt' }).status).toBe('inconclusive')
    expect(serviceQueueExercise.evaluate(solvedProject, { ...solvedResult, seed: 'other-seed' }).status).toBe('inconclusive')
    const oldResult = await runSimulation(projectWithReplicas(1), 'before-edit')
    expect(serviceQueueExercise.evaluate(solvedProject, oldResult).status).toBe('inconclusive')
  })

  it('cannot pass when the request budget truncates a healthy-looking low-volume run', async () => {
    const truncated = structuredClone(solvedProject)
    truncated.experiments[0]!.simulation.maxRequests = 100
    const result = await runSimulation(truncated, 'truncated')

    expect(result.summary.completedRequests).toBe(100)
    expect(result.summary.failedRequests).toBe(0)
    expect(result.timeSeries.at(-1)?.queuedRequests).toBe(0)
    expect(serviceQueueExercise.evaluate(truncated, result).status).not.toBe('pass')
    expect(serviceQueueExercise.evaluate(solvedProject, result).status).toBe('inconclusive')
  })

  it('cannot pass on missing queue samples, missing terminal evidence, warnings or unfinished work', () => {
    const incomplete: SimulationResult[] = [
      { ...solvedResult, timeSeries: solvedResult.timeSeries.slice(1) },
      { ...solvedResult, events: solvedResult.events.filter((event) => event.type !== 'node-snapshot') },
      { ...solvedResult, events: solvedResult.events.filter((event) => event.attributes.terminal !== true) },
      { ...solvedResult, warnings: ['Generation stopped at the maxRequests limit (100).'] },
      { ...solvedResult, summary: { ...solvedResult.summary, completedRequests: solvedResult.summary.completedRequests - 1 } },
      { ...solvedResult, summary: { ...solvedResult.summary, latencyP95Ms: Number.NaN } },
    ]
    for (const result of incomplete) {
      expect(serviceQueueExercise.evaluate(solvedProject, result).status).toBe('inconclusive')
    }
  })
})
