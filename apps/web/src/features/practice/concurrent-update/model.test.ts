import { describe, expect, it } from 'vitest'
import { defaultConfig, runModel, type Command, type Config, type WorkerId } from './model'
import { initialDraft, invariant, runAttempt, scenarioCommands, verifyAttempt } from './lesson'
const config = defaultConfig()
describe('concurrent reservations', () => {
  it.each([false, true])('distinct intents oversell with stale reads, even with dedupe=%s', (idempotent) => {
    const c = { ...config, idempotent }; const s = runModel(c, scenarioCommands(c, 'last-slot'))
    expect(s.remaining).toBe(0); expect(s.reservations).toHaveLength(2); expect(invariant(c, s)).toBe(false)
  })
  it('lost updates leave a plausible counter inconsistent with the booking ledger', () => {
    const c = { ...config, capacity: 2 }; const s = runModel(c, scenarioCommands(c, 'lost-update'))
    expect(s.remaining).toBe(1); expect(s.reservations).toHaveLength(2)
    expect(s.remaining + s.reservations.length).toBe(3)
  })
  it.each(['cas', 'row-lock'] as const)('protects one and two slots with %s', (strategy) => {
    for (const capacity of [1, 2]) {
      const c = { ...config, capacity, strategy }; const s = runModel(c, scenarioCommands(c, capacity === 1 ? 'last-slot' : 'lost-update'))
      expect(invariant(c, s)).toBe(true); expect(s.reservations).toHaveLength(capacity); expect(s.remaining).toBe(0)
      expect(s.workers.every((w) => ['committed', 'sold-out'].includes(w.status))).toBe(true)
      expect(s.lock).toBeNull()
    }
  })
  it('CAS rejects the entire stale commit without adding a reservation or deducting stock', () => {
    const c: Config = { ...config, strategy: 'cas' }
    const s = runModel(c, [{ type: 'read', worker: 'A' }, { type: 'read', worker: 'B' }, { type: 'commit', worker: 'A' }, { type: 'commit', worker: 'B' }])
    expect(s.version).toBe(1); expect(s.reservations).toHaveLength(1)
    expect(s.workers[1]).toMatchObject({ status: 'conflict', snapshot: null, conflicts: 1 })
  })
  it('a waiting lock holder must reread after the old transaction ends', () => {
    const c: Config = { ...config, strategy: 'row-lock' }
    const prefix: Command[] = [{ type: 'read', worker: 'A' }, { type: 'read', worker: 'B' }]
    expect(runModel(c, prefix).workers[1]).toMatchObject({ status: 'waiting', snapshot: null })
    expect(() => runModel(c, [...prefix, { type: 'commit', worker: 'B' }])).toThrow('提交前')
    const s = runModel(c, [...prefix, { type: 'commit', worker: 'A' }])
    expect(s.lock).toBe('B'); expect(s.workers[1]).toMatchObject({ status: 'idle', snapshot: null })
  })
  it.each(['abort', 'crash'] as const)('%s releases the transaction lock without committing effects', (type) => {
    const c: Config = { ...config, strategy: 'row-lock' }
    const s = runModel(c, [{ type: 'read', worker: 'A' }, { type: 'read', worker: 'B' }, { type, worker: 'A' }])
    expect(s.reservations).toHaveLength(0); expect(s.remaining).toBe(1); expect(s.lock).toBe('B')
    expect(s.workers[0]!.snapshot).toBeNull()
  })
  it('committed effects survive crash, and dedupe prevents replaying the same intent', () => {
    const commands: Command[] = [{ type: 'read', worker: 'A' }, { type: 'commit', worker: 'A' }, { type: 'crash', worker: 'A' }, { type: 'restart', worker: 'A' }, { type: 'read', worker: 'A' }]
    const c: Config = { ...config, capacity: 2, strategy: 'cas', idempotent: true }
    const s = runModel(c, commands); expect(s.remaining).toBe(1); expect(s.reservations).toHaveLength(1); expect(s.events.at(-1)!.kind).toBe('dedupe')
    const unsafe = runModel({ ...c, idempotent: false }, [...commands, { type: 'commit', worker: 'A' }])
    expect(unsafe.reservations).toHaveLength(2); expect(invariant(c, unsafe)).toBe(false)
  })
  it('all legal two-transaction read/commit interleavings preserve the CAS invariant', () => {
    function interleave(a: Command[], b: Command[]): Command[][] { if (!a.length) return [b]; if (!b.length) return [a]; return [...interleave(a.slice(1), b).map((tail) => [a[0]!, ...tail]), ...interleave(a, b.slice(1)).map((tail) => [b[0]!, ...tail])] }
    for (const capacity of [1, 2]) {
      const c: Config = { ...config, strategy: 'cas', capacity }
      for (const commands of interleave([{ type: 'read', worker: 'A' }, { type: 'commit', worker: 'A' }], [{ type: 'read', worker: 'B' }, { type: 'commit', worker: 'B' }])) {
        const prefix = [...commands]
        for (const worker of ['A', 'B'] as WorkerId[]) if (runModel(c, prefix).workers.find((w) => w.id === worker)!.status === 'conflict') prefix.push({ type: 'read', worker }, { type: 'commit', worker })
        const s = runModel(c, prefix)
        expect(invariant(c, s)).toBe(true); expect(s.reservations).toHaveLength(capacity)
      }
    }
  })
  it('validates version and command bounds', () => {
    expect(() => runModel({ ...config, modelVersion: 'future' } as never, [])).toThrow('版本')
    expect(() => runModel(config, [{ type: 'commit', worker: 'A' }])).toThrow('读取')
    expect(() => runModel(config, Array.from({ length: 61 }, () => ({ type: 'read', worker: 'A' } as const)))).toThrow('预算')
  })
})
describe('concurrent lesson evidence', () => {
  it.each(['last-slot', 'lost-update', 'crash-before-commit'] as const)('accepts actual safe recovery for %s', (scenario) => {
    const d = initialDraft(); d.scenario = scenario; d.config.strategy = 'row-lock'; d.config.capacity = scenario === 'lost-update' ? 2 : 1
    d.commands = scenarioCommands(d.config, scenario); d.prediction = 'unknown'; d.remainingAnswer = '0'; d.reservationsAnswer = String(d.config.capacity); d.invariantAnswer = 'safe'; d.reasonAnswer = 'different-boundaries'
    const a = runAttempt(d); expect(a.evaluation).toMatchObject({ task: true, explanation: true, status: 'pass' }); expect(verifyAttempt(a)).toBe(true)
    expect(verifyAttempt({ ...a, result: { ...a.result, remaining: 99 } })).toBe(false)
    expect(verifyAttempt({ ...a, exerciseVersion: 2 })).toBe(false)
  })
  it('rejects stock inflation, serial-only evidence and no-work progress', () => {
    expect(runAttempt(initialDraft()).evaluation.status).toBe('inconclusive')
    const d = initialDraft(); d.config.capacity = 2; d.config.strategy = 'cas'; d.commands = scenarioCommands(d.config, 'last-slot')
    expect(runAttempt(d).evaluation.task).toBe(false)
    d.config.capacity = 1; d.commands = [{ type: 'read', worker: 'A' }, { type: 'commit', worker: 'A' }, { type: 'read', worker: 'B' }, { type: 'commit', worker: 'B' }]
    expect(runAttempt(d).evaluation.task).toBe(false)
  })
})
