import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, expect, it, vi } from 'vitest'
import { createEmptyProject } from '@system-design/model'
import { LocalHistoryDatabase, LocalHistoryRepository } from './local-history'

describe('workbench writer ownership and recovery', () => {
  it('retains unsupported engine results and excludes them from current history rendering', async () => {
    const db = new LocalHistoryDatabase(`canvas-run-version-${crypto.randomUUID()}`)
    try {
      const repo = new LocalHistoryRepository(db); const project = createEmptyProject('history')
      const revision = await repo.saveProjectRevision(project)
      const unknown = { recordVersion: 2 as const, runId: 'future', projectId: project.id, projectRevisionId: revision.revisionId, experimentId: project.activeExperimentId, createdAt: 1, projectSnapshot: project, result: { engineVersion: 99 } }
      await db.simulationRuns.put(unknown as never)
      expect(await repo.listSimulationRuns(project.id)).toEqual([])
      expect(repo.retainedRecords()).toEqual([unknown])
      expect(await db.simulationRuns.get('future')).toEqual(unknown)
      expect((await repo.loadActiveProject())?.project.id).toBe('history')
    } finally { db.close(); await db.delete() }
  })
  it('rejects a stale writer atomically, retains immutable revisions, then allows explicit reload', async () => {
    const db = new LocalHistoryDatabase(`canvas-conflict-${crypto.randomUUID()}`)
    try {
      const a = new LocalHistoryRepository(db); const b = new LocalHistoryRepository(db)
      await a.loadActiveProject(); await b.loadActiveProject()
      const first = createEmptyProject('shared'); first.name = 'A edit'
      await a.saveProjectRevision(first)
      const other = createEmptyProject('shared'); other.name = 'B unsaved'
      await expect(b.saveProjectRevision(other)).rejects.toMatchObject({ kind: 'conflict' })
      expect((await a.loadActiveProject())?.project.name).toBe('A edit')
      expect(await db.projectRevisions.count()).toBe(1)
      await b.loadActiveProject(); await b.saveProjectRevision(other)
      expect((await b.loadActiveProject())?.project.name).toBe('B unsaved')
    } finally { db.close(); await db.delete() }
  })
  it('preserves unknown heads and blocks writes until reading succeeds', async () => {
    const db = new LocalHistoryDatabase(`canvas-version-${crypto.randomUUID()}`)
    try {
      const initial = new LocalHistoryRepository(db); await initial.loadActiveProject()
      await initial.saveProjectRevision(createEmptyProject('preserved'))
      const old = (await db.workspaceHeads.get('active'))!
      const unknown = { ...old, version: 99 }; await db.workspaceHeads.put(unknown as never)
      const repo = new LocalHistoryRepository(db)
      await expect(repo.loadActiveProject()).rejects.toMatchObject({ kind: 'load' })
      await expect(repo.saveProjectRevision(createEmptyProject('replacement'))).rejects.toMatchObject({ kind: 'load' })
      expect(await db.workspaceHeads.get('active')).toEqual(unknown)
      expect(repo.recoveryData()).toMatchObject({ active: { head: unknown } })
      await db.workspaceHeads.put(old); await repo.loadActiveProject()
      await repo.saveProjectRevision(createEmptyProject('recovered'))
      expect((await repo.loadActiveProject())?.project.id).toBe('recovered')
    } finally { db.close(); await db.delete() }
  })
  it('retries a transient failure and serializes rapid edits from one writer', async () => {
    const db = new LocalHistoryDatabase(`canvas-read-${crypto.randomUUID()}`)
    try {
      const repo = new LocalHistoryRepository(db)
      const failed = vi.spyOn(db.workspaceHeads, 'get').mockRejectedValueOnce(new Error('offline'))
      await expect(repo.loadActiveProject()).rejects.toThrow('offline')
      await expect(repo.saveProjectRevision(createEmptyProject())).rejects.toMatchObject({ kind: 'load' })
      failed.mockRestore(); await repo.loadActiveProject()
      await Promise.all(Array.from({ length: 10 }, (_, i) => { const project = createEmptyProject('edits'); project.name = `edit-${i}`; return repo.saveProjectRevision(project) }))
      expect((await repo.loadActiveProject())?.project.name).toBe('edit-9')
    } finally { db.close(); await db.delete() }
  })
  it('migrates a v2 pointer and isolates it from legacy writers without deleting old data', async () => {
    const name = `canvas-legacy-${crypto.randomUUID()}`; const old = new Dexie(name)
    old.version(2).stores({ projectRevisions: '&revisionId, projectId, [projectId+createdAt], fingerprint', simulationRuns: '&runId, projectId, [projectId+createdAt], projectRevisionId', activeWorkspace: '&key, updatedAt' })
    const project = createEmptyProject('legacy')
    await old.table('projectRevisions').put({ revisionId: 'old', projectId: project.id, projectName: project.name, createdAt: 1, source: 'autosave', fingerprint: JSON.stringify(project), project })
    await old.table('activeWorkspace').put({ key: 'active', projectId: project.id, projectRevisionId: 'old', updatedAt: 1 }); old.close()
    const db = new LocalHistoryDatabase(name)
    try {
      const repo = new LocalHistoryRepository(db); expect((await repo.loadActiveProject())?.project.id).toBe('legacy')
      const next = createEmptyProject('current'); await repo.saveProjectRevision(next)
      await old.open(); await old.table('activeWorkspace').put({ key: 'active', projectId: project.id, projectRevisionId: 'old', updatedAt: 5 }); old.close()
      expect((await repo.loadActiveProject())?.project.id).toBe('current')
      expect(await db.projectRevisions.get('old')).toBeDefined()
      expect((await db.activeWorkspace.get('active'))?.projectId).toBe('legacy')
    } finally { old.close(); db.close(); await db.delete() }
  })
})
