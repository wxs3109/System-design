import { expect, it } from 'vitest'
import { checkRegisterHistory } from './history'
import { defaultConfig, runModel, type Config, type Command } from './model'
import { quorumLesson, replicaLesson, scenarioCommands } from './lesson'
it.each(['stale-read', 'monotonic-read', 'partition'])('records the stale-read counterexample and protects %s with session routing', (scenario) => {
  for (const readPolicy of ['any', 'session', 'primary'] as const) {
    const d = replicaLesson.initial(); d.scenario = scenario; d.config.readPolicy = readPolicy; d.commands = scenarioCommands(d.config, scenario)
    const a = replicaLesson.runAttempt(d)
    expect(a.evaluation.task).toBe(readPolicy !== 'any')
    expect(checkRegisterHistory(a.result.operations).status).toBe(readPolicy === 'any' ? 'violation' : 'linearizable')
    expect(a.result.replicas.every((r) => r.current.value === 'v1')).toBe(true)
  }
})
it('quorum intersection and repair use actual reply sets', () => {
  const d = quorumLesson.initial(); d.scenario = 'intersection'; d.commands = scenarioCommands(d.config, d.scenario)
  expect(quorumLesson.runAttempt(d).evaluation.task).toBe(true)
  d.config.writeQuorum = 1; d.config.readQuorum = 1; d.commands = scenarioCommands(d.config, d.scenario)
  expect(quorumLesson.runAttempt(d).result.operations.at(-1)!.result).toBe('initial')
  expect(quorumLesson.runAttempt(d).evaluation.task).toBe(false)
  d.config = { ...defaultConfig('quorum'), repair: true }; d.scenario = 'repair'; d.commands = scenarioCommands(d.config, d.scenario)
  const a = quorumLesson.runAttempt(d)
  expect(a.evaluation.task).toBe(true); expect(a.result.messages.some((m) => m.type === 'repair' && m.to === 'C' && m.status === 'delivered')).toBe(true)
})
it('two successful majority writes with independent local tags can violate real-time order', () => {
  const d = quorumLesson.initial(); d.scenario = 'clock-counterexample'; d.commands = scenarioCommands(d.config, d.scenario)
  const a = quorumLesson.runAttempt(d)
  expect(a.evaluation.task).toBe(true); expect(a.result.operations.map((op) => op.result)).toEqual(['ok', 'ok', 'v1'])
  expect(checkRegisterHistory(a.result.operations).status).toBe('violation')
  expect(a.result.operations[0]!.returned!).toBeLessThan(a.result.operations[1]!.invoked)
})
it('does not update a returned read when slower replies arrive', () => {
  const c: Config = { ...defaultConfig('quorum'), writeQuorum: 1, readQuorum: 1 }
  const s = runModel(c, scenarioCommands(c, 'intersection'))
  expect(s.operations.at(-1)!.result).toBe('initial')
  expect(s.events.some((e) => e.kind === 'late-reply')).toBe(true)
})
it('incomplete operations remain explicit, and replica crashes retain stored values', () => {
  const c = defaultConfig(); const commands: Command[] = [{ type: 'write', client: 'X', value: 'v1' }, { type: 'deliver', messageId: 'message-1' }, { type: 'crash', node: 'A' }, { type: 'restart', node: 'A' }]
  const s = runModel(c, commands)
  expect(s.replicas[0]!.current.value).toBe('v1'); expect(checkRegisterHistory(s.operations).status).toBe('incomplete')
})
it('rejects evidence tampering, cross-mode records and changed versions', () => {
  const d = replicaLesson.initial(); d.config.readPolicy = 'session'; d.commands = scenarioCommands(d.config, d.scenario)
  const a = replicaLesson.runAttempt(d)
  expect(replicaLesson.verifyAttempt(a)).toBe(true)
  expect(replicaLesson.verifyAttempt({ ...a, result: { ...a.result, events: [] } })).toBe(false)
  expect(quorumLesson.verifyAttempt(a)).toBe(false)
  expect(replicaLesson.verifyAttempt({ ...a, exerciseVersion: 2 })).toBe(false)
})
it('checks real-time precedence while permitting overlapping writes to linearize in either order', () => {
  const history = [{ id: 'w1', kind: 'write' as const, value: 'v1', invoked: 1, returned: 6, result: 'ok' }, { id: 'w2', kind: 'write' as const, value: 'v2', invoked: 2, returned: 3, result: 'ok' }, { id: 'r', kind: 'read' as const, value: '', invoked: 4, returned: 5, result: 'v2' }]
  expect(checkRegisterHistory(history).status).toBe('linearizable')
  history[0] = { ...history[0]!, invoked: 4, returned: 5 }; history[2] = { ...history[2]!, invoked: 7, returned: 8 }
  expect(checkRegisterHistory(history).status).toBe('violation')
  expect(checkRegisterHistory([{ ...history[0]!, returned: null }]).status).toBe('incomplete')
})
