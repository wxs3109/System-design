import 'fake-indexeddb/auto'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRegisteredNode } from '@system-design/components'
import { createEmptyProject, type SimulationProgress, type SimulationResult } from '@system-design/model'
import { runSimulation } from '@system-design/simulation'
import type { SimulationWorkerClient } from '@system-design/simulation/client'
import { LocalHistoryDatabase, LocalHistoryRepository } from './local-history'
import { createWorkbenchSession } from './workbench-session'

const databases: LocalHistoryDatabase[] = []
const sessions: ReturnType<typeof createWorkbenchSession>[] = []

const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => { resolve = onResolve; reject = onReject })
  return { promise, resolve, reject }
}

const createProject = (id = 'session-project') => {
  const project = createEmptyProject(id)
  project.topology.nodes = [
    createRegisteredNode('traffic', 'traffic', { x: 0, y: 0 }, 'load'),
    createRegisteredNode('service', 'api', { x: 200, y: 0 }),
  ]
  project.topology.edges = [{
    id: 'traffic-to-api', source: 'traffic', target: 'api', sourcePort: 'out', targetPort: 'in',
    sourceSemantic: 'request', targetSemantic: 'request', routingMode: 'weighted-one', weight: 1,
  }]
  const experiment = project.experiments[0]!
  experiment.simulation.durationSeconds = 1
  experiment.workloads = [{
    id: 'load', name: 'Practice traffic', sourceNodeId: 'traffic', requestsPerSecond: 10,
    startAtSeconds: 0, durationSeconds: 1, pattern: 'constant', requestBytes: 1_024,
  }]
  return project
}

const createHistory = () => {
  const database = new LocalHistoryDatabase(`session-test-${crypto.randomUUID()}`)
  databases.push(database)
  return new LocalHistoryRepository(database, 'practice-attempt')
}

const createSession: typeof createWorkbenchSession = (options) => {
  const session = createWorkbenchSession(options)
  sessions.push(session)
  return session
}

const createDelayedRunner = () => {
  const pending: Array<ReturnType<typeof deferred<SimulationResult>> & {
    input: Parameters<SimulationWorkerClient['run']>[0]
    options: NonNullable<Parameters<SimulationWorkerClient['run']>[1]>
  }> = []
  return {
    pending,
    run: vi.fn<SimulationWorkerClient['run']>((input, options = {}) => {
      const completion = deferred<SimulationResult>()
      pending.push({ ...completion, input, options })
      return completion.promise
    }),
    // Keep promises deliverable after cancellation to exercise late worker responses.
    cancelActive: vi.fn(() => true),
    dispose: vi.fn(),
  }
}

const progressFor = (result: SimulationResult): SimulationProgress => ({
  runId: result.runId, simulatedTimeMs: result.simulatedDurationMs, simulatedDurationMs: result.simulatedDurationMs,
  generatedRequests: result.summary.generatedRequests, completedRequests: result.summary.completedRequests,
  failedRequests: result.summary.failedRequests, events: result.events,
})

afterEach(async () => {
  for (const session of sessions.splice(0)) session.dispose()
  vi.restoreAllMocks()
  await Promise.all(databases.splice(0).map(async (database) => {
    database.close()
    await database.delete()
  }))
})

describe('workbench session lifecycle', () => {
  it('runs two sessions independently and cancels only the selected session', async () => {
    const firstProject = createProject('first-attempt')
    const secondProject = createProject('second-attempt')
    const firstRunner = createDelayedRunner()
    const secondRunner = createDelayedRunner()
    const first = createSession({ id: 'first', initialProject: firstProject, history: null, createRunner: () => firstRunner })
    const second = createSession({ id: 'second', initialProject: secondProject, history: null, createRunner: () => secondRunner })
    const firstProgress = vi.fn()
    const secondProgress = vi.fn()
    const firstRun = first.run(firstProgress)
    const secondRun = second.run(secondProgress)
    expect(first.store.getState().running).toBe(true)
    expect(second.store.getState().running).toBe(true)

    first.cancel()
    expect(firstRunner.cancelActive).toHaveBeenCalledOnce()
    expect(secondRunner.cancelActive).not.toHaveBeenCalled()
    expect(first.store.getState().running).toBe(false)
    expect(second.store.getState().running).toBe(true)

    const firstResult = await runSimulation(firstProject, 'first-run')
    const secondResult = await runSimulation(secondProject, 'second-run')
    firstRunner.pending[0]!.options.onProgress?.(progressFor(firstResult))
    secondRunner.pending[0]!.options.onProgress?.(progressFor(secondResult))
    firstRunner.pending[0]!.resolve(firstResult)
    secondRunner.pending[0]!.resolve(secondResult)

    await expect(firstRun).resolves.toBeUndefined()
    await expect(secondRun).resolves.toMatchObject({ project: secondProject, result: secondResult })
    expect(firstProgress).not.toHaveBeenCalled()
    expect(secondProgress).toHaveBeenCalledOnce()
    expect(first.store.getState().result).toBeNull()
    expect(second.store.getState()).toMatchObject({ running: false, error: null, result: secondResult })
  })

  it.each(['edit', 'reset', 'dispose'] as const)('discards late results and progress after %s', async (change) => {
    const project = createProject()
    const runner = createDelayedRunner()
    const history = createHistory()
    const saveRevision = vi.spyOn(history, 'saveProjectRevision')
    const saveRun = vi.spyOn(history, 'saveSimulationRun')
    const session = createSession({ id: change, initialProject: project, history, createRunner: () => runner })
    const onProgress = vi.fn()
    const running = session.run(onProgress)

    if (change === 'edit') session.store.getState().updateMeta({ seed: 'changed-during-run' })
    else if (change === 'reset') session.reset()
    else session.dispose()

    const result = await runSimulation(project, `${change}-late-run`)
    runner.pending[0]!.options.onProgress?.(progressFor(result))
    runner.pending[0]!.resolve(result)

    await expect(running).resolves.toBeUndefined()
    expect(session.store.getState()).toMatchObject({ running: false, result: null, error: null })
    expect(onProgress).not.toHaveBeenCalled()
    expect(saveRevision).not.toHaveBeenCalled()
    expect(saveRun).not.toHaveBeenCalled()
    if (change === 'reset') {
      expect(session.store.getState().project).toEqual(project)
      expect(session.store.temporal.getState().pastStates).toHaveLength(0)
    }
  })

  it('creates a fresh runner after disposal and ignores the old run completing during the next run', async () => {
    const project = createProject()
    const oldRunner = createDelayedRunner()
    const newRunner = createDelayedRunner()
    const createRunner = vi.fn().mockReturnValueOnce(oldRunner).mockReturnValueOnce(newRunner)
    const session = createSession({ id: 'remounted', initialProject: project, history: null, createRunner })
    const oldRun = session.run()
    session.dispose()
    const newRun = session.run()
    expect(oldRunner.dispose).toHaveBeenCalledOnce()
    expect(createRunner).toHaveBeenCalledTimes(2)

    oldRunner.pending[0]!.resolve(await runSimulation(project, 'old-run'))
    await expect(oldRun).resolves.toBeUndefined()
    expect(session.store.getState()).toMatchObject({ running: true, result: null, error: null })
    const newResult = await runSimulation(project, 'new-run')
    newRunner.pending[0]!.resolve(newResult)

    await expect(newRun).resolves.toMatchObject({ project, result: newResult })
    expect(session.store.getState()).toMatchObject({ running: false, result: newResult })
    expect(newRunner.dispose).not.toHaveBeenCalled()
  })

  it('does not let a cancelled run failure stop or overwrite a replacement run', async () => {
    const project = createProject()
    const runner = createDelayedRunner()
    const session = createSession({ id: 'replacement', initialProject: project, history: null, createRunner: () => runner })
    const oldRun = session.run()
    const newRun = session.run()

    runner.pending[0]!.reject(new Error('Old worker failed late'))
    await expect(oldRun).resolves.toBeUndefined()
    expect(session.store.getState()).toMatchObject({ running: true, result: null, error: null })
    const result = await runSimulation(project, 'replacement-run')
    runner.pending[1]!.resolve(result)

    await expect(newRun).resolves.toMatchObject({ result })
    expect(session.store.getState()).toMatchObject({ running: false, result, error: null })
  })

  it('keeps the current run active when an old subscription sees an equivalent project replacement', async () => {
    const project = createProject()
    const runner = createDelayedRunner()
    const session = createSession({ id: 'stale-subscription', initialProject: project, history: null, createRunner: () => runner })
    const oldRun = session.run()
    const currentRun = session.run()

    session.store.getState().setProject(structuredClone(session.store.getState().project))
    const stillRunning = session.store.getState().running
    const result = await runSimulation(project, 'current-run')
    runner.pending[0]!.resolve(result)
    runner.pending[1]!.resolve(result)

    await expect(oldRun).resolves.toBeUndefined()
    const completed = await currentRun
    expect(stillRunning).toBe(true)
    expect(completed).toMatchObject({ result })
  })
})

describe('workbench run persistence', () => {
  it('saves the captured run snapshot without replacing a newer active project', async () => {
    const project = createProject()
    const history = createHistory()
    const runner = createDelayedRunner()
    const session = createSession({ id: 'snapshot', initialProject: project, history, createRunner: () => runner })
    await history.saveProjectRevision(project, 'manual')
    const saveStarted = deferred<void>()
    const continueSave = deferred<void>()
    const originalSave = history.saveProjectRevision.bind(history)
    const saveRevision = vi.spyOn(history, 'saveProjectRevision').mockImplementationOnce(async (...args) => {
      saveStarted.resolve()
      await continueSave.promise
      return originalSave(...args)
    })
    const saveRun = vi.spyOn(history, 'saveSimulationRun')
    const running = session.run()
    const result = await runSimulation(project, 'snapshot-run')
    runner.pending[0]!.resolve(result)
    await saveStarted.promise

    session.store.getState().updateMeta({ seed: 'newer-design' })
    const newerProject = structuredClone(session.store.getState().project)
    const newerRevision = await history.saveProjectRevision(newerProject, 'manual')
    continueSave.resolve()

    await expect(running).resolves.toBeUndefined()
    expect(saveRevision).toHaveBeenNthCalledWith(1, project, 'autosave', { activate: false })
    expect(saveRun).toHaveBeenCalledWith(project, result, expect.any(String))
    expect((await history.loadActiveProject())?.revisionId).toBe(newerRevision.revisionId)
    const savedRuns = await history.listSimulationRuns(project.id)
    expect(savedRuns).toHaveLength(1)
    expect(savedRuns[0]).toMatchObject({ projectSnapshot: project, result })
    expect(session.store.getState()).toMatchObject({ project: newerProject, running: false, result: null })
  })

  it.each(['saveProjectRevision', 'saveSimulationRun'] as const)('keeps simulation results usable when %s fails', async (failedMethod) => {
    const project = createProject()
    const history = createHistory()
    vi.spyOn(history, failedMethod).mockRejectedValueOnce(new Error('Local history is full'))
    const runner = createDelayedRunner()
    const session = createSession({ id: failedMethod, initialProject: project, history, createRunner: () => runner })
    const running = session.run()
    const result = await runSimulation(project, `${failedMethod}-run`)
    runner.pending[0]!.resolve(result)

    const completed = await running
    expect(completed).toEqual({ project, result, persistenceError: 'Local history is full' })
    expect(session.store.getState()).toMatchObject({ running: false, result, error: null })
    expect(completed!.result).not.toBe(result)
    expect(completed!.project).not.toBe(session.store.getState().project)
  })
})
