import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AlgorithmDatabase, LabRepository } from './repository'
import { LabSession } from './session'
import type { LabContract } from './contracts'

type Draft = { value: number }
type Attempt = { id: string; createdAt: number; draft: Draft; result: number }
const contract: LabContract<Draft, Attempt> = {
  versions: { model: 'history-test-v1', definition: 1, assessment: 1 }, draftVersion: 1,
  initial: () => ({ value: 0 }),
  parseDraft: value => { const d = value as Draft; if (!d || !Number.isFinite(d.value)) throw new Error('invalid draft'); return { value: d.value } },
  runAttempt: draft => ({ id: crypto.randomUUID(), createdAt: Date.now(), draft: { ...draft }, result: draft.value * 2 }),
  verifyAttempt: (v): v is Attempt => { const a = v as Attempt; return !!a && typeof a.id === 'string' && Number.isFinite(a.createdAt) && !!a.draft && Number.isFinite(a.draft.value) && a.result === a.draft.value * 2 },
}
const databases: AlgorithmDatabase[] = []
function create(scope = 'history-test:v1') { const db = new AlgorithmDatabase(`history-${crypto.randomUUID()}`); databases.push(db); return new LabRepository(db, scope, contract) }
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(databases.splice(0).map(db => db.delete())) })
describe('bounded history and recovery', () => {
  it('opens only ten of a thousand records and pages index summaries without replaying models', async () => {
    const repo = create(); const verify = vi.spyOn(repo.contract, 'verifyAttempt')
    await repo.database.attempts.bulkAdd(Array.from({ length: 1000 }, (_, i) => ({ id: `record-${i}`, scope: repo.scope, attempt: { id: `record-${i}`, createdAt: i, draft: { value: i }, result: i * 2 } })))
    const result = await repo.load()
    expect(result.historyTotal).toBe(1000); expect(result.attempts).toHaveLength(10); expect(verify).toHaveBeenCalledTimes(10)
    const page = await repo.historyPage(1, false)
    expect(page.entries.map(e => e.id)).toEqual(Array.from({ length: 10 }, (_, i) => `record-${989 - i}`))
    expect(verify).toHaveBeenCalledTimes(10)
    expect((await repo.inspectHistory('record-1')).result).toBe(2)
    expect(verify).toHaveBeenCalledTimes(11)
  })
  it('preserves valid, corrupt and archived evidence across export/import and backs up the replaced draft', async () => {
    const source = create(); const session = new LabSession(source); await session.load()
    session.edit({ value: 3 }); session.run(); await session.save()
    const first = session.getSnapshot().attempts[0]!
    session.edit({ value: 4 }); session.run(); await session.save()
    await session.archiveHistory(first.id, true)
    await source.database.attempts.add({ id: 'future', scope: source.scope, storageVersion: 99 as never, attempt: { id: 'future', createdAt: 5, payload: 'retain exactly' } })
    const backup = await session.exportRecovery()
    const target = create(); const restored = new LabSession(target); await restored.load(); restored.edit({ value: 99 }); await restored.save()
    const preview = await restored.previewRecovery(JSON.parse(JSON.stringify(backup)))
    expect(preview).toMatchObject({ records: 3, retained: 1 })
    expect(restored.getSnapshot().draft.value).toBe(99)
    await restored.importRecovery(preview)
    expect(restored.getSnapshot().draft.value).toBe(4)
    expect((await target.historyPage(0, true)).entries[0]?.id).toBe(first.id)
    expect((await target.database.attempts.get('future'))?.attempt).toEqual({ id: 'future', createdAt: 5, payload: 'retain exactly' })
    expect((await target.database.drafts.get(target.scope))?.draftBackups).toEqual(expect.arrayContaining([expect.objectContaining({ draft: { value: 99 } })]))
    await restored.inspectHistory(first.id)
    expect(restored.getSnapshot().draft.value).toBe(3)
  })
  it('rejects cross-scope, future-format, missing-active and conflicting backups atomically', async () => {
    const repo = create(); const session = new LabSession(repo); await session.load(); session.run(); await session.save()
    const backup = await session.exportRecovery()
    await expect(session.previewRecovery({ ...backup, scope: 'another' })).rejects.toThrow('范围')
    await expect(session.previewRecovery({ ...backup, version: 99 })).rejects.toThrow('版本')
    await expect(session.previewRecovery({ ...backup, activeAttemptId: 'missing' })).rejects.toThrow('缺失')
    const original = await repo.database.drafts.get(repo.scope)
    const changed = structuredClone(backup)
    ;(changed.records[0] as { attempt: Attempt }).attempt.draft.value = 11
    const preview = await session.previewRecovery(changed)
    await expect(session.importRecovery(preview)).rejects.toThrow('同名历史')
    expect(await repo.database.drafts.get(repo.scope)).toEqual(original)
    expect(session.getSnapshot().ready).toBe(true)
  })
  it('allows only explicit deletion of archived inactive evidence and rejects stale writers', async () => {
    const repo = create(); const session = new LabSession(repo); await session.load(); session.run(); await session.save()
    const active = session.getSnapshot().activeAttemptId!
    await expect(repo.archiveHistory(active, true)).rejects.toThrow('正在使用')
    const old = contract.runAttempt({ value: 9 }); await repo.save({ value: 0 }, active, [old])
    await expect(repo.deleteHistory(old.id)).rejects.toThrow('已归档')
    await repo.archiveHistory(old.id, true); await repo.deleteHistory(old.id)
    expect(await repo.database.attempts.get(old.id)).toBeUndefined()
    const stale = new LabRepository(repo.database, repo.scope, contract); await stale.load()
    await repo.save({ value: 2 }, active, [])
    await expect(stale.archiveHistory(active, true)).rejects.toThrow('其他标签页')
  })
})
