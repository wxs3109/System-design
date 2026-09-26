import { describe, expect, it } from 'vitest'
import { evaluate, experimentIdentity, initialDraft, progress, runAttempt, scenarioCommands, verifyAttempt, type RetryDraft, type Scenario } from './lesson'
import { clientStatus, defaultConfig, runProtocol } from './model'

function solved(scenario: Exclude<Scenario, 'manual'>): RetryDraft {
  const draft = initialDraft()
  draft.scenario = scenario
  draft.config.strategy = 'idempotent'
  draft.commands = scenarioCommands(draft.config, scenario)
  const result = runProtocol(draft.config, draft.commands)
  return { ...draft, prediction: 'duplicate', createdAnswer: String(result.store.tasks.length), clientAnswer: clientStatus(result), reasonAnswer: 'unknown-does-not-mean-failed' }
}
describe('request reliability evidence and learning goals', () => {
  it.each(['response-lost', 'request-lost', 'late-request'] as const)('accepts full %s evidence with a corrected prediction', (scenario) => {
    const attempt = runAttempt(solved(scenario))
    expect(attempt.evaluation).toMatchObject({ evidence: true, status: 'pass', explanation: true, clientInformed: true, settled: true })
    expect(verifyAttempt(attempt)).toBe(true)
  })
  it('does not pass by selecting idempotency, doing no work or losing all responses', () => {
    const empty = solved('response-lost')
    empty.commands = []
    expect(runAttempt(empty).evaluation.status).toBe('inconclusive')
    empty.config.strategy = 'no-retry'
    empty.commands = scenarioCommands(empty.config, 'request-lost')
    expect(runAttempt(empty).evaluation).toMatchObject({ noDuplicate: true, clientInformed: false, status: 'fail' })
    empty.commands = scenarioCommands(empty.config, 'response-lost')
    empty.scenario = 'response-lost'
    expect(runAttempt(empty).evaluation.clientInformed).toBe(false)
  })
  it('uses actual evidence, not a strategy-name whitelist, for a single run', () => {
    const draft = solved('request-lost')
    draft.config.strategy = 'retry'
    draft.commands = scenarioCommands(draft.config, 'request-lost')
    expect(runAttempt(draft).evaluation.status).toBe('pass')
    draft.scenario = 'response-lost'
    draft.commands = scenarioCommands(draft.config, 'response-lost')
    expect(runAttempt(draft).evaluation).toMatchObject({ noDuplicate: false, status: 'fail' })
  })
  it('rejects incomplete, forged and unknown-version saved evidence', () => {
    const attempt = runAttempt(solved('response-lost'))
    const truncated = structuredClone(attempt)
    truncated.result.events.pop()
    expect(verifyAttempt(truncated)).toBe(false)
    const forged = structuredClone(attempt)
    forged.result.knownTaskIds = []
    expect(verifyAttempt(forged)).toBe(false)
    expect(verifyAttempt({ ...attempt, exerciseVersion: 2 })).toBe(false)
    expect(verifyAttempt({ ...attempt, draft: { ...attempt.draft, config: { ...attempt.draft.config, modelVersion: 'v-next' } } })).toBe(false)
    const settings = { ...attempt.draft, config: defaultConfig() }
    expect(evaluate(settings, attempt.result).evidence).toBe(false)
  })
  it('requires the requested fault and a distinction between server facts and client observations', () => {
    const draft = solved('response-lost')
    draft.commands = [{ type: 'submit' }, { type: 'deliver-request', requestId: 'request-1' }, { type: 'commit', requestId: 'request-1' }, { type: 'deliver-response', responseId: 'response-1' }]
    expect(runAttempt(draft).evaluation.faultObserved).toBe(false)
    const correct = solved('response-lost')
    expect(runAttempt({ ...correct, createdAnswer: '2' }).evaluation.explanation).toBe(false)
    expect(runAttempt({ ...correct, clientAnswer: 'unknown' }).evaluation.explanation).toBe(false)
    expect(runAttempt({ ...correct, reasonAnswer: 'rolled-back' }).evaluation.explanation).toBe(false)
  })
  it('separates complete challenge records from free exploration and new semantic edits', () => {
    const attempts = (['response-lost', 'request-lost', 'late-request'] as const).map((scenario) => runAttempt(solved(scenario)))
    expect(progress(attempts)).toEqual(['response-lost', 'request-lost', 'late-request'])
    expect(progress([runAttempt({ ...solved('response-lost'), scenario: 'manual' })])).toEqual([])
    const original = solved('response-lost')
    expect(experimentIdentity({ ...original, reflection: 'new note' })).toBe(experimentIdentity(original))
    expect(experimentIdentity({ ...original, commands: [] })).not.toBe(experimentIdentity(original))
    expect(experimentIdentity({ ...original, config: { ...original.config, retentionMs: 200 } })).not.toBe(experimentIdentity(original))
  })
})
