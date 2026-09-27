import { expect,it } from 'vitest'
import { defaultConfig,runModel,violations } from './model'
import { lesson,scenarioConfig,script } from './lesson'
it('distinguishes authenticated identity from actual object permission',()=>{
  const unsafe=runModel(defaultConfig(),script('ownership'));expect(unsafe.observations[2]).toMatchObject({expected:false,allowed:true,data:'B-content'});expect(violations(unsafe)).toHaveLength(1)
  const safe=runModel({...defaultConfig(),check:'resource'},script('ownership'));expect(safe.observations.map(o=>o.allowed)).toEqual([true,true,false,true]);expect(safe.policyChecks).toBe(3)
})
it('rejects revoked grants and does not use policy versions as a substitute for binding cache keys',()=>{
  const c=scenarioConfig('revocation');expect(violations(runModel(c,script('revocation')))).toHaveLength(1)
  const current=runModel({...c,cache:'version'},script('revocation'));expect(violations(current)).toHaveLength(0);expect(current.observations[2]!.data).toBeNull()
  const wrongKey=runModel({...c,cache:'version',key:'user'},script('scope'));expect(violations(wrongKey)).toHaveLength(1)
})
it('retains old data disclosures in evidence after a later permission change',()=>{
  const s=runModel({...defaultConfig(),check:'resource'},[{type:'read',user:'alice',resource:'a'},{type:'revoke',user:'alice',resource:'a'},{type:'read',user:'alice',resource:'a'},{type:'advance',ms:101},{type:'read',user:'alice',resource:'a'}])
  expect(s.observations.map(o=>o.data)).toEqual(['A-content','A-content',null]);expect(violations(s)).toHaveLength(1)
})
it('checks all fixed scenarios and rejects fabricated permission results',()=>{
  for(const scenario of ['ownership','revocation','scope']){const d={...lesson.initial(),scenario,config:{...defaultConfig(),check:'resource' as const,cache:'version' as const},commands:script(scenario)};const copy=structuredClone(d);const a=lesson.runAttempt(d);expect(a.evaluation.task).toBe(true);expect(d).toEqual(copy);expect(lesson.verifyAttempt(JSON.parse(JSON.stringify(a)))).toBe(true);a.result.observations[0]!.data='changed';expect(lesson.verifyAttempt(a)).toBe(false)}
  expect(()=>runModel(defaultConfig(),Array(41).fill({type:'advance',ms:1}))).toThrow('预算')
})
