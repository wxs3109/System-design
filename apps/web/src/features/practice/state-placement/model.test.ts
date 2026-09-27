import { expect,it } from 'vitest'
import { defaultConfig,missingValues,runModel } from './model'
import { counts,lesson,script } from './lesson'
it('distinguishes normal affinity from shared state across actual instance changes',()=>{
  const rr=runModel(defaultConfig(),script('routing'));expect(rr.observations.map(o=>o.node)).toEqual(['A','B','A']);expect(rr.observations.map(o=>o.value)).toEqual([7,null,7])
  const sticky=runModel({...defaultConfig(),routing:'sticky'},script('routing'));expect(counts(sticky)).toEqual({reads:2,good:2,bad:0})
  const shared=runModel({...defaultConfig(),placement:'shared'},script('routing'));expect(shared.observations.map(o=>o.node)).toEqual(['A','B','A']);expect(counts(shared).good).toBe(2)
})
it('cannot recover local state merely by failing over or restarting a process',()=>{
  const c={...defaultConfig(),routing:'sticky' as const};const local=runModel(c,script('failover'))
  expect(local.observations.map(o=>o.value)).toEqual([7,null,null]);expect(missingValues(c,local)).toBe(1)
  const shared=runModel({...c,placement:'shared'},script('failover'));expect(counts(shared).good).toBe(2)
})
it('preserves unavailable reads separately from the durable recovery of shared state',()=>{
  const c={...defaultConfig(),placement:'shared' as const};const memory=runModel(c,script('recovery'));const stable=runModel({...c,persistence:'stable'},script('recovery'))
  expect(memory.observations.map(o=>o.status)).toEqual(['ok','unavailable','missing'])
  expect(stable.observations.map(o=>o.status)).toEqual(['ok','unavailable','ok'])
  expect(stable.store.stable).toEqual({u1:7});expect(missingValues({...c,persistence:'stable'},stable)).toBe(0)
})
it('verifies meaningful scripts, budgets and persisted evidence without changing inputs',()=>{
  for(const scenario of ['routing','failover','recovery']){
    const d={...lesson.initial(),scenario,config:{...defaultConfig(),placement:'shared' as const,persistence:'stable' as const},commands:script(scenario)};const copy=structuredClone(d);const a=lesson.runAttempt(d)
    expect(a.evaluation.task).toBe(true);expect(d).toEqual(copy);expect(lesson.verifyAttempt(JSON.parse(JSON.stringify(a)))).toBe(true)
    a.result.observations[0]!.value=8;expect(lesson.verifyAttempt(a)).toBe(false)
  }
  expect(lesson.runAttempt({...lesson.initial(),config:{...defaultConfig(),replicas:1},commands:script('routing')}).evaluation.task).toBe(false)
  expect(()=>runModel(defaultConfig(),Array(41).fill({type:'read',user:'u1'}))).toThrow('预算')
})
