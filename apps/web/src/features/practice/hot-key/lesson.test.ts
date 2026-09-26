import { describe, expect, it } from 'vitest'
import { hotChallenge, hotIdentity, hotProgress, runHotAttempt, verifyHotAttempt, type HotDraft, type Stage } from './lesson'
import { defaultHotInput, generateWorkload, runHotModel, topKeys } from './model'
import { makeInput } from '../distribution/model'

function candidate(stage: Stage): HotDraft {
  const draft = hotChallenge(stage)
  draft.prediction = 'balanced' // A wrong initial prediction must not block mastery.
  if (stage === 'hotspot') draft.input.workload = generateWorkload(draft.input.distribution, { pattern: 'hotspot' })
  if (stage === 'shards') draft.input.distribution.virtualNodes = 128
  if (stage === 'cache') draft.input.cache.enabled = true
  const result = runHotModel(draft.input)
  const hottest = topKeys(result)[0]!
  return { ...draft, keyAnswer: hottest.key, requestAnswer: String(hottest.requests), ownerAnswer: hottest.owner, backendAnswer: String(result.totals.backendReads), meaning: stage === 'cache' ? 'cache-boundary' : 'single-owner', caseId: 'shortlink', caseMeaning: 'read-hotspot' }
}
describe('Hot Key guided evidence', () => {
  it.each(['hotspot', 'shards', 'cache'] as Stage[])('accepts corrected evidence for %s', (stage) => {
    const attempt = runHotAttempt(candidate(stage))
    expect(attempt.evaluation).toMatchObject({ evidence: true, task: true, explanation: true })
    expect(verifyHotAttempt(attempt)).toBe(true)
  })
  it('does not pass unchanged inputs, exploration or a smaller token count', () => {
    expect(runHotAttempt(hotChallenge('cache')).evaluation.task).toBe(false)
    const draft = candidate('shards')
    draft.input.distribution.virtualNodes = 1
    expect(runHotAttempt(draft).evaluation.task).toBe(false)
    draft.stage = 'explore'
    expect(runHotAttempt(draft).evaluation.explanation).toBe(false)
  })
  it('rejects changing the fixed workload or baseline to manufacture a cache benefit', () => {
    const draft = candidate('cache')
    draft.input.workload = generateWorkload(draft.input.distribution, { probability: .95 })
    expect(runHotAttempt(draft).evaluation.task).toBe(false)
    draft.baseline = structuredClone(draft.input)
    expect(runHotAttempt(draft).evaluation.task).toBe(false)
  })
  it('requires actual counts, owner and a bounded case interpretation', () => {
    const draft = candidate('cache')
    for (const patch of [{ requestAnswer: '8000' }, { backendAnswer: '0' }, { ownerAnswer: 'not-owner' }, { meaning: 'no-bottleneck' }, { caseMeaning: 'celebrity' }, { caseId: '' }]) {
      expect(runHotAttempt({ ...draft, ...patch }).evaluation.explanation).toBe(false)
    }
  })
  it('rejects truncated/forged/version-mismatched evidence and tracks the three steps independently', () => {
    const attempt = runHotAttempt(candidate('hotspot'))
    const missing = structuredClone(attempt)
    missing.result.events.pop()
    expect(verifyHotAttempt(missing)).toBe(false)
    const forged = structuredClone(attempt)
    forged.result.nodes[0]!.backendReads++
    expect(verifyHotAttempt(forged)).toBe(false)
    expect(verifyHotAttempt({ ...attempt, exerciseVersion: 2 })).toBe(false)
    expect(verifyHotAttempt({ ...attempt, comparison: null })).toBe(false)
    expect(hotProgress([attempt])).toEqual(['hotspot'])
    expect(hotProgress([attempt, runHotAttempt(candidate('shards')), runHotAttempt(candidate('cache'))])).toEqual(['hotspot', 'shards', 'cache'])
  })
  it('invalidates semantic edits but does not treat reflection or dormant cache parameters as a model change', () => {
    const draft = hotChallenge()
    expect(hotIdentity({ ...draft, reflection: 'note' })).toBe(hotIdentity(draft))
    expect(hotIdentity({ ...draft, input: { ...draft.input, cache: { ...draft.input.cache, capacity: 256 } } })).toBe(hotIdentity(draft))
    expect(hotIdentity({ ...draft, baseline: null })).not.toBe(hotIdentity(draft))
    expect(hotIdentity({ ...draft, input: { ...draft.input, cache: { ...draft.input.cache, enabled: true } } })).not.toBe(hotIdentity(draft))
  })
  it('completes the largest bounded experiment with full, verifiable records', () => {
    const draft = hotChallenge('explore')
    const distribution = { ...makeInput('max', 4096), method: 'vnodes' as const, virtualNodes: 128, nodes: Array.from({ length: 12 }, (_, index) => `node-${index}`) }
    draft.input = { ...defaultHotInput(), distribution, workload: generateWorkload(distribution, { count: 20000, pattern: 'uniform' }), cache: { enabled: true, capacity: 256, ttlMs: 60000 } }
    draft.baseline = { ...draft.input, cache: { ...draft.input.cache, enabled: false } }
    const started = performance.now()
    const attempt = runHotAttempt(draft)
    expect(attempt.result.events).toHaveLength(20000)
    expect(attempt.result.distribution.tokens).toHaveLength(1536)
    expect(verifyHotAttempt(attempt)).toBe(true)
    console.info(`Hot Key max run + verification: ${(performance.now() - started).toFixed(0)} ms`)
  })
})
