import { describe, expect, it } from 'vitest'
import { dispatchDesign, runDispatch } from './dispatch'

describe('dispatch product model', () => {
  const safe = dispatchDesign.alternatives[0]!.config
  for (const scenario of dispatchDesign.scenarios) it(`exposes the unsafe result and accepts guarded execution for ${scenario.id}`, () => {
    expect(scenario.check(runDispatch(dispatchDesign.initialConfig, scenario.script)).some((c) => !c.pass)).toBe(true)
    for (const alternative of dispatchDesign.alternatives) expect(scenario.check(runDispatch(alternative.config, scenario.script))).toSatisfy((checks: { pass: boolean }[]) => checks.every((c) => c.pass))
  })
  it('records both effects of unguarded competition instead of overwriting the evidence', () => {
    const result = runDispatch(dispatchDesign.initialConfig, ['lookup-r1', 'lookup-r2', 'offer-r1', 'offer-r2', 'confirm-r1', 'confirm-r2'])
    expect(result.metrics).toMatchObject({ matchedTrips: 2, driverDuplicates: 1, assignments: 2 })
    expect(result.state.assignments.map((row) => row.driver)).toEqual(['D1', 'D1'])
  })
  it('checks freshness at reservation too, and treats exact lease expiry as expired', () => {
    const stale = runDispatch(safe, ['lookup-r1', 'tick', 'offer-r1', 'confirm-r1'])
    expect(stale.metrics).toMatchObject({ assignments: 0, conflicts: 1 })
    const expired = runDispatch(safe, ['lookup-r1', 'offer-r1', 'tick', 'tick', 'confirm-r1'])
    expect(expired.metrics).toMatchObject({ assignments: 0, staleRejected: 1, expirations: 1 })
  })
  it('does not infer actual driver movement before a report arrives', () => {
    const result = runDispatch(safe, ['move-d1', 'lookup-r1', 'offer-r1', 'confirm-r1'])
    expect(result.metrics.staleAccepted).toBe(0)
    expect(result.metrics.outOfRange).toBe(1)
    expect(result.state.assignments[0]!.driver).toBe('D1')
  })
  it('exposes the availability tradeoff between 500 ms and 1000 ms policies', () => {
    const commands = ['tick-half', 'lookup-r1', 'offer-r1', 'confirm-r1']
    expect(runDispatch(safe, commands).metrics.matchedTrips).toBe(1)
    expect(runDispatch({ ...safe, freshness: '500' }, commands).metrics.matchedTrips).toBe(0)
  })
  it('does not award the movement scenario for a match completed before movement', () => {
    const result = runDispatch(safe, ['lookup-r1', 'offer-r1', 'confirm-r1', 'move-d1', 'tick', 'tick'])
    expect(dispatchDesign.scenarios[1]!.check(result).some((c) => !c.pass)).toBe(true)
    expect(() => runDispatch(safe, ['lookup-unknown'])).toThrow()
  })
})
