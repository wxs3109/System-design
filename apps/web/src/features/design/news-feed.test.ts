import { describe, expect, it } from 'vitest'
import { newsFeedDesign, runNewsFeed } from './news-feed'
import { productLesson } from './product-lesson'

describe('News Feed product model', () => {
  const safe = newsFeedDesign.alternatives[1]!.config
  for (const scenario of newsFeedDesign.scenarios) {
    it(`executes ${scenario.id} with both hybrid and pull alternatives`, () => {
      for (const config of [safe, newsFeedDesign.alternatives[2]!.config]) {
        const result = runNewsFeed(config, scenario.script)
        expect(scenario.check(result), JSON.stringify(result)).toSatisfy((checks: { pass: boolean }[]) => checks.every((c) => c.pass))
        expect(result.events).toHaveLength(scenario.script.length)
      }
    })
    it(`exposes the default design failure in ${scenario.id}`, () => {
      const result = runNewsFeed(newsFeedDesign.initialConfig, scenario.script)
      expect(scenario.check(result).some((c) => !c.pass)).toBe(true)
    })
  }
  it('counts real fan-out writes, preserves partial delivery and does not shortcut celebrity work', () => {
    const partial = runNewsFeed({ ...safe, strategy: 'push' }, ['publish-celebrity', 'relay', 'deliver'])
    expect(partial.metrics.fanoutWrites).toBe(4)
    expect(partial.metrics.pending).toBe(8)
    const complete = runNewsFeed({ ...safe, strategy: 'push' }, ['publish-celebrity', 'relay', 'deliver', 'drain'])
    expect(complete.metrics.fanoutWrites).toBe(12)
    expect(complete.metrics.pending).toBe(0)
  })
  it('deduplicates the same post while preserving distinct business publications', () => {
    const result = runNewsFeed(safe, ['publish-friend', 'publish-friend', 'relay', 'drain', 'redeliver', 'drain', 'read'])
    expect(result.metrics).toMatchObject({ posts: 2, fanoutWrites: 4, duplicateSkips: 2, correctRead: 1 })
    expect(result.tables.at(-1)!.rows[0]).toEqual(['u1', 'p2, p1', 'p2, p1'])
  })
  it('checks current reads rather than forgiving stale deleted content', () => {
    const result = runNewsFeed({ ...safe, hydrate: 'timeline' }, ['publish-friend', 'relay', 'drain', 'delete-friend', 'read'])
    expect(result.metrics.correctRead).toBe(0)
    expect(result.tables.at(-1)!.rows[0]).toEqual(['u1', 'p1', '空'])
  })
  it('requires actual scenario evidence and detects altered saved results or invalid configs', () => {
    const lesson = productLesson(newsFeedDesign)
    const draft = { ...lesson.initial(), config: safe }
    expect(lesson.runAttempt(draft).evaluation.task).toBe(false)
    draft.commands = [...newsFeedDesign.scenarios[0]!.script]
    const attempt = lesson.runAttempt(draft)
    expect(lesson.verifyAttempt(attempt)).toBe(true)
    attempt.result.metrics.fanoutWrites = 0
    expect(lesson.verifyAttempt(attempt)).toBe(false)
    expect(() => lesson.parseDraft({ ...draft, config: { ...safe, strategy: 'magical' } })).toThrow()
    expect(() => lesson.parseDraft({ ...draft, commands: Array(121).fill('read') })).toThrow()
    expect(() => lesson.parseDraft({ ...draft, commands: ['__proto__'] })).toThrow()
  })
})
