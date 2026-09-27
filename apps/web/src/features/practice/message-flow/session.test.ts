import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AlgorithmDatabase } from '../../../core/experiments/repository'
import { RetryRepository } from '../retry-idempotency/session'
import { MessageRepository, MessageSession } from './session'
import { initialDraft, runAttempt, scenarioCommands } from './lesson'

const databases: AlgorithmDatabase[] = []
const database = () => { const db = new AlgorithmDatabase(`message-test-${crypto.randomUUID()}`); databases.push(db); return db }
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(databases.splice(0).map((db) => db.delete())) })
describe('message experiment storage and isolation', () => {
  it('keeps ACK, Outbox and request-retry scopes independent', async () => {
    const db = database()
    const ack = new MessageRepository('ack-checkpoint', db)
    const outbox = new MessageRepository('transactional-outbox', db)
    const retry = new RetryRepository(db)
    await retry.save(retry.contract.initial(), null, [])
    for (const repo of [ack, outbox]) {
      const draft = repo.contract.initial()
      draft.commands = scenarioCommands(draft.config, draft.scenario as 'before-effect' | 'commit-gap')
      const attempt = repo.contract.runAttempt(draft)
      await repo.save(draft, attempt.id, [attempt])
    }
    expect((await ack.load()).draft?.labId).toBe('ack-checkpoint')
    expect((await outbox.load()).draft?.labId).toBe('transactional-outbox')
    expect((await ack.load()).attempts).toHaveLength(1)
    expect((await retry.load()).attempts).toHaveLength(0)
  })
  it('restores intermediate packets, undo and immutable completed records', async () => {
    const repo = new MessageRepository('ack-checkpoint', database())
    const session = new MessageSession('ack-checkpoint', repo)
    await session.load()
    const draft = initialDraft('ack-checkpoint')
    draft.commands = [{ type: 'create-task' }, { type: 'publish', taskId: 'task-1' }]
    session.edit(draft); await session.save()
    const restored = new MessageSession('ack-checkpoint', repo)
    await restored.load()
    expect(restored.getSnapshot().draft.commands).toEqual(draft.commands)
    restored.edit({ ...draft, commands: [...draft.commands, { type: 'accept-publication', publicationId: 'publication-1' }] })
    restored.run(); restored.undo()
    expect(restored.getSnapshot().draft.commands).toHaveLength(2)
    restored.redo(); await restored.save()
    expect(restored.getSnapshot().attempts).toHaveLength(1)
    const attempt = restored.getSnapshot().attempts[0]!
    await expect(repo.save(attempt.draft, attempt.id, [{ ...attempt, draft: { ...attempt.draft, reflection: 'changed' } }])).rejects.toThrow('不能被覆盖')
  })
  it('retains failed writes for retry and ignores unknown record versions', async () => {
    const repo = new MessageRepository('transactional-outbox', database())
    const session = new MessageSession('transactional-outbox', repo)
    await session.load()
    const fail = vi.spyOn(repo, 'save').mockRejectedValue(new Error('quota'))
    session.run()
    await vi.waitFor(() => expect(session.getSnapshot().storage).toBe('error'))
    expect(session.getSnapshot().attempts).toHaveLength(1)
    fail.mockRestore(); await session.save()
    const record = runAttempt(initialDraft('transactional-outbox'), 'transactional-outbox')
    await repo.database.attempts.add({ id: 'unknown', scope: repo.scope, attempt: { ...record, id: 'unknown', exerciseVersion: 9 } })
    expect((await repo.load()).rejected).toBe(1)
    expect((await repo.load()).attempts).toHaveLength(1)
  })
})
