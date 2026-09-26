import { describe, expect, it } from 'vitest'
import { evaluate, identity, initialDraft, progress, runAttempt, scenarioCommands, scenariosFor, verifyAttempt, type Draft, type LabId } from './lesson'
import { runModel } from './model'

function solved(id: LabId, scenario: Draft['scenario']): Draft {
  const draft = initialDraft(id)
  draft.scenario = scenario
  draft.config.consumer = 'atomic'
  if (id === 'transactional-outbox') draft.config.producer = 'outbox'
  draft.commands = scenarioCommands(draft.config, scenario as Exclude<Draft['scenario'], 'manual'>)
  const result = runModel(draft.config, draft.commands)
  return { ...draft, prediction: 'unknown', effectAnswer: String(result.effects.length), checkpointAnswer: String(result.checkpoints.length), ackAnswer: String(result.copies.filter((copy) => copy.status === 'acked').length), reasonAnswer: 'separate-boundaries' }
}
describe('message learning goals and reproducible evidence', () => {
  it.each(['ack-checkpoint', 'transactional-outbox'] as const)('accepts all three corrected scenarios for %s', (id) => {
    const attempts = scenariosFor(id).filter((scenario) => scenario !== 'manual').map((scenario) => runAttempt(solved(id, scenario), id))
    for (const attempt of attempts) { expect(attempt.evaluation).toMatchObject({ evidence: true, status: 'pass', explanation: true }); expect(verifyAttempt(attempt, id)).toBe(true) }
    expect(progress(attempts, id)).toHaveLength(3)
  })
  it('does not accept zero work, early ACK loss, duplicate effects or a missing sending intent', () => {
    const empty = initialDraft('ack-checkpoint')
    expect(runAttempt(empty, empty.labId).evaluation.status).not.toBe('pass')
    empty.commands = scenarioCommands(empty.config, empty.scenario as 'before-effect')
    expect(runAttempt(empty, empty.labId).evaluation).toMatchObject({ noDuplicates: true, allEffects: false, status: 'fail' })
    const duplicate = initialDraft('ack-checkpoint')
    duplicate.scenario = 'after-effect'; duplicate.config.consumer = 'split'; duplicate.commands = scenarioCommands(duplicate.config, 'after-effect')
    expect(runAttempt(duplicate, duplicate.labId).evaluation.noDuplicates).toBe(false)
    const gap = initialDraft('transactional-outbox')
    gap.commands = scenarioCommands(gap.config, 'commit-gap')
    expect(runAttempt(gap, gap.labId).evaluation).toMatchObject({ intentRecorded: false, allEffects: false, status: 'fail' })
  })
  it('requires actual fault timing, current answers and complete evidence', () => {
    const draft = solved('ack-checkpoint', 'lost-ack')
    const attempt = runAttempt(draft, draft.labId)
    expect(runAttempt({ ...draft, effectAnswer: '999' }, draft.labId).evaluation.explanation).toBe(false)
    const changed = structuredClone(attempt)
    changed.result.effects.pop()
    expect(verifyAttempt(changed, draft.labId)).toBe(false)
    expect(verifyAttempt({ ...attempt, exerciseVersion: 2 }, draft.labId)).toBe(false)
    expect(verifyAttempt(attempt, 'transactional-outbox')).toBe(false)
    expect(evaluate({ ...draft, commands: [] }, attempt.result).evidence).toBe(false)
    const wrongFault = { ...draft, scenario: 'before-effect' as const }
    expect(runAttempt(wrongFault, draft.labId).evaluation.faultObserved).toBe(false)
  })
  it('invalidates command/config changes, not free reflection, and excludes exploration from progress', () => {
    const draft = solved('transactional-outbox', 'confirm-gap')
    expect(identity({ ...draft, reflection: 'note' })).toBe(identity(draft))
    expect(identity({ ...draft, commands: [] })).not.toBe(identity(draft))
    expect(identity({ ...draft, config: { ...draft.config, consumer: 'split' } })).not.toBe(identity(draft))
    expect(progress([runAttempt({ ...draft, scenario: 'manual' }, draft.labId)], draft.labId)).toHaveLength(0)
  })
})
