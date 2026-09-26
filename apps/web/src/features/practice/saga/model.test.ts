import { describe, expect, it } from 'vitest'
import { canSend, defaultConfig, nextOperation, runModel, type Command, type Config } from './model'
import { evaluate, initialDraft, runAttempt, scenarioCommands, verifyAttempt } from './lesson'
const config: Config = { ...defaultConfig(), recovery: 'saga' }
const run = (commands: Command[], c = config) => runModel(c, commands)
function builder(c = config) {
  const commands: Command[] = []
  const apply = (command: Command) => { commands.push(command); return run(commands, c) }
  const send = () => apply({ type: 'send' }).packets.at(-1)!.id
  const finish = (id: string) => { apply({ type: 'deliver-request', packetId: id }); apply({ type: 'deliver-response', packetId: id }); return apply({ type: 'checkpoint', packetId: id }) }
  return { commands, apply, send, finish }
}
describe('saga local effects and durable progress', () => {
  it('finishes the happy path without compensation', () => {
    const b = builder(); b.apply({ type: 'start' }); b.finish(b.send()); b.finish(b.send()); const s = b.finish(b.send())
    expect(s.phase).toBe('complete'); expect(nextOperation(s)).toBeNull()
    expect(s.packets.every((p) => p.response === 'recorded')).toBe(true)
    expect(s.resource).toEqual({ reserved: 1, released: 0, artifacts: 1, transcodeWork: 1, published: true })
  })
  it('stopping after a failure leaves independently committed effects', () => {
    const c = defaultConfig(); const s = run(scenarioCommands(c, 'response-lost'), c)
    expect(s.phase).toBe('failed')
    expect(s.resource).toMatchObject({ reserved: 1, released: 0, artifacts: 1, published: false })
  })
  it.each(['response-lost', 'coordinator-crash', 'compensation-failure'] as const)('recovers %s using actual commands', (scenario) => {
    const s = run(scenarioCommands(config, scenario))
    expect(s.phase).toBe('compensated')
    expect(s.resource).toEqual({ reserved: 1, released: 1, artifacts: 0, transcodeWork: 1, published: false })
    expect(s.journal).toEqual({ reserve: 'ok', transcode: 'ok', publish: 'rejected', cleanup: 'ok', release: 'ok' })
  })
  it('a repeated non-idempotent release can over-credit quota despite a completed journal', () => {
    const c = { ...config, idempotent: false }; const s = run(scenarioCommands(c, 'response-lost'), c)
    expect(s.phase).toBe('compensated')
    expect(s.resource.released).toBe(2)
    expect(1 - s.resource.reserved + s.resource.released).toBe(2)
  })
  it('coordinator crash loses received results, while committed service effects survive', () => {
    const b = builder(); b.apply({ type: 'start' }); const id = b.send(); b.apply({ type: 'deliver-request', packetId: id }); b.apply({ type: 'deliver-response', packetId: id })
    const crashed = b.apply({ type: 'crash' }); expect(crashed.journal.reserve).toBeUndefined(); expect(crashed.resource.reserved).toBe(1); expect(crashed.packets[0]!.response).toBe('ignored')
    b.apply({ type: 'restart' }); const s = b.finish(b.send())
    expect(s.resource.reserved).toBe(1); expect(s.packets[1]!.replayed).toBe(true); expect(s.journal.reserve).toBe('ok')
  })
  it('timeouts preserve old requests, and budget attention does not resolve an unknown result', () => {
    const b = builder({ ...config, maxAttempts: 2 }); b.apply({ type: 'start' }); const old = b.send(); b.apply({ type: 'advance', ms: 500 }); const newer = b.send(); const attention = b.apply({ type: 'advance', ms: 500 })
    expect(attention.phase).toBe('attention'); expect(attention.resource.reserved).toBe(0)
    const late = b.apply({ type: 'deliver-request', packetId: old }); expect(late.resource.reserved).toBe(1)
    b.apply({ type: 'deliver-response', packetId: old }); b.apply({ type: 'resume-review' }); b.finish(b.send()); b.apply({ type: 'deliver-request', packetId: newer }); const s = b.apply({ type: 'deliver-response', packetId: newer })
    expect(s.resource.reserved).toBe(1); expect(s.packets.find((p) => p.id === newer)!.response).toBe('ignored')
  })
  it('an earlier timeout cannot prematurely exhaust a later attempt deadline', () => {
    const b = builder({ ...config, maxAttempts: 2 }); b.apply({ type: 'start' }); b.send(); b.apply({ type: 'crash' }); b.apply({ type: 'advance', ms: 100 }); b.apply({ type: 'restart' }); b.send()
    expect(b.apply({ type: 'advance', ms: 400 }).phase).toBe('forward')
    expect(b.apply({ type: 'advance', ms: 100 }).phase).toBe('attention')
  })
  it('only compensates recorded successful steps in reverse business order', () => {
    const b = builder(); b.apply({ type: 'start' }); b.finish(b.send()); b.apply({ type: 'block', operation: 'transcode' }); const failed = b.finish(b.send())
    expect(nextOperation(failed)).toBe('release')
    const s = b.finish(b.send()); expect(s.phase).toBe('compensated'); expect(s.resource.transcodeWork).toBe(0); expect(s.packets.some((p) => p.operation === 'cleanup')).toBe(false)
  })
  it('unavailable compensation is retryable; repair does not mutate prior results or complete the journal', () => {
    const commands = scenarioCommands(config, 'compensation-failure')
    const repair = commands.findIndex((c) => c.type === 'repair')
    const stopped = run(commands.slice(0, repair)); expect(stopped.phase).toBe('attention'); expect(stopped.resource.artifacts).toBe(1)
    const fixed = run(commands.slice(0, repair + 1)); expect(fixed.phase).toBe('attention'); expect(fixed.resource.artifacts).toBe(1)
    expect(fixed.dedupe.cleanup).toBeUndefined()
    expect(fixed.packets.filter((p) => p.operation === 'cleanup').every((p) => p.outcome === 'unavailable')).toBe(true)
  })
  it('rejects invalid steps and early retries, without fabricating progress', () => {
    expect(() => run([{ type: 'send' }])).toThrow('当前不能重试')
    expect(() => run([{ type: 'start' }, { type: 'send' }, { type: 'send' }])).toThrow('当前不能重试')
    expect(() => run([{ type: 'start' }, { type: 'send' }, { type: 'deliver-request', packetId: 'call-1' }, { type: 'checkpoint', packetId: 'call-1' }])).toThrow('收到的响应')
    expect(() => run([{ type: 'advance', ms: 10001 }])).toThrow('推进时间')
    expect(() => runModel({ ...config, modelVersion: 'future' } as never, [])).toThrow('版本')
    expect(canSend(run([]), config)).toBe(false)
  })
})
describe('saga lesson evidence', () => {
  it.each(['response-lost', 'coordinator-crash', 'compensation-failure'] as const)('grades actual business correction for %s', (scenario) => {
    const d = { ...initialDraft(), scenario, config, commands: scenarioCommands(config, scenario), prediction: 'unknown', phaseAnswer: 'compensated', quotaAnswer: '1', artifactsAnswer: '0', workAnswer: '1', reasonAnswer: 'business-correction' }
    const a = runAttempt(d)
    expect(a.evaluation).toMatchObject({ status: 'pass', explanation: true, settled: true })
    expect(verifyAttempt(a)).toBe(true)
    expect(verifyAttempt({ ...a, result: { ...a.result, events: [] } })).toBe(false)
    expect(verifyAttempt({ ...a, exerciseVersion: 2 })).toBe(false)
    expect(runAttempt({ ...d, reasonAnswer: 'global-rollback' }).evaluation.explanation).toBe(false)
  })
  it('rejects duplicate refunds, no work and tampered evidence', () => {
    const d = { ...initialDraft(), config: { ...config, idempotent: false } }; d.commands = scenarioCommands(d.config, 'response-lost')
    expect(runAttempt(d).evaluation.task).toBe(false)
    expect(runAttempt(initialDraft()).evaluation.status).toBe('inconclusive')
    expect(evaluate(d, { ...run(d.commands, d.config), resource: { reserved: 1, released: 1, artifacts: 0, transcodeWork: 1, published: false } }).evidence).toBe(false)
  })
})
