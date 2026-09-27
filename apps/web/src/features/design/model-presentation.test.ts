import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { productDesigns } from './product-catalog'
import { legacyDesigns, legacyEvaluation, verifyLegacyProductAttempt, type LegacyProductAttempt } from './compat/v1/attempt'
import { compatibleProductAttempt, productLesson } from './product-lesson'
import { AlgorithmDatabase } from '../../core/experiments/repository'

describe('semantic evidence and presentation compatibility', () => {
  for (const design of productDesigns) {
    const legacy = legacyDesigns.find(d => d.id === design.id)!
    it(`${design.id} preserves model behavior and projections across scenarios and arbitrary command interleavings`, () => {
      const sequences: readonly string[][] = [...design.scenarios.map(s => [...s.script]), ...Array.from({ length: 12 }, (_, seed) => {
        let state = seed + 1; const actions = Object.keys(design.actions)
        return Array.from({ length: 24 }, () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return actions[state % actions.length]! })
      })]
      for (const config of [design.initialConfig, ...design.alternatives.map(a => a.config)]) for (const commands of sequences) {
        const expected = legacy.run(config, commands); const actual = design.run(config, commands)
        expect(actual.metrics).toEqual(expected.metrics)
        expect(design.present(actual)).toEqual({ events: expected.events, tables: expected.tables, ...(expected.diagrams ? { diagrams: expected.diagrams } : {}) })
        expect(JSON.parse(JSON.stringify(actual))).toEqual(actual)
        expect(actual).not.toHaveProperty('tables')
        expect(actual).not.toHaveProperty('diagrams')
        expect(actual.events.every(e => !('detail' in e))).toBe(true)
      }
    })
    it(`${design.id} keeps original v1 browser records and progress while new attempts use semantic format v2`, async () => {
      const db = new AlgorithmDatabase(`product-compat-${crypto.randomUUID()}`)
      try {
        const lesson = productLesson(design)
        const draft = { ...lesson.initial(), config: { ...legacy.alternatives[0]!.config }, commands: [...legacy.scenarios[0]!.script] }
        const result = legacy.run(draft.config, draft.commands)
        const old: LegacyProductAttempt = { id: 'original-attempt', createdAt: 100, exerciseId: design.id, exerciseVersion: 1, draft, result, evaluation: legacyEvaluation(design.id, draft, result) }
        expect(verifyLegacyProductAttempt(design.id, old)).toBe(true)
        await db.drafts.put({ scope: `${design.id}:v1`, version: 1, draft, activeAttemptId: old.id })
        await db.attempts.add({ id: old.id, scope: `${design.id}:v1`, attempt: old })
        const session = lesson.session(db); await session.load()
        expect(session.getSnapshot().attempts).toEqual([old])
        expect(compatibleProductAttempt(design, old)).toBe(true)
        session.run(); await session.save()
        expect(session.getSnapshot().attempts[0]).toHaveProperty('formatVersion', 2)
        expect((await db.attempts.get(old.id))?.attempt).toEqual(old)
      } finally { db.close(); await db.delete() }
    })
  }
  it('changing captions, layout and explanation wording cannot change semantic verification', () => {
    const original = productDesigns.find(d => d.id === 'design-maps')!
    const lesson = productLesson(original)
    const attempt = lesson.runAttempt({ ...lesson.initial(), config: original.alternatives[0]!.config, commands: [...original.scenarios[0]!.script] })
    const changed = { ...original, present: () => ({ tables: [], events: [], diagrams: [] }), scenarios: original.scenarios.map(s => ({ ...s, check: (r: typeof attempt.result) => s.check(r).map(c => ({ ...c, label: 'New translation', detail: 'New explanatory prose' })) })) }
    expect(productLesson(changed).verifyAttempt(attempt)).toBe(true)
    const incompatible = { ...original, versions: { ...original.versions, assessment: 2 } }
    expect(productLesson(incompatible).verifyAttempt(attempt)).toBe(false)
    expect(compatibleProductAttempt(incompatible, attempt)).toBe(false)
  })
})
