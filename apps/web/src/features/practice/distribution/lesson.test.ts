import { describe, expect, it } from 'vitest'
import { challenge, evaluate, experimentIdentity, learningProgress, runAttempt, verifyAttempt, type Draft, type Mode } from './lesson'
import { compare, distribute, methods, type Method } from './model'

export function solved(mode: Mode = 'add', method: Method = 'ring'): Draft {
  const draft = challenge(mode, method)
  draft.prediction = 'spread' // Initial prediction may be wrong.
  draft.input.nodes = mode === 'add' ? [...draft.input.nodes, 'node-e'] : draft.input.nodes.filter((id) => id !== 'node-c')
  const before = distribute(draft.baseline!)
  const after = distribute(draft.input)
  const changes = compare(before, after)!
  const moved = after.assignments.filter((item) => before.assignments.find((old) => old.key === item.key)?.owner !== item.owner)
  draft.movedKey = moved[0]!.key
  draft.movedCount = String(changes.remapped)
  draft.locality = changes.transfers.every((item) => item.from === item.to || (mode === 'add' ? item.to === 'node-e' : item.from === 'node-c')) ? 'local' : 'spread'
  draft.balance = 'separate'
  return draft
}
describe('hashing lesson evidence and transfer', () => {
  it.each(methods)('accepts a corrected prediction with real %s evidence', (method) => {
    const attempt = runAttempt(solved('add', method))
    expect(attempt.evaluation).toMatchObject({ evidence: true, task: true, explanation: true })
    expect(verifyAttempt(attempt)).toBe(true)
  })
  it('does not pass from selecting a V value, copying old answers or naming an unchanged key', () => {
    expect(runAttempt(challenge('add', 'vnodes', 128)).evaluation.task).toBe(false)
    const add = solved('add', 'ring')
    const remove = solved('remove', 'ring')
    remove.movedKey = add.movedKey
    remove.movedCount = add.movedCount
    expect(runAttempt(remove).evaluation.explanation).toBe(false)
    const attempt = runAttempt(add)
    add.movedKey = attempt.result.assignments.find((item) => attempt.baselineResult!.assignments.find((old) => old.key === item.key)?.owner === item.owner)!.key
    expect(runAttempt(add).evaluation.explanation).toBe(false)
  })
  it('requires fixed independent baselines, full outputs and matching snapshots', () => {
    const draft = solved()
    const attempt = runAttempt(draft)
    const truncated = structuredClone(attempt)
    truncated.result.assignments.pop()
    expect(verifyAttempt(truncated)).toBe(false)
    const forged = structuredClone(attempt)
    forged.result.counts[0]!.count++
    expect(verifyAttempt(forged)).toBe(false)
    draft.baseline!.method = 'modulo'
    expect(runAttempt(draft).evaluation.task).toBe(false)
    expect(evaluate(draft, attempt.result, attempt.baselineResult).evidence).toBe(false)
    expect(verifyAttempt({ ...attempt, exerciseVersion: 2 })).toBe(false)
    expect(verifyAttempt({ ...attempt, comparison: null })).toBe(false)
  })
  it('tracks independent method coverage plus a genuinely different transfer task', () => {
    const attempts = methods.map((method) => runAttempt(solved('add', method)))
    expect(learningProgress(attempts)).toEqual({ methods: [...methods], transfer: false })
    attempts.push(runAttempt(solved('remove', 'vnodes')))
    expect(learningProgress(attempts).transfer).toBe(true)
    const explore = solved()
    explore.mode = 'explore'
    expect(learningProgress([runAttempt(explore)])).toEqual({ methods: [], transfer: false })
  })
  it('invalidates configuration/baseline/mode changes while ignoring input display order', () => {
    const draft = solved()
    const identity = experimentIdentity(draft)
    expect(experimentIdentity({ ...draft, input: { ...draft.input, nodes: [...draft.input.nodes].reverse() } })).toBe(identity)
    expect(experimentIdentity({ ...draft, baseline: null })).not.toBe(identity)
    expect(experimentIdentity({ ...draft, mode: 'explore' })).not.toBe(identity)
    expect(experimentIdentity({ ...draft, input: { ...draft.input, nodes: ['only'] } })).not.toBe(identity)
  })
})
