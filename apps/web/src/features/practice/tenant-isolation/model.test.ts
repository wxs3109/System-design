import { expect,it } from 'vitest'
import { counts,defaultConfig,runModel } from './model'
import { lesson,script } from './lesson'
it('keeps all original demand and exposes small tenant rejection despite high total completion',()=>{
  const s=runModel(defaultConfig(),script);expect(counts(s,'A')).toMatchObject({offered:8,completed:6,rejected:2});expect(counts(s,'B')).toMatchObject({offered:2,completed:0,rejected:2});expect(s.jobs).toHaveLength(10)
})
it('separates admission protection from scheduling latency and accounts for idle time',()=>{
  const c={...defaultConfig(),admission:'reserved' as const};const fifo=runModel(c,script);const fair=runModel({...c,schedule:'round-robin'},script)
  expect(counts(fifo,'B')).toMatchObject({completed:2,onTime:1});expect(counts(fair,'B')).toMatchObject({completed:2,onTime:2})
  expect(fair.jobs.filter(j=>j.tenant==='B').map(j=>j.finishedAt)).toEqual([20,40]);expect(fair.now).toBe(60);expect(fair.idleMs).toBe(10)
  expect(fair.jobs.filter(j=>j.status==='completed').length*10+fair.idleMs).toBe(fair.now)
})
it('grades per-tenant evidence with fixed demand and rejects tampering and budgets',()=>{
  const d={...lesson.initial(),scenario:'latency',config:{...defaultConfig(),admission:'reserved' as const,schedule:'round-robin' as const},commands:script};const copy=structuredClone(d);const a=lesson.runAttempt(d)
  expect(a.evaluation.task).toBe(true);expect(d).toEqual(copy);expect(lesson.verifyAttempt(JSON.parse(JSON.stringify(a)))).toBe(true)
  a.result.jobs[0]!.finishedAt=0;expect(lesson.verifyAttempt(a)).toBe(false)
  expect(lesson.runAttempt({...d,commands:[{type:'submit',tenant:'B',count:2},{type:'tick'},{type:'tick'}]}).evaluation.task).toBe(false)
  expect(()=>runModel(defaultConfig(),Array(6).fill({type:'submit',tenant:'A',count:8}))).toThrow('作业预算')
})
