import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { AlgorithmDatabase, LabRepository } from './repository'
import { LabSession } from './session'
import type { LabContract } from './contracts'
import { sameAssessment, sameTimelineEvidence, timelineEvidence } from './timeline-evidence'
import { initialDraft, runAttempt, verifyAttempt } from '../../features/practice/retry-idempotency/lesson'

type Draft = { amount: number; note: string }
type Attempt = { id: string; createdAt: number; draft: Draft }
const current: LabContract<Draft, Attempt> = {
  versions: { model: 'test-v2', definition: 2, assessment: 1 }, draftVersion: 2,
  draftMigrations: { 1: value => { const old = value as { count: number; note: string }; return { amount: old.count, note: old.note } } },
  initial: () => ({ amount: 0, note: '' }),
  parseDraft: value => { const d = value as Draft; if (!Number.isFinite(d.amount) || typeof d.note !== 'string') throw new Error('invalid'); return { ...d } },
  runAttempt: draft => ({ id: crypto.randomUUID(), createdAt: Date.now(), draft }),
  verifyAttempt: (value): value is Attempt => !!value && typeof value === 'object' && 'draft' in value && 'amount' in (value.draft as object),
}
describe('versioned drafts and retained evidence', () => {
  it('migrates only through declared steps, preserves the old draft, and retains unsupported attempts for export', async () => {
    const db = new AlgorithmDatabase(`migration-${crypto.randomUUID()}`)
    try {
      const original = { scope: 'test', version: 1 as const, revision: 4, draft: { count: 7, note: 'keep my reasoning' }, activeAttemptId: 'unsupported' }
      const unsupported = { id: 'unsupported', scope: 'test', attempt: { id: 'unsupported', formatVersion: 91, evidence: ['original'] } }
      await db.drafts.put(original); await db.attempts.put(unsupported)
      const session = new LabSession(new LabRepository(db, 'test', current)); await session.load()
      expect(session.getSnapshot()).toMatchObject({ ready: true, draft: { amount: 7, note: 'keep my reasoning' }, rejected: 1 })
      expect(await db.drafts.get('test')).toEqual(original)
      expect(session.recoverySnapshot().retained).toEqual([unsupported])
      session.edit({ amount: 9, note: 'keep my reasoning' }); await session.save()
      const migrated = (await db.drafts.get('test'))!
      expect(migrated).toMatchObject({ version: 2, draftVersion: 2, versions: current.versions, draft: { amount: 9 } })
      expect(migrated.draftBackups).toEqual([{ draftVersion: 1, versions: null, draft: original.draft, revision: 4 }])
      expect(await db.attempts.get('unsupported')).toEqual(unsupported)
      await session.save(); expect((await db.drafts.get('test'))!.draftBackups).toHaveLength(1)
    } finally { db.close(); await db.delete() }
  })
  it('blocks absent migrations, future formats and model changes without a schema migration', async () => {
    const db = new AlgorithmDatabase(`unknown-${crypto.randomUUID()}`)
    try {
      const fixtures = [
        { version: 2, draftVersion: 3, draft: { amount: 7, note: 'future' }, versions: current.versions },
        { version: 2, draftVersion: 2, draft: { amount: 7, note: 'new model' }, versions: { ...current.versions!, model: 'test-v3' } },
        { version: 99, draftVersion: 2, draft: { amount: 7, note: 'unknown record' }, versions: current.versions },
        { version: 1, draft: { count: 7, note: 'no migration' } },
      ]
      for (const [index, value] of fixtures.entries()) {
        const scope = `test-${index}`; const original = { ...value, scope, activeAttemptId: null }
        await db.drafts.put(original as never)
        const session = new LabSession(new LabRepository(db, scope, { ...current, draftMigrations: {} })); await session.load()
        session.edit({ amount: 0, note: '' }); session.run(); await session.save()
        expect(session.getSnapshot()).toMatchObject({ ready: false, errorKind: 'load' })
        expect(await db.drafts.get(scope)).toEqual(original)
        expect(session.recoverySnapshot().persistedSource).toMatchObject({ loaded: { session: original } })
      }
    } finally { db.close(); await db.delete() }
  })
  it('retains a prior assessment version instead of silently grading it as current', async () => {
    const db = new AlgorithmDatabase(`old-grade-${crypto.randomUUID()}`)
    try {
      const original = { id: 'old-grade', scope: 'test', storageVersion: 2 as const, versions: { ...current.versions!, assessment: 1 }, attempt: { id: 'old-grade', createdAt: 1, draft: { amount: 2, note: '' } } }
      await db.attempts.put(original)
      const repo = new LabRepository(db, 'test', { ...current, versions: { ...current.versions!, assessment: 2 } })
      const loaded = await repo.load()
      expect(loaded.attempts).toEqual([]); expect(loaded.retained).toEqual([original])
      await repo.save(current.initial(), null, [])
      expect(await db.attempts.get(original.id)).toEqual(original)
    } finally { db.close(); await db.delete() }
  })
  it('keeps protocol captions outside verification without dropping payloads, causal identity or verdict flags', () => {
    const original = { events: [{ index: 1, at: 5, kind: 'received', from: 'A', to: 'B', subject: 'm1', detail: 'caption' }], messages: [{ payload: { detail: 'business data' } }] }
    const translated = structuredClone(original); translated.events[0]!.detail = 'another language'
    expect(sameTimelineEvidence(original, translated)).toBe(true)
    translated.messages[0]!.payload.detail = 'different business data'
    expect(sameTimelineEvidence(original, translated)).toBe(false)
    const changed = structuredClone(original); changed.events[0]!.at = 6
    expect(sameTimelineEvidence(original, changed)).toBe(false)
    expect(sameAssessment({ task: true, messages: ['old'] }, { task: true, messages: ['new'] })).toBe(true)
    expect(sameAssessment({ task: true, messages: [] }, { task: false, messages: [] })).toBe(false)
    expect(timelineEvidence({ error: 'bad archive', violations: ['rule A'], data: 3 }, { text: ['error'], counted: ['violations'] })).toEqual({ error: true, violations: { count: 1 }, data: 3 })
  })
  it('verifies existing protocol attempts after a caption edit but rejects a changed business effect', () => {
    const a = runAttempt({ ...initialDraft(), commands: [{ type: 'submit' }] })
    a.result.events[0]!.detail = 'presentation-only edit'; a.evaluation.messages = ['new explanatory text']
    expect(verifyAttempt(a)).toBe(true)
    a.result.requests[0]!.payload.videoId = 'tampered'
    expect(verifyAttempt(a)).toBe(false)
  })
})
