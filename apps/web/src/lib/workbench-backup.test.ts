import 'fake-indexeddb/auto'
import { afterEach, expect, it } from 'vitest'
import { createEmptyProject, type SimulationResult } from '@system-design/model'
import { LocalHistoryDatabase, LocalHistoryRepository } from './local-history'
const databases: LocalHistoryDatabase[] = []
function create() { const db = new LocalHistoryDatabase(`backup-${crypto.randomUUID()}`); databases.push(db); return new LocalHistoryRepository(db) }
afterEach(async () => { await Promise.all(databases.splice(0).map(db => db.delete())) })
const result = (id: string, projectId: string): SimulationResult => ({ runId: id, scenarioId: projectId, seed: 'system-design', engineVersion: 1, simulatedDurationMs: 1000, wallClockDurationMs: 1, summary: { generatedRequests: 1, completedRequests: 1, failedRequests: 0, throughputPerSecond: 1, errorRate: 0, latencyP50Ms: 1, latencyP95Ms: 1, latencyP99Ms: 1 }, nodes: [], operations: [], actions: [], timeSeries: [], traces: [], events: [], spans: [], warnings: [] })
it('restores projects and histories while retaining the old draft and identifying imported results', async () => {
  const source = create(); const project = createEmptyProject('original'); await source.loadActiveProject()
  await source.saveProjectRevision(project); await source.saveSimulationRun(project, result('run-one', project.id))
  const backup = await source.exportBackup(project)
  const target = create(); const prior = createEmptyProject('target-draft'); prior.name = 'keep my draft'
  await target.loadActiveProject(); await target.saveProjectRevision(prior)
  const preview = await target.previewBackup(JSON.parse(JSON.stringify(backup)))
  expect((await target.loadActiveProject())?.project).toEqual(prior)
  await target.importBackup(preview, prior)
  expect((await target.loadActiveProject())?.project).toEqual(project)
  expect((await target.listSimulationRuns(project.id))[0]).toMatchObject({ imported: true, result: result('run-one', project.id) })
  expect((await target.listProjectRevisions(prior.id)).some(r => r.project.name === 'keep my draft')).toBe(true)
})
it('preserves unsupported run formats and rejects scope, broken snapshot and conflicting imports without replacing data', async () => {
  const repo = create(); const project = createEmptyProject('original'); await repo.loadActiveProject(); await repo.saveProjectRevision(project)
  await repo.saveSimulationRun(project, result('run-one', project.id))
  const backup = await repo.exportBackup(project)
  await expect(repo.previewBackup({ ...backup, scope: 'another' })).rejects.toThrow('范围')
  const mismatch = structuredClone(backup); mismatch.runs[0]!.result.seed = 'wrong-seed'
  await expect(repo.previewBackup(mismatch)).rejects.toThrow('不匹配')
  const conflict = structuredClone(backup); conflict.revisions[0]!.project.name = 'tampered'
  const preview = await repo.previewBackup(conflict)
  await expect(repo.importBackup(preview, project)).rejects.toThrow('同名')
  expect((await repo.loadActiveProject())?.project).toEqual(project)
  const future = structuredClone(backup); future.runs[0]!.recordVersion = 99 as never
  const target = create(); await target.loadActiveProject()
  const futurePreview = await target.previewBackup(future); expect(futurePreview.retained).toBe(1)
  await target.importBackup(futurePreview, createEmptyProject('empty'))
  expect(await target.listSimulationRuns(project.id)).toHaveLength(0)
  expect((await target.exportBackup(project)).runs[0]?.recordVersion).toBe(99)
})
