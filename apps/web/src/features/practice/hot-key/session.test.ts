import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AlgorithmDatabase } from '../../../core/experiments/repository'
import { AlgorithmRepository } from '../distribution/repository'
import { challenge, runAttempt } from '../distribution/lesson'
import { HotRepository, HotSession } from './session'
import { hotChallenge, hotIdentity, runHotAttempt } from './lesson'

const databases: AlgorithmDatabase[] = []
const create = () => { const db = new AlgorithmDatabase(`hot-test-${crypto.randomUUID()}`); databases.push(db); return db }
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(databases.splice(0).map((db) => db.delete())) })
describe('Hot Key lifecycle with shared algorithm storage', () => {
  it('preserves existing hash history and uses separate per-lesson/version pointers', async () => {
    const db = create()
    const hashing = new AlgorithmRepository(db)
    const hot = new HotRepository(db)
    const v2 = new HotRepository(db, 'hot-key:v2')
    const hashAttempt = runAttempt(challenge())
    const hotAttempt = runHotAttempt(hotChallenge('cache'))
    await hashing.save(hashAttempt.draft, hashAttempt.id, [hashAttempt])
    await hot.save(hotAttempt.draft, hotAttempt.id, [hotAttempt])
    await v2.save(hotChallenge('shards'), null, [])
    expect((await hashing.load()).attempts).toEqual([hashAttempt])
    expect((await hot.load()).attempts).toEqual([hotAttempt])
    expect((await v2.load()).draft?.stage).toBe('shards')
    expect((await v2.load()).attempts).toHaveLength(0)
    const input = hotChallenge()
    const write = hot.save(input, null, [])
    input.input.workload.requests[0]!.key = 'mutated-after-save'
    await write
    expect((await hot.load()).draft?.input.workload.requests[0]?.key).not.toBe('mutated-after-save')
  })
  it('keeps immutable attempts through reset, undo, reload and restoration', async () => {
    const repo = new HotRepository(create())
    const session = new HotSession(repo)
    await session.load()
    session.run()
    const attempt = session.getSnapshot().attempts[0]!
    session.edit(hotChallenge('shards'))
    expect(hotIdentity(session.getSnapshot().draft)).not.toBe(hotIdentity(attempt.draft))
    session.undo()
    expect(hotIdentity(session.getSnapshot().draft)).toBe(hotIdentity(attempt.draft))
    session.redo()
    await session.save()
    const restored = new HotSession(repo)
    await restored.load()
    expect(restored.getSnapshot().draft.stage).toBe('shards')
    expect(restored.getSnapshot().undoCount).toBe(0)
    expect(restored.getSnapshot().attempts).toHaveLength(1)
    restored.restoreAttempt(attempt)
    await restored.save()
    expect(restored.getSnapshot().draft.stage).toBe('hotspot')
    await expect(repo.save(attempt.draft, attempt.id, [{ ...attempt, draft: { ...attempt.draft, reflection: 'overwrite' } }])).rejects.toThrow('不能被覆盖')
  })
  it('keeps results in memory on save failure and excludes corrupt saved runs on reload', async () => {
    const repo = new HotRepository(create())
    const session = new HotSession(repo)
    await session.load()
    const fail = vi.spyOn(repo, 'save').mockRejectedValue(new Error('quota'))
    session.run()
    await vi.waitFor(() => expect(session.getSnapshot().storage).toBe('error'))
    expect(session.getSnapshot().attempts).toHaveLength(1)
    fail.mockRestore()
    await session.save()
    const attempt = session.getSnapshot().attempts[0]!
    await repo.database.attempts.put({ id: 'unknown-version', scope: repo.scope, attempt: { ...attempt, id: 'unknown-version', exerciseVersion: 2 } })
    const restored = await repo.load()
    expect(restored.rejected).toBe(1)
    expect(restored.attempts).toHaveLength(1)
    expect(await repo.database.attempts.count()).toBe(2)
  })
})
