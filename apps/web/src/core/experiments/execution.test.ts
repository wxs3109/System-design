import { describe, expect, it, vi } from 'vitest'
import { ExecutionCoordinator, ModelPreview } from './execution'
import { LabSession } from './session'
import type { ExperimentRepository } from './contracts'

const deferred = <T>() => { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
describe('shared execution ownership', () => {
  it('invalidates replaced, changed and completed executions', () => {
    const gate = new ExecutionCoordinator(); let current = 'a'
    const first = gate.begin(() => current === 'a'); expect(first.isCurrent()).toBe(true)
    current = 'b'; expect(first.isCurrent()).toBe(false); expect(first.owns()).toBe(true)
    const second = gate.begin(); expect(first.signal.aborted).toBe(true)
    first.finish(); expect(second.isCurrent()).toBe(true)
    second.finish(); expect(second.isCurrent()).toBe(false)
  })
  it('reuses validation work for rendering while isolating input mutation', () => {
    const compute = vi.fn((input: { value: number }) => { const value = input.value; input.value = 999; return value * 2 })
    const preview = new ModelPreview(compute); const input = { value: 3 }
    expect(preview.read(input)).toBe(6); expect(input.value).toBe(3)
    expect(preview.read({ value: 3 })).toBe(6); expect(compute).toHaveBeenCalledTimes(1)
    expect(preview.read({ value: 4 })).toBe(8)
    const empty = new ModelPreview<undefined, number>(() => 7); expect(empty.read(undefined)).toBe(7)
  })
  it('rejects late asynchronous lesson results and results for another input', async () => {
    type Draft = { value: number }
    type Attempt = { id: string; createdAt: number; draft: Draft; value: number }
    const save = vi.fn(async () => undefined)
    const repository: ExperimentRepository<Draft, Attempt> = {
      scope: 'async-test', save,
      load: async () => ({ draft: null, attempts: [], activeAttemptId: null, rejected: 0 }),
      contract: { initial: () => ({ value: 1 }), parseDraft: v => v as Draft, runAttempt: d => ({ id: 'sync', createdAt: 1, draft: d, value: d.value }), verifyAttempt: (v): v is Attempt => !!v && (v as Attempt).value === (v as Attempt).draft.value },
    }
    const session = new LabSession(repository); await session.load()
    const pending = deferred<Attempt>(); let signal!: AbortSignal
    const run = session.runAsync((_draft, s) => { signal = s; return pending.promise })
    expect(session.getSnapshot().running).toBe(true)
    session.edit({ value: 2 }); expect(signal.aborted).toBe(true)
    pending.resolve({ id: 'late', createdAt: 1, draft: { value: 1 }, value: 1 })
    expect(await run).toBeUndefined(); expect(session.getSnapshot().attempts).toEqual([])
    await expect(session.runAsync(async () => ({ id: 'wrong', createdAt: 2, draft: { value: 9 }, value: 9 }))).rejects.toThrow('输入不匹配')
    expect(session.getSnapshot().running).toBe(false)
    const result = await session.runAsync(async d => ({ id: 'correct', createdAt: 3, draft: d, value: d.value }))
    result!.draft.value = 44
    expect(session.getSnapshot().attempts[0]!.draft.value).toBe(2)
  })
})
