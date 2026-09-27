import { expect,it } from 'vitest'
import { counts,defaultConfig,runModel } from './model'
import { lesson,script } from './lesson'
it('exposes new-reader failures which an aggregate rate would dilute',()=>{
  const s=runModel(defaultConfig(),script('mixed'));expect(counts(s,1)).toEqual({total:8,good:8});expect(counts(s,2)).toEqual({total:2,good:0})
  expect(runModel({...defaultConfig(),reader:'compatible'},script('mixed')).reads.every(r=>r.correct)).toBe(true)
})
it('does not magically restore data fields when code rolls back',()=>{
  const s=runModel(defaultConfig(),script('rollback'));expect(s.activeVersion).toBe(1);expect(s.records.r2).toEqual({displayName:'green'});expect(s.reads.at(-1)?.actual).toBeNull()
  const dual=runModel({...defaultConfig(),writer:'dual'},script('rollback'));expect(dual.reads.map(r=>r.actual)).toEqual(['green','green'])
})
it('migrates actual stored values and keeps both readers working only while needed fields remain',()=>{
  const replace=runModel(defaultConfig(),script('migration'));expect(replace.records.r1).toEqual({displayName:'blue'});expect(replace.reads.map(r=>r.correct)).toEqual([false,true])
  const expand=runModel({...defaultConfig(),migration:'expand'},script('migration'));expect(expand.records.r1).toEqual({name:'blue',displayName:'blue'});expect(expand.reads.every(r=>r.correct)).toBe(true)
})
it('recomputes compatibility evidence and rejects shortcuts, forged fields and excessive operations',()=>{
  for(const scenario of ['mixed','rollback','migration']){const d={...lesson.initial(),scenario,config:{...defaultConfig(),reader:'compatible' as const,writer:'dual' as const,migration:'expand' as const},commands:script(scenario)};const copy=structuredClone(d);const a=lesson.runAttempt(d);expect(a.evaluation.task).toBe(true);expect(d).toEqual(copy);expect(lesson.verifyAttempt(JSON.parse(JSON.stringify(a)))).toBe(true);a.result.records.r1={name:'tampered'};expect(lesson.verifyAttempt(a)).toBe(false)}
  expect(()=>runModel(defaultConfig(),Array(41).fill({type:'rollback'}))).toThrow('预算')
})
