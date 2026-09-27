import { describe, expect, it, vi } from 'vitest'
import { LabSession } from './session'
import type { ExperimentRepository, LabContract } from './contracts'

type Draft = { value: number }
type Attempt = { id: string; createdAt: number; draft: Draft; result: number }
const contract: LabContract<Draft, Attempt> = {
  initial: () => ({ value: 1 }),
  parseDraft: (value) => { const draft = value as Draft; if (!Number.isFinite(draft?.value)) throw new Error('invalid'); return { value: draft.value } },
  runAttempt: (draft) => ({ id: crypto.randomUUID(), createdAt: Date.now(), draft: { ...draft }, result: draft.value * 2 }),
  verifyAttempt: (value): value is Attempt => { const a = value as Attempt; return !!a && a.result === a.draft.value * 2 },
}
function memoryRepository(): ExperimentRepository<Draft, Attempt> {
  let draft: Draft | null = null; let activeAttemptId: string | null = null; const attempts: Attempt[] = []
  return {
    scope: 'memory-test', contract,
    load: async () => structuredClone({ draft, activeAttemptId, attempts, rejected: 0 }),
    save: async (next, id, pending) => { draft = structuredClone(next); activeAttemptId = id; for (const a of pending) if (!attempts.some((prior) => prior.id === a.id)) attempts.push(structuredClone(a)) },
  }
}
describe('storage-independent experiment sessions', () => {
  it('flushes a burst of edits once without dropping evidence or saving it repeatedly', async () => {
    const repository = memoryRepository(); const save = vi.spyOn(repository, 'save')
    const session = new LabSession(repository); await session.load()
    session.run()
    const attempt = structuredClone(session.getSnapshot().attempts[0]!)
    for (let value = 2; value < 22; value++) session.edit({ value })
    session.undo(); session.redo()
    await session.save()
    expect(save).toHaveBeenCalledTimes(1)
    const restored = new LabSession(repository); await restored.load()
    expect(restored.getSnapshot()).toMatchObject({ draft: { value: 21 }, attempts: [attempt], activeAttemptId: attempt.id })
  })
  it('drops a scheduled unsaved edit when explicitly reloading the saved revision', async () => {
    const repository = memoryRepository(); await repository.save({ value: 4 }, null, [])
    const session = new LabSession(repository); await session.load()
    session.edit({ value: 99 }); await session.reload()
    expect(session.getSnapshot()).toMatchObject({ draft: { value: 4 }, storage: 'saved' })
    expect((await repository.load()).draft).toEqual({ value: 4 })
  })
  it('edits, executes, undoes and restores through a storage port without IndexedDB', async () => {
    const repository = memoryRepository(); const session = new LabSession(repository)
    await session.load(); session.edit({ value: 4 }); session.run(); await session.save()
    const attempt = structuredClone(session.getSnapshot().attempts[0]!)
    session.edit({ value: 8 }); session.undo()
    expect(session.getSnapshot().draft.value).toBe(4)
    session.redo(); expect(session.getSnapshot().draft.value).toBe(8)
    session.restoreAttempt(attempt); await session.save()
    const restored = new LabSession(repository); await restored.load()
    expect(restored.getSnapshot().draft.value).toBe(4)
    expect(restored.getSnapshot().attempts[0]).toEqual(attempt)
  })
  it('keeps editing disabled after a storage-port read failure', async () => {
    const repository = memoryRepository(); repository.load = async () => { throw new Error('unavailable') }
    const session = new LabSession(repository); await session.load(); session.edit({ value: 99 }); session.run()
    expect(session.getSnapshot()).toMatchObject({ ready: false, draft: { value: 1 }, attempts: [], errorKind: 'load' })
  })
})
