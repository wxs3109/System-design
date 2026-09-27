import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, expect, it, vi } from 'vitest'
import { AlgorithmDatabase } from '../../../core/experiments/repository'
import { ConcurrentRepository, ConcurrentSession } from '../concurrent-update/session'
import { initialDraft, runAttempt } from '../concurrent-update/lesson'
const databases: Dexie[] = []
function database(name = `learner-storage-${crypto.randomUUID()}`) { const db = new AlgorithmDatabase(name); databases.push(db); return db }
afterEach(async () => { vi.restoreAllMocks(); for (const db of databases) db.close(); await Promise.all(databases.splice(0).map((db) => db.delete())) })

it('never replaces an unknown stored session with the initial draft and can retry reading', async () => {
  const db = database(); const repo = new ConcurrentRepository(db)
  const draft = initialDraft(); draft.commands = [{ type: 'read', worker: 'A' }]
  const original = { scope: repo.scope, version: 99, draft, activeAttemptId: null }
  await db.drafts.put(original as never)
  const session = new ConcurrentSession(repo); await session.load()
  expect(session.getSnapshot()).toMatchObject({ ready: false, storage: 'error', errorKind: 'load' })
  session.edit(initialDraft()); session.run(); session.undo(); await session.save()
  expect(await db.drafts.get(repo.scope)).toEqual(original)
  await expect(repo.save(initialDraft(), null, [])).rejects.toThrow('尚未成功读取')
  await db.drafts.put({ ...original, version: 1 })
  await session.load()
  expect(session.getSnapshot()).toMatchObject({ ready: true, error: '', errorKind: null, draft })
})

it('recovers a transient read failure without turning retry into a write', async () => {
  const db = database(); const seed = new ConcurrentRepository(db)
  const draft = initialDraft(); draft.commands = [{ type: 'read', worker: 'B' }]
  await seed.save(draft, null, [])
  const repo = new ConcurrentRepository(db); const session = new ConcurrentSession(repo)
  const read = vi.spyOn(repo, 'load').mockRejectedValueOnce(new Error('temporary read error'))
  const write = vi.spyOn(repo, 'save')
  await session.load(); await session.save()
  expect(write).not.toHaveBeenCalled()
  await session.load()
  expect(read).toHaveBeenCalledTimes(2); expect(session.getSnapshot().draft).toEqual(draft)
  expect((await db.drafts.get(repo.scope))!.draft).toEqual(draft)
})

it('detects stale writers atomically and retains unsaved work until explicit reload', async () => {
  const db = database(); const other = database(db.name)
  const a = new ConcurrentSession(new ConcurrentRepository(db)); const b = new ConcurrentSession(new ConcurrentRepository(other))
  await Promise.all([a.load(), b.load()])
  const draftA = initialDraft(); draftA.commands = [{ type: 'read', worker: 'A' }]
  a.edit(draftA); await a.save()
  const winningRevision = (await db.drafts.get('concurrent-update:v1'))!.revision!
  const draftB = initialDraft(); draftB.commands = [{ type: 'read', worker: 'B' }]
  b.edit(draftB); b.run(); await b.save()
  expect(b.getSnapshot()).toMatchObject({ ready: false, storage: 'error', errorKind: 'conflict', draft: draftB })
  expect((await db.drafts.get('concurrent-update:v1'))!.draft).toEqual(draftA)
  expect(await db.attempts.count()).toBe(0)
  const backup = b.recoverySnapshot()
  expect(backup).toMatchObject({ scope: 'concurrent-update:v1', draft: draftB })
  expect(backup.unsavedAttemptIds).toHaveLength(1)
  b.edit(initialDraft()); b.undo(); b.redo(); await b.save()
  expect(b.getSnapshot().draft).toEqual(draftB)
  await b.reload()
  expect(b.getSnapshot()).toMatchObject({ ready: true, storage: 'saved', errorKind: null, draft: draftA, undoCount: 0 })
  b.edit({ ...draftA, commands: [...draftA.commands, { type: 'read', worker: 'B' }] }); await b.save()
  expect((await db.drafts.get('concurrent-update:v1'))!.revision).toBeGreaterThan(winningRevision)
})

it('allows rapid queued edits from one writer without false conflicts', async () => {
  const repo = new ConcurrentRepository(database()); const session = new ConcurrentSession(repo); await session.load()
  for (let i = 0; i < 20; i++) session.edit({ ...session.getSnapshot().draft, reflection: `draft-${i}` })
  await session.save()
  expect(session.getSnapshot()).toMatchObject({ ready: true, storage: 'saved', error: '' })
  expect((await repo.load()).draft!.reflection).toBe('draft-19')
})

it('migrates version-one data and isolates current drafts from legacy writers', async () => {
  const name = `learner-migration-${crypto.randomUUID()}`
  const legacy = new Dexie(name); databases.push(legacy)
  legacy.version(1).stores({ sessions: '&scope', attempts: '&id, scope' })
  const draft = initialDraft(); draft.commands = [{ type: 'read', worker: 'A' }]
  const attempt = runAttempt(draft)
  await legacy.table('sessions').put({ scope: 'concurrent-update:v1', version: 1, draft, activeAttemptId: attempt.id })
  await legacy.table('attempts').put({ id: attempt.id, scope: 'concurrent-update:v1', attempt })
  legacy.close()
  const db = database(name); const repo = new ConcurrentRepository(db)
  const loaded = await repo.load()
  expect(loaded.draft).toEqual(draft); expect(loaded.attempts).toEqual([attempt]); expect(db.verno).toBe(3)
  await repo.save(draft, attempt.id, [])
  expect((await db.drafts.get(repo.scope))!.revision).toBe(1)
  await legacy.open()
  await legacy.table('sessions').put({ scope: repo.scope, version: 1, draft: initialDraft(), activeAttemptId: null })
  expect((await repo.load()).draft).toEqual(draft)
  expect((await legacy.table('sessions').get(repo.scope)).draft.commands).toEqual([])
})

it('refuses blind writes to an existing scope and leaves malformed drafts untouched', async () => {
  const db = database(); const seed = new ConcurrentRepository(db); await seed.save(initialDraft(), null, [])
  const fresh = new ConcurrentRepository(db)
  await expect(fresh.save(initialDraft(), null, [])).rejects.toThrow('尚未读取')
  const stored = (await db.drafts.get(seed.scope))!
  await db.drafts.put({ ...stored, draft: { invalid: true } })
  const session = new ConcurrentSession(new ConcurrentRepository(db)); await session.load(); await session.save()
  expect(session.getSnapshot().ready).toBe(false)
  expect((await db.drafts.get(seed.scope))!.draft).toEqual({ invalid: true })
})

it('recovers scopes first saved by a legacy tab after migration without racing its newer edits', async () => {
  const db = database(); await db.open()
  const repo = new ConcurrentRepository(db)
  const draft = initialDraft(); draft.commands = [{ type: 'read', worker: 'A' }]
  await db.sessions.put({ scope: repo.scope, version: 1, draft, activeAttemptId: null })
  expect((await repo.load()).draft).toEqual(draft)
  const newer = { ...draft, commands: [{ type: 'read' as const, worker: 'B' as const }] }
  await db.sessions.put({ scope: repo.scope, version: 1, draft: newer, activeAttemptId: null })
  await expect(repo.save(draft, null, [])).rejects.toThrow('旧版标签页')
  expect(await db.drafts.get(repo.scope)).toBeUndefined()
  expect((await repo.load()).draft).toEqual(newer)
  await repo.save(newer, null, [])
  expect((await db.drafts.get(repo.scope))!.draft).toEqual(newer)
})
