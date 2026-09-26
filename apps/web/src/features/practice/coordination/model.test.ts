import { describe, expect, it } from 'vitest'
import { defaultConfig, runModel, type Command } from './model'
import { evaluate, initialDraft, parseDraft, runAttempt, scenarioCommands, verifyAttempt } from './lesson'
const config = defaultConfig()
const run = (commands: Command[]) => runModel(config, commands)

describe('failure detection depends on received evidence, not teaching truth', () => {
  it.each(['pause', 'partition', 'crash'] as const)('suspects %s, preserving distinct reality', (scenario) => {
    const s = run(scenarioCommands(config, scenario))
    expect(s.observations[0]!.status).toBe('suspected')
    expect(s.workers[0]!.status).toBe(scenario === 'partition' ? 'running' : scenario === 'pause' ? 'paused' : 'crashed')
    expect(s.observations[0]!.lastReceivedAt).toBe(0)
  })
  it('a delayed unseen heartbeat can clear suspicion even after the sender dies', () => {
    const commands: Command[] = [{ type: 'send-heartbeat', worker: 'A' }, { type: 'crash', worker: 'A' }, { type: 'advance', ms: 1000 }]
    expect(run(commands).observations[0]!.status).toBe('suspected')
    const s = run([...commands, { type: 'deliver-heartbeat', heartbeatId: 'heartbeat-1' }])
    expect(s.workers[0]!.status).toBe('crashed')
    expect(s.observations[0]).toMatchObject({ status: 'healthy', timeoutAt: 2000, lastReceivedAt: 1000 })
  })
  it('rejects older sequences and epochs without refreshing the receive timer', () => {
    const s = run([{ type: 'send-heartbeat', worker: 'A' }, { type: 'send-heartbeat', worker: 'A' }, { type: 'deliver-heartbeat', heartbeatId: 'heartbeat-2' }, { type: 'advance', ms: 100 }, { type: 'deliver-heartbeat', heartbeatId: 'heartbeat-1' }, { type: 'send-heartbeat', worker: 'A' }, { type: 'crash', worker: 'A' }, { type: 'restart', worker: 'A' }, { type: 'send-heartbeat', worker: 'A' }, { type: 'deliver-heartbeat', heartbeatId: 'heartbeat-4' }, { type: 'advance', ms: 100 }, { type: 'deliver-heartbeat', heartbeatId: 'heartbeat-3' }])
    expect(s.heartbeats.map((h) => h.status)).toEqual(['ignored', 'delivered', 'ignored', 'delivered'])
    expect(s.observations[0]).toMatchObject({ epoch: 2, sequence: 1, lastReceivedAt: 100, timeoutAt: 1100 })
  })
  it('uses the exact deadline and can recover after reconnecting', () => {
    const prefix: Command[] = [{ type: 'send-heartbeat', worker: 'A' }, { type: 'deliver-heartbeat', heartbeatId: 'heartbeat-1' }, { type: 'partition', worker: 'A' }, { type: 'advance', ms: 999 }]
    expect(run(prefix).observations[0]!.status).toBe('healthy')
    const commands: Command[] = [...prefix, { type: 'advance', ms: 1 }]
    expect(run(commands).observations[0]!.status).toBe('suspected')
    expect(run(commands).heartbeats.filter((h) => h.worker === 'A' && h.status === 'dropped')).toHaveLength(2)
    const s = run([...commands, { type: 'reconnect', worker: 'A' }, { type: 'send-heartbeat', worker: 'A' }, { type: 'deliver-heartbeat', heartbeatId: 'heartbeat-6' }])
    expect(s.observations[0]!.status).toBe('healthy')
  })
})
describe('leases and resource fencing are separate boundaries', () => {
  it('denies takeover until the exact authority expiry and preserves old local memory', () => {
    const prefix: Command[] = [{ type: 'acquire', worker: 'A' }, { type: 'pause', worker: 'A' }, { type: 'advance', ms: 1499 }, { type: 'acquire', worker: 'B' }]
    expect(run(prefix).lease?.owner).toBe('A')
    const s = run([...prefix, { type: 'advance', ms: 1 }, { type: 'acquire', worker: 'B' }])
    expect(s.lease).toMatchObject({ owner: 'B', token: 2, expiresAt: 3000 })
    expect(s.workers[0]!.localLease?.token).toBe(1)
    expect(s.events.filter((e) => e.kind === 'lease-expired')).toHaveLength(1)
  })
  it('renewal extends the current token, while crash loses local ownership knowledge', () => {
    const prefix: Command[] = [{ type: 'acquire', worker: 'A' }, { type: 'advance', ms: 500 }, { type: 'renew', worker: 'A' }]
    expect(run(prefix).lease).toMatchObject({ token: 1, expiresAt: 2000 })
    const crashed: Command[] = [...prefix, { type: 'crash', worker: 'A' }, { type: 'restart', worker: 'A' }]
    expect(run(crashed).workers[0]!.localLease).toBeNull()
    expect(() => run([...crashed, { type: 'renew', worker: 'A' }])).toThrow('不能续租')
    expect(run([...crashed, { type: 'acquire', worker: 'A' }]).events.at(-1)?.kind).toBe('lease-denied')
  })
  it.each([false, true])('fencing=%s evaluates the late packet against the resource token', (fencing) => {
    const c = { ...config, fencing }
    const s = runModel(c, scenarioCommands(c, 'stale-write'))
    expect(s.resource).toEqual({ highestToken: 2, value: fencing ? 'B-new' : 'A-old' })
    expect(s.writes[0]!.status).toBe(fencing ? 'rejected' : 'accepted')
  })
  it('cannot reject an old token before the resource has seen a newer one', () => {
    const c = { ...config, fencing: true }
    const s = runModel(c, scenarioCommands(c, 'fence-window'))
    expect(s.writes.map((w) => w.status)).toEqual(['accepted', 'accepted'])
    expect(s.resource.value).toBe('B-new')
  })
  it('does not protect order within the same token or revoke already sent packets on crash', () => {
    const s = runModel({ ...config, fencing: true }, [{ type: 'acquire', worker: 'A' }, { type: 'prepare-write', worker: 'A', value: 'old' }, { type: 'prepare-write', worker: 'A', value: 'new' }, { type: 'crash', worker: 'A' }, { type: 'deliver-write', writeId: 'write-2' }, { type: 'deliver-write', writeId: 'write-1' }])
    expect(s.resource.value).toBe('old')
    expect(s.writes.every((w) => w.status === 'accepted')).toBe(true)
  })
  it('local expiry prevents preparing new writes without deleting previous packets', () => {
    const s = run([{ type: 'acquire', worker: 'A' }, { type: 'prepare-write', worker: 'A', value: 'old' }, { type: 'advance', ms: 1500 }, { type: 'prepare-write', worker: 'A', value: 'new' }])
    expect(s.writes).toHaveLength(1)
    expect(s.writes[0]!.status).toBe('network')
    expect(s.events.at(-1)?.kind).toBe('local-expired')
  })
  it('suspicion does not bypass the lease authority', () => {
    const s = run(scenarioCommands(config, 'false-suspicion'))
    expect(s.observations[0]!.status).toBe('suspected')
    expect(s.lease?.owner).toBe('A')
    expect(s.resource.value).toBe('A-valid')
    const c = { ...config, timeoutMs: 2000 }
    expect(runModel(c, scenarioCommands(c, 'false-suspicion')).lease?.owner).toBe('B')
  })
  it('validates unsupported actions and records sample exhaustion', () => {
    expect(() => run([{ type: 'resume', worker: 'A' }])).toThrow('未暂停')
    expect(() => run([{ type: 'prepare-write', worker: 'A', value: 'invalid value' }])).toThrow('结果值')
    expect(() => run([{ type: 'advance', ms: 10000 }, { type: 'advance', ms: 1 }])).toThrow('时间范围')
    expect(() => runModel({ ...config, modelVersion: 'future' } as never, [])).toThrow('版本')
    const c = { ...config, intervalMs: 100 }
    const s = runModel(c, [{ type: 'send-heartbeat', worker: 'A' }, { type: 'advance', ms: 10000 }])
    expect(s.budgetHit).toBe(true)
    expect(s.heartbeats).toHaveLength(200)
  })
})
describe('coordination evidence and explanation', () => {
  it.each(['pause', 'partition', 'crash'] as const)('verifies %s with distinct observations and truth', (scenario) => {
    const d = { ...initialDraft('heartbeat'), scenario, commands: scenarioCommands(config, scenario), prediction: 'unknown', observedAnswer: 'suspected', actualAnswer: scenario === 'partition' ? 'running' : scenario === 'pause' ? 'paused' : 'crashed', reasonAnswer: 'observation-not-proof' }
    const a = runAttempt(d, 'heartbeat')
    expect(a.evaluation).toMatchObject({ task: true, explanation: true, status: 'pass' })
    expect(verifyAttempt(a, 'heartbeat')).toBe(true)
    expect(verifyAttempt(a, 'lease-fencing')).toBe(false)
    expect(verifyAttempt({ ...a, result: { ...a.result, now: 0 } }, 'heartbeat')).toBe(false)
    expect(verifyAttempt({ ...a, exerciseVersion: 2 }, 'heartbeat')).toBe(false)
  })
  it('requires safe stale-write rejection but teaches the resource-seen window accurately', () => {
    for (const fencing of [false, true]) {
      const d = { ...initialDraft('lease-fencing'), config: { ...config, fencing } }
      d.commands = scenarioCommands(d.config, d.scenario as 'stale-write')
      expect(runAttempt(d, 'lease-fencing').evaluation.task).toBe(fencing)
    }
    const d = { ...initialDraft('lease-fencing'), scenario: 'fence-window' as const, config: { ...config, fencing: true }, prediction: 'unknown', observedAnswer: 'suspected', actualAnswer: 'running', valueAnswer: 'B-new', rejectedAnswer: '0', reasonAnswer: 'resource-token-check' }
    d.commands = scenarioCommands(d.config, d.scenario)
    expect(runAttempt(d, 'lease-fencing').evaluation).toMatchObject({ task: true, explanation: true })
  })
  it('rejects no-work progress, false explanations and incompatible scenarios', () => {
    const d = initialDraft('heartbeat')
    expect(runAttempt(d, 'heartbeat').evaluation.status).toBe('inconclusive')
    d.commands = scenarioCommands(config, 'pause'); d.actualAnswer = 'crashed'; d.observedAnswer = 'suspected'; d.prediction = 'dead'; d.reasonAnswer = 'dead-proof'
    expect(runAttempt(d, 'heartbeat').evaluation.explanation).toBe(false)
    expect(() => parseDraft({ ...d, scenario: 'stale-write' }, 'heartbeat')).toThrow('无效')
    expect(evaluate(d, { ...run(d.commands), events: [] }).evidence).toBe(false)
  })
})
