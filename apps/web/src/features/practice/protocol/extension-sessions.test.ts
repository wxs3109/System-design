import 'fake-indexeddb/auto'
import { afterEach, expect, it, vi } from 'vitest'
import { AlgorithmDatabase } from '../../../core/experiments/repository'
import { ConcurrentRepository, ConcurrentSession } from '../concurrent-update/session'
import { OverloadRepository, OverloadSession } from '../overload/session'
import { CoordinationRepository } from '../coordination/session'
const databases: AlgorithmDatabase[] = []
function database() { const db = new AlgorithmDatabase(`extensions-test-${crypto.randomUUID()}`); databases.push(db); return db }
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(databases.splice(0).map((db) => db.delete())) })
it('restores a lock wait without mixing concurrent, overload or coordination histories', async () => {
  const db = database(); const repo = new ConcurrentRepository(db); const session = new ConcurrentSession(repo)
  await session.load()
  const d = repo.contract.initial(); d.config.strategy = 'row-lock'; d.commands = [{ type: 'read', worker: 'A' }, { type: 'read', worker: 'B' }]
  session.edit(d); session.run(); await session.save()
  const restored = new ConcurrentSession(repo); await restored.load()
  expect(restored.getSnapshot().draft.commands).toEqual(d.commands)
  expect(restored.getSnapshot().attempts[0]!.result).toMatchObject({ lock: 'A', waiting: ['B'], reservations: [] })
  expect((await new OverloadRepository(db).load()).attempts).toHaveLength(0)
  expect((await new CoordinationRepository('lease-fencing', db).load()).attempts).toHaveLength(0)
  restored.edit({ ...d, commands: [...d.commands, { type: 'commit', worker: 'A' }] }); restored.undo(); expect(restored.getSnapshot().draft.commands).toHaveLength(2)
  restored.redo(); await restored.save(); expect(restored.getSnapshot().draft.commands).toHaveLength(3)
  const a = restored.getSnapshot().attempts[0]!
  await expect(repo.save(a.draft, a.id, [{ ...a, draft: { ...a.draft, reflection: 'rewrite' } }])).rejects.toThrow('不能被覆盖')
})
it('persists pending overload timers and retries a failed save without losing the attempt', async () => {
  const repo = new OverloadRepository(database()); const session = new OverloadSession(repo); await session.load()
  const d = repo.contract.initial(); d.commands = [{ type: 'slow' }, { type: 'submit' }, { type: 'advance', ms: 200 }]
  session.edit(d); await session.save()
  const restored = new OverloadSession(repo); await restored.load(); expect(restored.getSnapshot().draft).toEqual(d)
  const fail = vi.spyOn(repo, 'save').mockRejectedValue(new Error('quota'))
  restored.run(); await vi.waitFor(() => expect(restored.getSnapshot().storage).toBe('error'))
  expect(restored.getSnapshot().attempts[0]!.result.attempts).toHaveLength(2)
  fail.mockRestore(); await restored.save(); expect(restored.getSnapshot().storage).toBe('saved')
  expect((await repo.load()).attempts).toHaveLength(1)
})
it('retains unknown versions and excludes them from both new lesson scopes', async () => {
  const db = database()
  for (const repo of [new ConcurrentRepository(db), new OverloadRepository(db)]) {
    const id = `future-${repo.scope}`
    await db.attempts.add({ id, scope: repo.scope, attempt: { id, exerciseVersion: 99 } })
    const loaded = await repo.load()
    expect(loaded.rejected).toBe(1); expect(loaded.attempts).toHaveLength(0); expect(await db.attempts.get(id)).toBeDefined()
  }
})
