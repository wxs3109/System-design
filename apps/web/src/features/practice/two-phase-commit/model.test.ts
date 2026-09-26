import { expect, it } from 'vitest'
import { defaultConfig, runModel, type Command } from './model'
import { lesson, scenarioCommands } from './lesson'
it.each(['blocking', 'decision-gap', 'participant-recovery', 'rejection'])('restores the declared transaction decision after %s', (scenario) => {
  const d = lesson.initial(); d.scenario = scenario; d.config.rejectB = scenario === 'rejection'; d.commands = scenarioCommands(d.config, scenario)
  const a = lesson.runAttempt(d)
  expect(a.evaluation.task).toBe(true); expect(lesson.verifyAttempt(a)).toBe(true)
  expect(a.result.clientOutcome).toBe(scenario === 'rejection' ? 'abort' : 'commit')
  expect(a.result.participants.map((p) => p.balance)).toEqual(scenario === 'rejection' ? [5, 5] : [3, 7])
  expect(lesson.verifyAttempt({ ...a, result: { ...a.result, decision: null } })).toBe(false)
})
it('a prepared participant cannot infer abort from coordinator silence', () => {
  const c = { ...defaultConfig(), timeoutPolicy: 'abort' as const }
  const s = runModel(c, scenarioCommands(c, 'decision-gap'))
  expect(s.decision).toBe('commit'); expect(s.participants.map((p) => p.phase)).toEqual(['committed', 'aborted']); expect(s.conflicts).toBeGreaterThan(0)
})
it('prepared state and locks survive participant restart, and duplicate decisions do not duplicate effects', () => {
  const c = defaultConfig(); const commands: Command[] = [{ type: 'begin' }, { type: 'deliver', messageId: 'message-1' }, { type: 'crash', actor: 'A' }, { type: 'restart', actor: 'A' }]
  expect(runModel(c, commands).participants[0]!.phase).toBe('prepared')
  expect(runModel(c, commands).participants[0]!.balance).toBe(5)
  const done = runModel(c, scenarioCommands(c, 'participant-recovery'))
  expect(done.participants.map((p) => p.effects)).toEqual([1, 1])
})
it('cannot commit with one yes, reverse a logged decision or send it before logging', () => {
  const c = defaultConfig()
  expect(() => runModel(c, [{ type: 'begin' }, { type: 'deliver', messageId: 'message-1' }, { type: 'deliver', messageId: 'message-3' }, { type: 'decide' }])).toThrow('缺少')
  expect(() => runModel(c, [{ type: 'begin' }, { type: 'broadcast' }])).toThrow('持久')
  expect(() => runModel(c, [{ type: 'begin' }, { type: 'abort' }, { type: 'abort' }])).toThrow('不能更改')
})
