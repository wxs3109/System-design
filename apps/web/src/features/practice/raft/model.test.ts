import { expect, it } from 'vitest'
import { canDeliver, defaultConfig, runModel, type Command } from './model'
import { lesson, scenarioCommands } from './lesson'
it.each(['split-vote', 'minority', 'conflict-repair', 'old-term'])('executes %s with no election or application safety violation', (scenario) => {
  const d = lesson.initial(); d.scenario = scenario; d.config.size = scenario === 'old-term' ? 5 : 3; d.commands = scenarioCommands(d.config, scenario)
  const a = lesson.runAttempt(d); expect(a.result.violations).toEqual([]); expect(a.evaluation.task).toBe(true); expect(lesson.verifyAttempt(a)).toBe(true)
})
it('counting old-term replicas exposes a real leader-completeness/application counterexample', () => {
  const c = { ...defaultConfig(), size: 5 as const, commitRule: 'any-term' as const }
  const s = runModel(c, scenarioCommands(c, 'old-term'))
  expect(s.violations.length).toBeGreaterThan(0); expect(s.acknowledged).toContain(s.proposals.find((p) => p.value === 'old')!.id)
})
it('retains the vote across restart and does not count duplicate votes twice', () => {
  const c = defaultConfig()
  const commands: Command[] = [{ type: 'campaign', node: 'A' }, { type: 'deliver', messageId: 'message-1' }, { type: 'crash', node: 'B' }, { type: 'restart', node: 'B' }, { type: 'campaign', node: 'C' }]
  let s = runModel(c, commands)
  const request = s.messages.find((m) => m.type === 'request-vote' && m.from === 'C' && m.to === 'B')!
  commands.push({ type: 'deliver', messageId: request.id }); s = runModel(c, commands)
  expect(s.nodes.find((n) => n.id === 'B')!.votedFor).toBe('A')
  expect(s.messages.at(-1)!.granted).toBe(false)
  const five = { ...c, size: 5 as const }; const duplicate: Command[] = [{ type: 'campaign', node: 'A' }, { type: 'deliver', messageId: 'message-1' }, { type: 'deliver', messageId: 'message-5' }, { type: 'duplicate', messageId: 'message-5' }, { type: 'deliver', messageId: 'message-6' }]
  const result = runModel(five, duplicate); expect(result.nodes[0]!.role).toBe('candidate'); expect(result.nodes[0]!.votes).toEqual(['A', 'B'])
})
it('keeps logs and applied state on restart, and rejects evidence rewrites', () => {
  const d = lesson.initial(); d.commands = scenarioCommands(d.config, 'split-vote'); const before = runModel(d.config, d.commands)
  const after = runModel(d.config, [...d.commands, { type: 'crash', node: 'A' }, { type: 'restart', node: 'A' }])
  expect(after.nodes[0]!.log).toEqual(before.nodes[0]!.log); expect(after.nodes[0]!.applied).toEqual(before.nodes[0]!.applied); expect(after.nodes[0]!.role).toBe('follower')
  const a = lesson.runAttempt(d); expect(lesson.verifyAttempt({ ...a, result: { ...a.result, violations: ['fake'] } })).toBe(false)
  expect(lesson.verifyAttempt({ ...a, exerciseVersion: 2 })).toBe(false)
})
it('preserves vote, prefix and application safety across bounded adversarial schedules', () => {
  for (let seed = 1; seed <= 30; seed++) {
    let random = seed
    const next = (n: number) => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return random % n }
    const c = { ...defaultConfig(), size: seed % 2 ? 3 as const : 5 as const }
    const commands: Command[] = []
    for (let turn = 0; turn < 70; turn++) {
      const s = runModel(c, commands)
      const choices: Command[] = []
      for (const m of s.messages) if (canDeliver(s, m)) choices.push({ type: 'deliver', messageId: m.id }, { type: 'deliver', messageId: m.id }, { type: 'drop', messageId: m.id })
      for (const n of s.nodes) {
        if (!n.online) choices.push({ type: 'restart', node: n.id })
        else {
          choices.push({ type: n.isolated ? 'heal' : 'isolate', node: n.id })
          if (n.role !== 'leader') choices.push({ type: 'campaign', node: n.id })
          else if (s.proposals.length < 10 && n.log.length < 8) choices.push({ type: 'propose', node: n.id, value: `value${turn}` })
          if (turn % 7 === 0) choices.push({ type: 'crash', node: n.id })
        }
      }
      commands.push(choices[next(choices.length)]!)
      const result = runModel(c, commands)
      expect(result.violations, `seed ${seed}, step ${turn}`).toEqual([])
      for (const n of result.nodes) {
        expect(n.commitIndex).toBeLessThanOrEqual(n.log.length)
        expect(n.applied).toEqual(n.log.slice(0, n.commitIndex))
        for (const peer of result.nodes) for (let i = 0; i < Math.min(n.log.length, peer.log.length); i++) if (n.log[i]!.term === peer.log[i]!.term) expect(n.log.slice(0, i + 1)).toEqual(peer.log.slice(0, i + 1))
      }
      for (const election of result.elections) expect(new Set(result.elections.filter((e) => e.term === election.term).map((e) => e.leader)).size).toBe(1)
    }
  }
})
