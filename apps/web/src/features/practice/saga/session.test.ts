import 'fake-indexeddb/auto'
import { afterEach, expect, it, vi } from 'vitest'
import { AlgorithmDatabase } from '../../../core/experiments/repository'
import { MessageRepository } from '../message-flow/session'
import { SagaRepository, SagaSession } from './session'
import { initialDraft, scenarioCommands } from './lesson'
const databases: AlgorithmDatabase[] = []
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(databases.splice(0).map((db) => db.delete())) })
it('recovers from an uncheckpointed compensation effect and saves immutable attempts after a storage failure', async () => {
  const db = new AlgorithmDatabase(`saga-test-${crypto.randomUUID()}`); databases.push(db)
  const repo = new SagaRepository(db); const session = new SagaSession(repo); await session.load()
  const d = initialDraft(); d.config.recovery = 'saga'; d.scenario = 'coordinator-crash'
  const guide = scenarioCommands(d.config, d.scenario); const crash = guide.findIndex((c) => c.type === 'crash'); d.commands = guide.slice(0, crash)
  session.edit(d); await session.save()
  const restored = new SagaSession(repo); await restored.load()
  expect(restored.getSnapshot().draft.commands).toEqual(d.commands)
  const fail = vi.spyOn(repo, 'save').mockRejectedValue(new Error('quota'))
  restored.run(); await vi.waitFor(() => expect(restored.getSnapshot().storage).toBe('error'))
  expect(restored.getSnapshot().attempts[0]!.result.journal.cleanup).toBeUndefined()
  expect(restored.getSnapshot().attempts[0]!.result.resource.artifacts).toBe(0)
  fail.mockRestore(); await restored.save()
  const a = restored.getSnapshot().attempts[0]!
  await expect(repo.save(a.draft, a.id, [{ ...a, draft: { ...a.draft, reflection: 'changed' } }])).rejects.toThrow('不能被覆盖')
  expect((await new MessageRepository('transactional-outbox', db).load()).attempts).toHaveLength(0)
  await db.attempts.add({ id: 'future', scope: repo.scope, attempt: { ...a, id: 'future', exerciseVersion: 7 } })
  expect((await repo.load()).rejected).toBe(1)
  expect(await db.attempts.get('future')).toBeDefined()
})
