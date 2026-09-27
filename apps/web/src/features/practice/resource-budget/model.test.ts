import { expect, it } from 'vitest'
import { defaultConfig, derive, runModel } from './model'
import { lesson, scenarioConfig, script } from './lesson'
it('derives dimensions without confusing users, requests, reads and retained writes', () => {
  expect(derive(defaultConfig())).toMatchObject({ dailyRequests: 86400, averageRps: 1, peakRps: 10, responseBytesPerSecond: 9001000, responseMbps: 72.008, dailyWrites: 8640, logicalBytes: 259200000, copiedBytes: 777600000 })
})
it('executes the same demand through shared resources and preserves work when the wrong resource is expanded', () => {
  const base = runModel(defaultConfig(), script)
  const moreCpu = runModel({ ...defaultConfig(), computeSlots: 4 }, script)
  const moreNetwork = runModel({ ...defaultConfig(), bandwidthMbps: 80 }, script)
  expect(base.requests).toHaveLength(50); expect(base.requests.at(-1)!.finishedAt).toBe(45155)
  expect(moreCpu.requests.map(r => r.finishedAt)).toEqual(base.requests.map(r => r.finishedAt))
  expect(moreNetwork.latencyP95Ms).toBe(250)
  const disk = scenarioConfig('storage')
  expect(runModel(disk, script).latencyP95Ms).toBeGreaterThan(250)
  expect(runModel({ ...disk, storageSlots: 2 }, script).latencyP95Ms).toBe(160)
})
it('preserves causality, pool exclusivity and deterministic JSON evidence', () => {
  const config = scenarioConfig('storage'); const copy = structuredClone(config); const s = runModel(config, script)
  expect(config).toEqual(copy); expect(runModel(config, script)).toEqual(JSON.parse(JSON.stringify(s)))
  for (const r of s.requests) { expect(r.stages[0]!.queuedAt).toBe(r.arrival); for (let i = 0; i < r.stages.length; i++) { const t = r.stages[i]!; expect(t.startedAt).toBeGreaterThanOrEqual(t.queuedAt); if (i) expect(t.queuedAt).toBe(r.stages[i-1]!.finishedAt) } }
  const previous = new Map<string, number>()
  for (const r of s.requests) for (const t of r.stages) { const k = `${t.resource}:${t.slot}`; expect(t.startedAt).toBeGreaterThanOrEqual(previous.get(k) ?? 0); previous.set(k, t.finishedAt) }
  expect(s.completedInWindow).toBeLessThan(s.requests.length)
})
it('requires fixed demand and actual samples, rejecting forged results and lower demand shortcuts', () => {
  const good = lesson.runAttempt({ ...lesson.initial(), scenario: 'network', config: { ...defaultConfig(), bandwidthMbps: 80 }, commands: script })
  expect(good.evaluation.task).toBe(true); expect(lesson.verifyAttempt(good)).toBe(true)
  good.result.requests[0]!.finishedAt = 0; expect(lesson.verifyAttempt(good)).toBe(false)
  expect(lesson.runAttempt({ ...lesson.initial(), scenario: 'network', config: { ...defaultConfig(), peakFactor: 1 }, commands: script }).evaluation.task).toBe(false)
  expect(lesson.runAttempt({ ...lesson.initial(), commands: [{ type: 'derive' }] }).evaluation.task).toBe(false)
  expect(() => runModel(defaultConfig(), Array(9).fill({ type: 'sample' }))).toThrow('预算')
})
