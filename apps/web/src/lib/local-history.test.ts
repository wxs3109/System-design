import 'fake-indexeddb/auto'

import { afterEach, describe, expect, it, vi } from 'vitest'
import Dexie from 'dexie'
import { createEmptyProject, type ProjectFileV2, type SimulationResult } from '@system-design/model'
import { getLocalHistoryRepository, LocalHistoryDatabase, LocalHistoryRepository } from './local-history'

const databases: LocalHistoryDatabase[] = []
const createRepository = () => {
  const database = new LocalHistoryDatabase(`history-test-${crypto.randomUUID()}`)
  databases.push(database)
  return new LocalHistoryRepository(database)
}

const resultFor = (runId: string, projectId: string): SimulationResult => ({
  runId, scenarioId: projectId, seed: 'system-design', simulatedDurationMs: 1_000, wallClockDurationMs: 1,
  summary: { generatedRequests: 1, completedRequests: 1, failedRequests: 0, throughputPerSecond: 1, errorRate: 0, latencyP50Ms: 1, latencyP95Ms: 1, latencyP99Ms: 1 },
  nodes: [], operations: [], actions: [], timeSeries: [], traces: [], events: [], spans: [], warnings: [],
})

const asProjectV2 = (project: ReturnType<typeof createEmptyProject>): ProjectFileV2 => ({
  schemaVersion: 2,
  id: project.id,
  name: project.name,
  topology: structuredClone(project.topology),
  experiments: project.experiments.map((experiment) => ({
    id: experiment.id,
    name: experiment.name,
    workloads: structuredClone(experiment.workloads),
    faults: structuredClone(experiment.faults),
    simulation: structuredClone(experiment.simulation),
    seed: experiment.seed,
  })),
  activeExperimentId: project.activeExperimentId,
})

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(databases.splice(0).map(async (database) => {
    database.close()
    await database.delete()
  }))
})

describe('local project and run history', () => {
  it('stores immutable validated revisions and restores the active project', async () => {
    const repository = createRepository()
    const project = createEmptyProject('revision-project')
    const first = await repository.saveProjectRevision(project, 'autosave')
    project.name = 'Changed after save'

    const restored = await repository.loadActiveProject()
    expect(restored?.revisionId).toBe(first.revisionId)
    expect(restored?.project.name).toBe('Untitled system')

    restored!.project.name = 'Changed after load'
    expect((await repository.loadActiveProject())?.project.name).toBe('Untitled system')
  })

  it('isolates free-workspace and exercise restore pointers in the same database', async () => {
    const freeWorkspace = createRepository()
    const firstAttempt = new LocalHistoryRepository(freeWorkspace.database, 'exercise:attempt-one')
    const secondAttempt = new LocalHistoryRepository(freeWorkspace.database, 'exercise:attempt-two')
    const freeProject = createEmptyProject('free-project')
    const firstProject = createEmptyProject('attempt-one-project')
    const secondProject = createEmptyProject('attempt-two-project')

    await freeWorkspace.saveProjectRevision(freeProject)
    await firstAttempt.saveProjectRevision(firstProject)
    await secondAttempt.saveProjectRevision(secondProject)
    firstProject.name = 'First attempt edited'
    await firstAttempt.saveProjectRevision(firstProject)

    expect((await freeWorkspace.loadActiveProject())?.project).toEqual(freeProject)
    expect((await firstAttempt.loadActiveProject())?.project).toEqual(firstProject)
    expect((await secondAttempt.loadActiveProject())?.project).toEqual(secondProject)
    const restoredAttempt = new LocalHistoryRepository(freeWorkspace.database, firstAttempt.workspaceKey)
    expect((await restoredAttempt.loadActiveProject())?.project).toEqual(firstProject)
    expect(await new LocalHistoryRepository(freeWorkspace.database, 'unused-scope').loadActiveProject()).toBeUndefined()
  })

  it('keeps active pointers unchanged for both new and deduplicated snapshot-only saves', async () => {
    const repository = createRepository()
    const active = await repository.saveProjectRevision(createEmptyProject('current-project'))
    const snapshot = createEmptyProject('snapshot-project')

    const first = await repository.saveProjectRevision(snapshot, 'manual', { activate: false })
    const duplicate = await repository.saveProjectRevision(snapshot, 'autosave', { activate: false })

    expect(duplicate.revisionId).toBe(first.revisionId)
    expect((await repository.loadActiveProject())?.revisionId).toBe(active.revisionId)
    expect((await repository.loadProjectRevision(first.revisionId))?.project).toEqual(snapshot)

    const emptyScope = new LocalHistoryRepository(repository.database, 'empty-attempt')
    await emptyScope.saveProjectRevision(snapshot, 'autosave', { activate: false })
    expect(await emptyScope.loadActiveProject()).toBeUndefined()
    await emptyScope.saveProjectRevision(snapshot)
    expect((await emptyScope.loadActiveProject())?.revisionId).toBe(first.revisionId)
    expect((await repository.loadActiveProject())?.revisionId).toBe(active.revisionId)
  })

  it('reuses repositories per scope and shares one database across cached scopes', () => {
    const defaultRepository = getLocalHistoryRepository()
    const scopedRepository = getLocalHistoryRepository('repository-cache-test')

    expect(getLocalHistoryRepository('active')).toBe(defaultRepository)
    expect(getLocalHistoryRepository('repository-cache-test')).toBe(scopedRepository)
    expect(scopedRepository).not.toBe(defaultRepository)
    expect(scopedRepository.database).toBe(defaultRepository.database)
  })

  it('upgrades persisted v2 revisions and run snapshots to capacity-only v3 records', async () => {
    const name = `history-test-${crypto.randomUUID()}`
    const legacyDatabase = new Dexie(name)
    legacyDatabase.version(1).stores({
      projectRevisions: '&revisionId, projectId, [projectId+createdAt], fingerprint',
      simulationRuns: '&runId, projectId, [projectId+createdAt], projectRevisionId',
      activeWorkspace: '&key, updatedAt',
    })
    const project = asProjectV2(createEmptyProject('legacy-history'))
    await legacyDatabase.table('projectRevisions').add({
      revisionId: 'legacy-revision', projectId: project.id, projectName: project.name, createdAt: 1,
      source: 'autosave', fingerprint: JSON.stringify(project), project,
    })
    await legacyDatabase.table('simulationRuns').add({
      runId: 'legacy-run', projectId: project.id, projectRevisionId: 'legacy-revision',
      experimentId: project.activeExperimentId, createdAt: 1, projectSnapshot: project, result: resultFor('legacy-run', project.id),
    })
    await legacyDatabase.table('activeWorkspace').add({
      key: 'active', projectId: project.id, projectRevisionId: 'legacy-revision', updatedAt: 1,
    })
    legacyDatabase.close()

    const database = new LocalHistoryDatabase(name)
    databases.push(database)
    const repository = new LocalHistoryRepository(database)
    const revision = await repository.loadActiveProject()
    const listedRevision = (await repository.listProjectRevisions(project.id))[0]
    const run = (await repository.listSimulationRuns(project.id))[0]

    expect(revision?.project).toMatchObject({ schemaVersion: 3, modelingMode: 'capacity-only' })
    expect(revision?.project.definitions).toMatchObject({ schemaVersion: 1, apis: [], dataModels: [], events: [], interactions: [] })
    expect(revision?.project.experiments[0]?.operationWorkloads).toEqual([])
    expect(revision?.fingerprint).toBe(JSON.stringify(revision?.project))
    expect(listedRevision?.project).toEqual(revision?.project)
    expect(listedRevision?.fingerprint).toBe(JSON.stringify(listedRevision?.project))
    expect(run?.projectSnapshot).toEqual(revision?.project)
    expect(await new LocalHistoryRepository(database, 'new-exercise').loadActiveProject()).toBeUndefined()
  })

  it('deduplicates identical autosaves but keeps exact changed revisions', async () => {
    const repository = createRepository()
    const project = createEmptyProject('dedupe-project')
    const first = await repository.saveProjectRevision(project)
    const duplicate = await repository.saveProjectRevision(structuredClone(project))
    expect(duplicate.revisionId).toBe(first.revisionId)

    const changed = structuredClone(project)
    changed.name = 'Revision two'
    const second = await repository.saveProjectRevision(changed, 'manual')
    expect(second.revisionId).not.toBe(first.revisionId)
    expect((await repository.listProjectRevisions(project.id)).map((revision) => revision.project.name)).toEqual(['Revision two', 'Untitled system'])
  })

  it('keeps imported projects separate by project id and points refresh restore to the latest import', async () => {
    const repository = createRepository()
    await repository.saveProjectRevision(createEmptyProject('local-project'))
    const imported = createEmptyProject('imported-project')
    imported.name = 'Imported design'
    await repository.saveProjectRevision(imported, 'import')

    expect((await repository.loadActiveProject())?.project).toEqual(imported)
    expect(await repository.listProjectRevisions('local-project')).toHaveLength(1)
    expect(await repository.listProjectRevisions('imported-project')).toHaveLength(1)
  })

  it('links immutable run results to a concrete project revision and rejects run-id overwrite', async () => {
    const repository = createRepository()
    const project = createEmptyProject('run-project')
    const revision = await repository.saveProjectRevision(project)
    const result = resultFor('run-1', project.id)
    await repository.saveSimulationRun(project, result, revision.revisionId)
    result.summary.completedRequests = 99

    const runs = await repository.listSimulationRuns(project.id)
    expect(runs[0]).toMatchObject({ runId: 'run-1', projectRevisionId: revision.revisionId, experimentId: 'default-experiment' })
    expect(runs[0]?.projectSnapshot).toEqual(project)
    expect(runs[0]?.result.summary.completedRequests).toBe(1)
    await expect(repository.saveSimulationRun(project, result, revision.revisionId)).rejects.toMatchObject({ name: 'ConstraintError' })
    project.name = 'Changed after run'
    expect((await repository.listSimulationRuns(project.id))[0]?.projectSnapshot?.name).toBe('Untitled system')
  })

  it('rejects mismatched revisions and results instead of recording an ambiguous run', async () => {
    const repository = createRepository()
    const project = createEmptyProject('matched-project')
    const revision = await repository.saveProjectRevision(project)
    const changed = structuredClone(project)
    changed.name = 'Different topology revision'

    await expect(repository.saveSimulationRun(changed, resultFor('wrong-revision', changed.id), revision.revisionId))
      .rejects.toThrow('exact project revision')
    await expect(repository.saveSimulationRun(project, resultFor('wrong-project', 'another-project'), revision.revisionId))
      .rejects.toThrow('does not match')
    const wrongSeed = resultFor('wrong-seed', project.id)
    wrongSeed.seed = 'another-seed'
    await expect(repository.saveSimulationRun(project, wrongSeed, revision.revisionId)).rejects.toThrow('does not match')
    expect(await repository.listSimulationRuns(project.id)).toEqual([])
  })

  it('saves scoped run snapshots without moving restore pointers and still validates exact revisions', async () => {
    const freeWorkspace = createRepository()
    const attempt = new LocalHistoryRepository(freeWorkspace.database, 'exercise:run-attempt')
    const freeRevision = await freeWorkspace.saveProjectRevision(createEmptyProject('free-run-project'))
    const project = createEmptyProject('scoped-run-project')
    const current = structuredClone(project)
    current.name = 'Edited while simulation was running'
    const activeRevision = await attempt.saveProjectRevision(current)

    const run = await attempt.saveSimulationRun(project, resultFor('scoped-run', project.id))

    expect((await freeWorkspace.loadActiveProject())?.revisionId).toBe(freeRevision.revisionId)
    expect((await attempt.loadActiveProject())?.revisionId).toBe(activeRevision.revisionId)
    expect(run.projectSnapshot).toEqual(project)
    expect((await attempt.loadProjectRevision(run.projectRevisionId))?.project).toEqual(project)
    await expect(attempt.saveSimulationRun(current, resultFor('mismatched-scoped-run', project.id), run.projectRevisionId))
      .rejects.toThrow('exact project revision')
    expect(await attempt.listSimulationRuns(project.id)).toHaveLength(1)
  })

  it('rejects invalid project snapshots before writing anything', async () => {
    const repository = createRepository()
    await expect(repository.saveProjectRevision({ schemaVersion: 2, id: 'invalid' })).rejects.toThrow()
    expect(await repository.loadActiveProject()).toBeUndefined()
  })

  it('caps project revisions at 50 while preserving a revision referenced by a run', async () => {
    const repository = createRepository()
    const project = createEmptyProject('retained-revisions')
    project.name = 'Revision 0'
    const referenced = await repository.saveProjectRevision(project)
    await repository.saveSimulationRun(project, resultFor('retained-run', project.id), referenced.revisionId)

    for (let index = 1; index <= 55; index += 1) {
      project.name = `Revision ${index}`
      await repository.saveProjectRevision(project)
    }

    const revisions = await repository.listProjectRevisions(project.id, 100)
    expect(revisions).toHaveLength(51)
    expect(revisions.some((revision) => revision.revisionId === referenced.revisionId)).toBe(true)
    expect(revisions.filter((revision) => revision.revisionId !== referenced.revisionId)).toHaveLength(50)
  })

  it('caps run history at 25 and keeps the newest immutable results', async () => {
    const repository = createRepository()
    const project = createEmptyProject('retained-runs')
    const revision = await repository.saveProjectRevision(project)
    for (let index = 0; index < 30; index += 1) {
      await repository.saveSimulationRun(project, resultFor(`run-${index}`, project.id), revision.revisionId)
    }

    const runs = await repository.listSimulationRuns(project.id, 100)
    expect(runs).toHaveLength(25)
    expect(runs.map((run) => run.runId)).toEqual(expect.arrayContaining(['run-29', 'run-5']))
    expect(runs.map((run) => run.runId)).not.toContain('run-4')
  })

  it('preserves a scoped active revision when pruning later snapshot-only saves', async () => {
    const repository = createRepository()
    const project = createEmptyProject('active-retained-project')
    const active = await repository.saveProjectRevision(project)

    for (let index = 1; index <= 55; index += 1) {
      project.name = `Snapshot ${index}`
      await repository.saveProjectRevision(project, 'autosave', { activate: false })
    }

    expect((await repository.loadActiveProject())?.revisionId).toBe(active.revisionId)
    expect(await repository.listProjectRevisions(project.id, 100)).toHaveLength(51)
  })
})
