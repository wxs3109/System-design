import { expect,it } from 'vitest'
import { defaultConfig,runModel,staleReads } from './model'
import { lesson,script } from './lesson'
it('demonstrates stale hits and rejects late fills without invalidating legitimate overlapping reads',()=>{
  for(const policy of ['ttl','invalidate','versioned'] as const){const c={...defaultConfig(),policy};const s=runModel(c,script(c,'fill'));expect(s.reads[0]).toMatchObject({minimumVersion:1,version:1,value:10});expect(staleReads(s).length).toBe(policy==='versioned'?0:1);if(policy==='versioned')expect(s.flights[0]!.filled).toBe(false)}
  const c={...defaultConfig(),policy:'invalidate' as const};expect(staleReads(runModel(c,script(c,'stale')))).toHaveLength(0)
})
it('coalesces actual concurrent misses while retaining all callers and their results',()=>{
  const c={...defaultConfig(),coalesce:true};const merged=runModel(c,script(c,'herd'));const separate=runModel(defaultConfig(),script(defaultConfig(),'herd'))
  expect(merged.reads).toHaveLength(4);expect(merged.flights).toHaveLength(2);expect(separate.flights).toHaveLength(4)
  expect(merged.reads.every(r=>r.value===10&&r.completedAt!==null)).toBe(true);expect(merged.flights[1]!.waiters).toEqual([2,3,4])
})
it('does not join a newer read to an older in-flight version',()=>{
  const c={...defaultConfig(),policy:'versioned' as const,coalesce:true};const s=runModel(c,[{type:'read',client:'A'},{type:'write'},{type:'read',client:'B'},{type:'complete',flight:1},{type:'complete',flight:2}])
  expect(s.flights).toHaveLength(2);expect(s.reads.map(r=>r.value)).toEqual([10,20]);expect(staleReads(s)).toHaveLength(0)
})
it('grades fixed business demands, bounds commands and rejects tampered evidence',()=>{
  for(const scenario of ['stale','fill','herd']){const config={...defaultConfig(),policy:'versioned' as const,coalesce:true};const d={...lesson.initial(),scenario,config,commands:script(config,scenario)};const copy=structuredClone(d);const a=lesson.runAttempt(d);expect(a.evaluation.task).toBe(true);expect(d).toEqual(copy);expect(lesson.verifyAttempt(JSON.parse(JSON.stringify(a)))).toBe(true);a.result.reads[0]!.value=999;expect(lesson.verifyAttempt(a)).toBe(false)}
  const c=defaultConfig();expect(lesson.runAttempt({...lesson.initial(),scenario:'herd',commands:script(c,'herd')}).evaluation.task).toBe(false)
  expect(()=>runModel(c,Array(41).fill({type:'write'}))).toThrow('预算')
})
