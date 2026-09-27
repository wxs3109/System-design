import { describe, expect, it } from 'vitest'
import { defaultConfig, MAX_COMMANDS, missingAcknowledged, runModel, type Config } from './model'
import { lesson, measures, scenarioCommands } from './lesson'

describe('quality goals as bounded evidence', () => {
  it('shows why colocated replicas do not survive a domain failure', () => {
    const commands = scenarioCommands('availability')
    const single = runModel(defaultConfig(), commands)
    const shared = runModel({ ...defaultConfig(), replicas: 2 }, commands)
    const split = runModel({ ...defaultConfig(), replicas: 2, placement: 'separate' }, commands)
    expect(single.requests.map(r => r.status)).toEqual(['complete', 'unavailable', 'unavailable', 'complete'])
    expect(shared.requests.map(r => r.status)).toEqual(single.requests.map(r => r.status))
    expect(split.requests.map(r => r.instance)).toEqual(['service-1', 'service-2', 'service-2', 'service-2'])
    expect(measures(split, false)).toMatchObject({ offered: 4, good: 4, fraction: 1 })
  })
  it('separates a successful acknowledgement from actual recoverable records', () => {
    const commands = scenarioCommands('durability')
    const memory = runModel({ ...defaultConfig(), replicas: 2, placement: 'separate' }, commands)
    const durable = runModel({ ...defaultConfig(), acknowledgement: 'stable' }, commands)
    expect(memory.acknowledgements.map(a => a.recordId)).toEqual(['record-1', 'record-2'])
    expect(memory.storage.memory).toEqual([]); expect(missingAcknowledged(memory)).toEqual(['record-1', 'record-2'])
    expect(durable.storage.memory).toEqual(['record-1', 'record-2']); expect(missingAcknowledged(durable)).toEqual([])
    expect(durable.requests.map(r => r.status)).toEqual(['complete', 'complete', 'unavailable', 'complete'])
    expect(durable.requests[0]!.latencyMs).toBeGreaterThan(memory.requests[0]!.latencyMs)
  })
  it('counts degraded responses only when the demand permits them, without removing failures', () => {
    const result = runModel({ ...defaultConfig(), dependency: 'degrade' }, scenarioCommands('degradation'))
    expect(result.requests.map(r => r.status)).toEqual(['complete', 'degraded', 'degraded', 'complete'])
    expect(measures(result, true)).toMatchObject({ offered: 4, good: 4, full: 2, degraded: 2 })
    expect(measures(result, false)).toMatchObject({ offered: 4, good: 2, fraction: .5 })
    expect(measures(runModel(defaultConfig(), []), true).fraction).toBeNull()
  })
  it('replays deterministically, stays within budget, and never mutates inputs', () => {
    const config = defaultConfig(); const commands = scenarioCommands('durability'); const original = structuredClone([config, commands])
    const result = runModel(config, commands)
    expect(runModel(config, commands)).toEqual(result)
    expect([config, commands]).toEqual(original)
    expect(JSON.parse(JSON.stringify(result))).toEqual(result)
    expect(() => runModel(config, Array.from({ length: MAX_COMMANDS + 1 }, () => ({ type: 'read' as const })))).toThrow('预算')
    expect(() => runModel({ ...config, replicas: 3 } as unknown as Config, [])).toThrow('配置')
    expect(() => runModel(config, [{ type: 'invented' } as never])).toThrow('未知')
  })
  it('grades actual results across every strategy combination, retains counterexamples and rejects tampering', () => {
    for (const replicas of [1, 2] as const) for (const placement of ['shared', 'separate'] as const) for (const acknowledgement of ['memory', 'stable'] as const) for (const dependency of ['required', 'degrade'] as const) {
      const config: Config = { ...defaultConfig(), replicas, placement, acknowledgement, dependency }
      for (const scenario of ['availability', 'durability', 'degradation'] as const) {
        const draft = { ...lesson.initial(), config, scenario, commands: scenarioCommands(scenario) }
        const attempt = lesson.runAttempt(draft)
        expect(attempt.evaluation.task).toBe(scenario === 'availability' ? replicas === 2 && placement === 'separate' : scenario === 'durability' ? acknowledgement === 'stable' : dependency === 'degrade')
        expect(lesson.verifyAttempt(attempt)).toBe(true)
        attempt.result.requests[0]!.latencyMs = 0
        expect(lesson.verifyAttempt(attempt)).toBe(false)
      }
    }
    const shortcut = lesson.runAttempt({ ...lesson.initial(), commands: [{ type: 'read' }] })
    expect(shortcut.evaluation.task).toBe(false)
  })
})
