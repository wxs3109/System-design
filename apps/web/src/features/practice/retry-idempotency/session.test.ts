import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AlgorithmDatabase } from '../../../core/experiments/repository'
import { AlgorithmRepository } from '../distribution/repository'
import { initialDraft, runAttempt, scenarioCommands } from './lesson'
import { RetryRepository, RetrySession } from './session'

const databases: AlgorithmDatabase[] = []
const database = () => { const value = new AlgorithmDatabase(`retry-test-${crypto.randomUUID()}`); databases.push(value); return value }
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(databases.splice(0).map((value) => value.delete())) })
describe('protocol experiment persistence', () => {
  it('restores the exact operation sequence, supports undo and retains immutable attempts', async () => {
    const repository = new RetryRepository(database())
    const session = new RetrySession(repository)
    await session.load()
    const draft = initialDraft()
    draft.commands = [{ type: 'submit' }, { type: 'deliver-request', requestId: 'request-1' }]
    session.edit(draft)
    await session.save()
    const restored = new RetrySession(repository)
    await restored.load()
    expect(restored.getSnapshot().draft.commands).toEqual(draft.commands)
    expect(restored.getSnapshot().undoCount).toBe(0)
    restored.edit({ ...draft, commands: [...draft.commands, { type: 'commit', requestId: 'request-1' }] })
    restored.run()
    restored.edit(initialDraft())
    restored.undo()
    expect(restored.getSnapshot().draft.commands).toHaveLength(3)
    restored.redo()
    expect(restored.getSnapshot().draft.commands).toHaveLength(0)
    expect(restored.getSnapshot().attempts).toHaveLength(1)
    restored.restoreAttempt(restored.getSnapshot().attempts[0]!)
    await restored.save()
    expect((await repository.load()).draft?.commands).toHaveLength(3)
  })
  it('isolates the protocol scope from existing hash scopes and preserves unknown records', async () => {
    const db = database()
    const repository = new RetryRepository(db)
    const hash = new AlgorithmRepository(db)
    const hashDraft = hash.contract.initial()
    await hash.save(hashDraft, null, [])
    const draft = initialDraft()
    draft.commands = scenarioCommands(draft.config, 'response-lost')
    const attempt = runAttempt(draft)
    await repository.save(draft, attempt.id, [attempt])
    expect((await hash.load()).draft).toEqual(hashDraft)
    expect((await hash.load()).attempts).toHaveLength(0)
    const changed = structuredClone(attempt)
    changed.draft.reflection = 'overwrite'
    await expect(repository.save(draft, attempt.id, [changed])).rejects.toThrow('不能被覆盖')
    await db.attempts.put({ id: 'future', scope: repository.scope, attempt: { ...attempt, id: 'future', exerciseVersion: 2 } })
    expect((await repository.load()).rejected).toBe(1)
    expect(await db.attempts.count()).toBe(2)
  })
  it('keeps a computed result in memory on quota failure and retries without duplication', async () => {
    const repository = new RetryRepository(database())
    const session = new RetrySession(repository)
    await session.load()
    const fail = vi.spyOn(repository, 'save').mockRejectedValue(new Error('quota'))
    const draft = initialDraft()
    draft.commands = scenarioCommands(draft.config, 'response-lost')
    session.edit(draft)
    session.run()
    await vi.waitFor(() => expect(session.getSnapshot().storage).toBe('error'))
    expect(session.getSnapshot().attempts[0]!.result.store.tasks).toHaveLength(2)
    fail.mockRestore()
    await session.save()
    expect((await repository.load()).attempts).toHaveLength(1)
    await session.save()
    expect((await repository.load()).attempts).toHaveLength(1)
  })
})
