import { describe, expect, it } from 'vitest'
import { objectStorageDesign, runObjectStorage } from './object-storage'
import { ObjectReplicas } from './object-replicas'
import { productLesson } from './product-lesson'

describe('object storage product model', () => {
  const safe = objectStorageDesign.alternatives[0]!.config
  for (const scenario of objectStorageDesign.scenarios) {
    it(`rejects the faulty baseline and accepts actual evidence for ${scenario.id}`, () => {
      expect(scenario.check(runObjectStorage(objectStorageDesign.initialConfig, scenario.script)).some((c) => !c.pass)).toBe(true)
      for (const alternative of objectStorageDesign.alternatives) {
        const result = runObjectStorage(alternative.config, scenario.script)
        expect(scenario.check(result), JSON.stringify(result)).toSatisfy((checks: { pass: boolean }[]) => checks.every((c) => c.pass))
      }
    })
  }
  it('does not fabricate bytes after every physical copy has been lost', () => {
    const store = new ObjectReplicas()
    expect(store.write('k', 'actual bytes', 1)).toBe(true)
    store.lose('A'); store.recover('A')
    expect(store.read('k')).toBeUndefined()
    expect(store.repair('k', 2)).toBe(false)
    expect(store.copies('k')).toBe(0)
    store.lose('B')
    expect(store.write('other', 'data', 3)).toBe(false)
    expect(store.read('other')).toBeUndefined()
  })
  it('retransmits a part without creating an extra part and rejects missing manifests', () => {
    const partial = runObjectStorage(safe, ['begin', 'part1', 'part1', 'complete', 'get'])
    expect(partial.metrics).toMatchObject({ versions: 0, rejected: 1, lastCorrect: 0 })
    expect(Object.keys(partial.state.uploads[0]!.parts)).toHaveLength(1)
    const complete = runObjectStorage(safe, ['begin', 'part1', 'part1', 'part2', 'complete', 'part2-corrupt', 'get'])
    expect(complete.metrics).toMatchObject({ versions: 1, lastCorrect: 1, corruptParts: 0 })
  })
  it('pinning the newest version does not demonstrate old-version preservation', () => {
    const scenario = objectStorageDesign.scenarios.find((s) => s.id === 'version')!
    const result = runObjectStorage(safe, ['begin', 'part1', 'part2', 'complete', 'begin-overwrite', 'part1', 'part2', 'complete', 'pin', 'read-pinned', 'get'])
    expect(result.metrics.pinnedCorrect).toBe(1)
    expect(scenario.check(result).some((c) => !c.pass)).toBe(true)
  })
  it('requires actual byte and manifest evidence when restoring attempts', () => {
    const lesson = productLesson(objectStorageDesign)
    const attempt = lesson.runAttempt({ ...lesson.initial(), config: safe, commands: [...objectStorageDesign.scenarios[0]!.script] })
    expect(lesson.verifyAttempt(attempt)).toBe(true)
    const state = attempt.result.state as ReturnType<typeof runObjectStorage>['state']
    state.versions = []
    expect(lesson.verifyAttempt(attempt)).toBe(false)
  })
})
