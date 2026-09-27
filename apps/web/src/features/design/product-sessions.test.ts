import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { AlgorithmDatabase } from '../../core/experiments/repository'
import { productDesigns } from './product-catalog'
import { productLesson } from './product-lesson'

describe('product design session contracts', () => {
  for (const design of productDesigns) it(`round-trips immutable ${design.id} evidence and rejects stale writers`, async () => {
    const db = new AlgorithmDatabase(`product-test-${crypto.randomUUID()}`)
    try {
      const lesson = productLesson(design)
      const scenario = design.scenarios[0]!
      const alternative = design.alternatives.find((a) => scenario.check(design.run(a.config, scenario.script)).every((c) => c.pass))!
      expect(alternative).toBeDefined()
      const first = lesson.session(db); const stale = lesson.session(db)
      await first.load(); await stale.load()
      first.edit({ ...lesson.initial(), config: { ...alternative.config }, commands: [...scenario.script] })
      first.run(); await first.save()
      const saved = first.getSnapshot().attempts[0]!
      expect(saved.evaluation.task).toBe(true)
      stale.edit({ ...lesson.initial(), reflection: 'stale writer' }); await stale.save()
      expect(stale.getSnapshot().errorKind).toBe('conflict')
      const restored = lesson.session(db); await restored.load()
      expect(restored.getSnapshot().attempts[0]).toEqual(saved)
      restored.edit({ ...restored.getSnapshot().draft, commands: [] }); await restored.save()
      expect(restored.getSnapshot().attempts[0]).toEqual(saved)
      expect(restored.getSnapshot().draft.commands).toEqual([])
    } finally { db.close(); await db.delete() }
  })
})
