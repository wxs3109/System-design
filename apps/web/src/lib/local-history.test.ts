import 'fake-indexeddb/auto'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEmptyProject, type SimulationResult } from '@system-design/model'
import { LocalHistoryDatabase, LocalHistoryRepository } from './local-history'

const databases: LocalHistoryDatabase[] = []
const createRepository = () => {
  const database = new LocalHistoryDatabase(`history-test-${crypto.randomUUID()}`)
  databases.push(database)
  return new LocalHistoryRepository(database)
}

const resultFor = (runId: string, projectId: string): SimulationResult => ({
  runId, scenarioId: projectId, seed: 'system-design', simulatedDurationMs: 1_000, wallClockDurationMs: 1,
  summary: { generatedRequests: 1, completedRequests: 1, failedRequests: 0, throughputPerSecond: 1, errorRate: 0, latencyP50Ms: 1, latencyP95Ms: 1, latencyP99Ms: 1 },
  nodes: [], timeSeries: [], traces: [], events: [], spans: [], warnings: [],
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
})
