import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { challenge, experimentIdentity, runAttempt } from './lesson'
import { AlgorithmDatabase, AlgorithmRepository } from './repository'
import { AlgorithmSession } from './session'

const databases: AlgorithmDatabase[] = []
function repository(scope = 'consistent-hashing:v1') {
  const database = new AlgorithmDatabase(`algorithm-test-${crypto.randomUUID()}`)
  databases.push(database)
  return new AlgorithmRepository(database, scope)
}
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(databases.splice(0).map((database) => database.delete()))
})
describe('algorithm persistence isolation and validation', () => {
  it('stores immutable inputs and attempts in separate version scopes', async () => {
    const first = repository()
    const second = new AlgorithmRepository(first.database, 'consistent-hashing:v2')
    const draft = challenge()
    const attempt = runAttempt(draft)
    await first.save(draft, attempt.id, [attempt])
    await second.save(challenge('remove'), null, [])
    draft.input.nodes.pop()
    expect((await first.load()).draft?.input.nodes).toHaveLength(4)
    expect((await second.load()).draft?.mode).toBe('remove')
    expect((await first.load()).attempts).toHaveLength(1)
    expect((await second.load()).attempts).toHaveLength(0)
    const editedAttempt = structuredClone(attempt)
    editedAttempt.draft.reflection = 'do not overwrite'
    await expect(first.save(draft, attempt.id, [editedAttempt])).rejects.toThrow('不能被覆盖')
    expect((await first.load()).attempts[0]?.draft.reflection).toBe('')
  })
  it('retains but excludes unknown/corrupted attempts instead of reinterpreting them', async () => {
    const repo = repository()
    const attempt = runAttempt(challenge())
    await repo.save(attempt.draft, attempt.id, [attempt])
    const bad = { ...attempt, id: 'unknown', exerciseVersion: 900 }
    await repo.database.attempts.put({ id: 'unknown', scope: repo.scope, attempt: bad as unknown as typeof attempt })
    const restored = await repo.load()
    expect(restored.rejected).toBe(1)
    expect(restored.attempts).toHaveLength(1)
    expect(await repo.database.attempts.count()).toBe(2)
    await repo.database.drafts.put({ scope: repo.scope, version: 9, draft: attempt.draft, activeAttemptId: null } as never)
    await expect(repo.load()).rejects.toThrow('版本未知')
  })
  it('serializes snapshots and waits for queued writes when another instance restores', async () => {
    const repo = repository()
    const draft = challenge('explore')
    const first = repo.save(draft, null, [])
    draft.input.nodes.push('new')
    const second = repo.save(draft, null, [])
    const nextRepo = new AlgorithmRepository(repo.database)
    const restored = await nextRepo.load()
    await Promise.all([first, second])
    expect(restored.draft?.input.nodes).toContain('new')
  })
})
describe('algorithm session lifecycle', () => {
  it('isolates undo, retains attempt history across reset, and restores draft/baseline/current result', async () => {
    const repo = repository()
    const session = new AlgorithmSession(repo)
    await session.load()
    const original = session.getSnapshot().draft
    session.edit({ ...original, prediction: 'uncertain', input: { ...original.input, nodes: [...original.input.nodes, 'node-e'] } })
    session.run()
    const current = session.getSnapshot().draft
    const resultId = session.getSnapshot().activeAttemptId
    session.edit(challenge('remove'))
    session.undo()
    expect(session.getSnapshot().draft).toEqual(current)
    expect(session.getSnapshot().activeAttemptId).toBe(resultId)
    session.redo()
    expect(session.getSnapshot().draft.mode).toBe('remove')
    expect(session.getSnapshot().attempts).toHaveLength(1)
    await session.save()
    const restored = new AlgorithmSession(new AlgorithmRepository(repo.database))
    await restored.load()
    expect(restored.getSnapshot().draft.mode).toBe('remove')
    expect(restored.getSnapshot().attempts).toHaveLength(1)
    expect(restored.getSnapshot().undoCount).toBe(0)
    expect(session.getSnapshot().undoCount).toBeGreaterThan(0)
    restored.restoreAttempt(restored.getSnapshot().attempts[0]!)
    expect(experimentIdentity(restored.getSnapshot().draft)).toBe(experimentIdentity(current))
    await restored.save()
  })
  it('keeps failures visible and results in memory, then retries without duplicates', async () => {
    const repo = repository()
    const session = new AlgorithmSession(repo)
    await session.load()
    const failure = vi.spyOn(repo, 'save').mockRejectedValue(new Error('Quota exceeded'))
    session.run()
    await vi.waitFor(() => expect(session.getSnapshot().storage).toBe('error'))
    expect(session.getSnapshot().attempts).toHaveLength(1)
    expect(session.getSnapshot().error).toBe('Quota exceeded')
    failure.mockRestore()
    await session.save()
    expect(session.getSnapshot().storage).toBe('saved')
    expect((await repo.load()).attempts).toHaveLength(1)
    await session.save()
    expect((await repo.load()).attempts).toHaveLength(1)
  })
  it('does not let a delayed save overwrite newer status or a newer semantic edit', async () => {
    const repo = repository()
    const session = new AlgorithmSession(repo)
    await session.load()
    let rejectOld: (error: Error) => void = () => undefined
    const oldSave = new Promise<void>((_, reject) => { rejectOld = reject })
    const saves = vi.spyOn(repo, 'save').mockReturnValueOnce(oldSave).mockResolvedValueOnce(undefined)
    session.run()
    const original = session.getSnapshot().draft
    session.edit({ ...original, input: { ...original.input, nodes: [...original.input.nodes, 'new'] } })
    await vi.waitFor(() => expect(session.getSnapshot().storage).toBe('saved'))
    rejectOld(new Error('old failure'))
    await oldSave.catch(() => undefined)
    expect(session.getSnapshot().storage).toBe('saved')
    expect(session.getSnapshot().draft.input.nodes).toContain('new')
    expect(experimentIdentity(session.getSnapshot().draft)).not.toBe(experimentIdentity(session.getSnapshot().attempts[0]!.draft))
    saves.mockRestore()
  })
})
