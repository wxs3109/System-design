import { expect, it } from 'vitest'
import { dataContract, defaultConfig, runModel } from './model'
import { correct, lesson, script } from './lesson'
it('returns the same actual rows with bounded indexed work and explicit scan fallback', () => {
  for (const path of ['scan','primary','ordered'] as const) {
    const c = {...defaultConfig(),path}
    const point = runModel(c,script('point')).queries[0]!
    expect(point.rows).toEqual([{id:'r07',owner:'u3',time:7,value:70}]); expect(point.rowsExamined).toBe(path==='scan'?16:1)
    const range = runModel(c,script('range')).queries[0]!
    expect(range.rows.map(r=>r.id)).toEqual(['r01','r05','r09','r13']); expect(range.rowsExamined).toBe(path==='ordered'?4:16)
  }
})
it('keeps stale query evidence after repair and records the extra maintenance work', () => {
  const stale = runModel({...defaultConfig(),path:'ordered',maintenance:'deferred'},script('maintenance'))
  expect(stale.queries.map(correct)).toEqual([true,false,true])
  expect(stale.queries[1]!.rows.map(r=>r.id)).toEqual(['r02','r06','r10','r14'])
  expect(stale.queries[2]!.rows.map(r=>r.id)).toEqual(['r02','r06','r05','r10','r14'])
  const inline = runModel({...defaultConfig(),path:'ordered'},script('maintenance'))
  expect(inline.queries.every(correct)).toBe(true)
  expect(inline.indexWrites+inline.indexRemovals).toBeGreaterThan(stale.indexWrites+stale.indexRemovals)
})
it('preserves answers while reducing unnecessary payload reads and reuses the data contract', () => {
  const c = {...defaultConfig(),path:'ordered' as const}
  const large = runModel(c,script('payload')).queries[0]!
  const small = runModel({...c,layout:'split'},script('payload')).queries[0]!
  expect(small.rows).toEqual(large.rows); expect(small.bytesRead).toBeLessThan(1000); expect(large.bytesRead).toBeGreaterThan(1000)
  expect(dataContract(c).tables[0]?.indexes[0]?.columnIds).toEqual(['owner','time','id'])
})
it('grades evidence, not an index name, and rejects forged or incomplete results', () => {
  for (const scenario of ['point','range','maintenance','payload']) {
    const draft={...lesson.initial(),scenario,config:{...defaultConfig(),path:'ordered' as const,layout:'split' as const},commands:script(scenario)}
    const copy=structuredClone(draft); const a=lesson.runAttempt(draft)
    expect(draft).toEqual(copy); expect(a.evaluation.task).toBe(true); expect(lesson.verifyAttempt(JSON.parse(JSON.stringify(a)))).toBe(true)
    a.result.queries[0]!.rows=[]; expect(lesson.verifyAttempt(a)).toBe(false)
  }
  expect(lesson.runAttempt({...lesson.initial(),scenario:'maintenance',config:{...defaultConfig(),path:'ordered',maintenance:'deferred'},commands:script('maintenance')}).evaluation.task).toBe(false)
  expect(()=>runModel(defaultConfig(),Array(31).fill({type:'refresh'}))).toThrow('预算')
})
