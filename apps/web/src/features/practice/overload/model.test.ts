import { describe, expect, it } from 'vitest'
import { defaultConfig, metrics, runModel, type Command, type Config } from './model'
import { initialDraft, profileFor, runAttempt, scenarioCommands, verifyAttempt } from './lesson'
const config = defaultConfig()
const protectedConfig: Config = { ...config, retry: 'backoff', senderLimit: 1, queueLimit: 2, discardExpired: true }
describe('overload is executable work, not preset metrics', () => {
  it('keeps timed-out work alive and admits actual duplicate attempts', () => {
    const s = runModel(config, [{ type: 'slow' }, { type: 'submit' }, { type: 'advance', ms: 200 }])
    expect(s.attempts).toHaveLength(2)
    expect(s.attempts[0]).toMatchObject({ status: 'running', startedAt: 0, finishAt: 500, timeoutObserved: true })
    expect(s.attempts[1]).toMatchObject({ status: 'queued', sentAt: 200 })
    expect(metrics(s)).toMatchObject({ offered: 1, attempts: 2, successes: 0, busyMs: 200 })
  })
  it('success cancels future retries but does not withdraw queued duplicates', () => {
    const s = runModel(config, [{ type: 'slow' }, { type: 'submit' }, { type: 'advance', ms: 500 }])
    expect(s.roots[0]).toMatchObject({ phase: 'success', successAt: 500, retryAt: null })
    expect(s.attempts).toHaveLength(3)
    expect(metrics(s)).toMatchObject({ completed: 1, running: 1, queued: 1 })
    const drained = runModel(config, [{ type: 'slow' }, { type: 'submit' }, { type: 'advance', ms: 2000 }])
    expect(metrics(drained)).toMatchObject({ completed: 3, repeated: 2, successes: 1, busyMs: 1500 })
  })
  it('models fixed service duration at start; recovery does not complete current work early', () => {
    const s = runModel(config, [{ type: 'slow' }, { type: 'submit' }, { type: 'advance', ms: 100 }, { type: 'recover' }, { type: 'advance', ms: 100 }])
    expect(s.serviceMs).toBe(100); expect(s.attempts[0]!.finishAt).toBe(500)
    expect(metrics(s).completed).toBe(0)
  })
  it('backoff and a bounded sender window reduce actual work for the same fixed slowdown', () => {
    const commands = scenarioCommands('retry-storm')
    const a = runModel(config, commands); const b = runModel(protectedConfig, commands)
    expect(a.roots.map((r) => [r.arrival, r.deadline])).toEqual(b.roots.map((r) => [r.arrival, r.deadline]))
    expect(metrics(b)).toMatchObject({ offered: 12, attempts: 12, successes: 12, completed: 12, busyMs: 2000, peakQueue: 0 })
    expect(metrics(a).attempts).toBeGreaterThan(metrics(b).attempts)
    expect(metrics(a).busyMs).toBeGreaterThan(metrics(b).busyMs)
  })
  it('a client window moves waiting without moving original arrivals or deadlines', () => {
    const c: Config = { ...protectedConfig, profile: 'burst' }
    const s = runModel(c, [{ type: 'start' }])
    expect(metrics(s)).toMatchObject({ offered: 12, waiting: 11, running: 1, attempts: 1 })
    expect(s.roots.every((r) => r.arrival === 0 && r.deadline === 3000)).toBe(true)
    const done = runModel(c, scenarioCommands('bounded-burst'))
    expect(metrics(done)).toMatchObject({ successes: 12, peakQueue: 0, busyMs: 1200 })
  })
  it('queue rejection is separate from timeout and cannot become a successful request', () => {
    const c: Config = { ...config, profile: 'burst', queueLimit: 0, retry: 'none' }
    const s = runModel(c, [{ type: 'start' }])
    expect(metrics(s)).toMatchObject({ offered: 12, attempts: 12, rejected: 11, running: 1, timeouts: 0 })
    expect(metrics(runModel(c, scenarioCommands('bounded-burst')))).toMatchObject({ successes: 1, deadlines: 11 })
  })
  it('total deadlines stop retrying; expired queued work can be skipped while running work finishes late', () => {
    const c: Config = { ...config, profile: 'short-deadline', discardExpired: true }
    const s = runModel(c, scenarioCommands('expired-work'))
    const m = metrics(s)
    expect(m).toMatchObject({ successes: 1, deadlines: 11, completed: 2, busyMs: 1000 })
    expect(m.expired).toBeGreaterThan(0)
    expect(s.attempts.every((a) => a.sentAt < 800)).toBe(true)
    expect(s.attempts.every((a) => a.startedAt === null || a.startedAt < 800)).toBe(true)
    expect(s.roots[1]).toMatchObject({ phase: 'expired', firstWorkAt: 1000, successAt: null })
  })
  it('completion at the total deadline wins, but new work cannot begin at that deadline', () => {
    const c: Config = { ...config, profile: 'short-deadline', retry: 'none', discardExpired: true }
    const s = runModel(c, [{ type: 'start' }, { type: 'advance', ms: 800 }])
    expect(metrics(s)).toMatchObject({ successes: 8, completed: 8, expired: 4, deadlines: 4, queued: 0 })
    expect(s.roots[7]).toMatchObject({ successAt: 800, phase: 'success' })
  })
  it('stopping original production does not stop retries or queue draining', () => {
    const s = runModel(config, [{ type: 'slow' }, { type: 'start' }, { type: 'stop-traffic' }, { type: 'advance', ms: 2000 }])
    expect(metrics(s)).toMatchObject({ offered: 1, completed: 3, queued: 0, running: 0 })
    expect(s.roots.filter((r) => r.phase === 'cancelled')).toHaveLength(11)
  })
  it('jitter is repeatable and changes only retry timing for a fixed workload', () => {
    const commands = scenarioCommands('retry-storm')
    const c: Config = { ...config, retry: 'jitter' }
    const a = runModel(c, commands); const b = runModel({ ...c, seed: 83 }, commands)
    expect(a).toEqual(runModel(c, commands))
    expect(a.roots.map((r) => r.arrival)).toEqual(b.roots.map((r) => r.arrival))
    expect(a.attempts.map((a) => a.sentAt)).not.toEqual(b.attempts.map((a) => a.sentAt))
    const faults = (s: typeof a) => s.events.filter((e) => e.kind === 'slow' || e.kind === 'recovered').map((e) => [e.kind, e.at])
    expect(faults(a)).toEqual(faults(b))
  })
  it('splitting time advances preserves work and client outcomes', () => {
    const c = protectedConfig
    const a = runModel(c, scenarioCommands('retry-storm'))
    const commands: Command[] = [{ type: 'slow' }, { type: 'start' }, { type: 'advance', ms: 200 }, { type: 'advance', ms: 400 }, { type: 'recover' }, { type: 'advance', ms: 1400 }, { type: 'advance', ms: 8000 }]
    const split = runModel(c, commands)
    expect(metrics(split)).toEqual(metrics(a)); expect(split.roots).toEqual(a.roots); expect(split.attempts).toEqual(a.attempts)
  })
  it('conserves every attempt across all retry, queue and window policies', () => {
    for (const retry of ['none', 'immediate', 'backoff', 'jitter'] as const) for (const queueLimit of [0, 2, 8, 60]) for (const senderLimit of [0, 1, 2, 4]) {
      const c = { ...config, retry, queueLimit, senderLimit }
      const s = runModel(c, scenarioCommands('retry-storm')); const m = metrics(s)
      expect(m.attempts).toBe(m.completed + m.rejected + m.expired + m.queued + m.running)
      expect(m.successes + m.deadlines).toBe(m.offered)
      expect(m.peakQueue).toBeLessThanOrEqual(queueLimit)
      expect(m.queued + m.running).toBe(0)
      for (const r of s.roots) expect(s.attempts.filter((a) => a.rootId === r.id).length).toBeLessThanOrEqual(retry === 'none' ? 1 : c.maxAttempts)
    }
  })
  it('rejects unsupported versions, time ranges and extra traffic beyond budget', () => {
    expect(() => runModel({ ...config, modelVersion: 'future' } as never, [])).toThrow('版本')
    expect(() => runModel(config, [{ type: 'start' }, { type: 'start' }])).toThrow('启动过')
    expect(() => runModel(config, [{ type: 'advance', ms: 10000 }, { type: 'advance', ms: 1 }])).toThrow('时间范围')
    expect(() => runModel(config, Array.from({ length: 21 }, () => ({ type: 'submit' } as const)))).toThrow('原始请求')
  })
})
describe('overload grading rejects shortcuts', () => {
  it.each(['retry-storm', 'bounded-burst', 'expired-work'] as const)('verifies %s using real evidence', (scenario) => {
    const d = initialDraft(); d.scenario = scenario; d.config = { ...(scenario === 'expired-work' ? { ...config, discardExpired: true } : protectedConfig), profile: profileFor(scenario) }; d.commands = scenarioCommands(scenario)
    const m = metrics(runModel(d.config, d.commands)); d.prediction = 'unknown'; d.offeredAnswer = String(m.offered); d.attemptsAnswer = String(m.attempts); d.successAnswer = String(m.successes); d.workAnswer = String(m.completed); d.reasonAnswer = 'work-and-outcome'
    const a = runAttempt(d); expect(a.evaluation).toMatchObject({ task: true, explanation: true, status: 'pass' }); expect(verifyAttempt(a)).toBe(true)
    expect(verifyAttempt({ ...a, result: { ...a.result, peakQueue: 99 } })).toBe(false)
    expect(verifyAttempt({ ...a, exerciseVersion: 2 })).toBe(false)
  })
  it('does not require a policy name when another policy satisfies the actual controlled goal', () => {
    const d = initialDraft(); d.config.retry = 'none'; d.commands = scenarioCommands('retry-storm')
    expect(runAttempt(d).evaluation.task).toBe(true)
  })
  it('rejects no work, reduced original demand, higher capacity and shifted fault timing', () => {
    expect(runAttempt(initialDraft()).evaluation.status).toBe('inconclusive')
    const d = { ...initialDraft(), config: protectedConfig, commands: scenarioCommands('retry-storm') }
    expect(runAttempt({ ...d, config: { ...d.config, slots: 2 } }).evaluation.task).toBe(false)
    expect(runAttempt({ ...d, commands: [{ type: 'slow' }, { type: 'start' }, { type: 'stop-traffic' }, { type: 'advance', ms: 600 }, { type: 'recover' }, { type: 'advance', ms: 9400 }] }).evaluation.task).toBe(false)
    expect(runAttempt({ ...d, commands: [{ type: 'slow' }, { type: 'start' }, { type: 'advance', ms: 100 }, { type: 'recover' }, { type: 'advance', ms: 9900 }] }).evaluation.task).toBe(false)
  })
})
