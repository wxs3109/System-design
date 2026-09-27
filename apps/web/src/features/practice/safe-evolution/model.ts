import { parseChoiceConfig } from '../../../core/experiments/choice-input'
export const MAX_COMMANDS=40
export type Id='r1'|'r2'
export interface Config {modelVersion:'safe-evolution-v1';reader:'strict'|'compatible';writer:'renamed'|'dual';migration:'replace'|'expand'}
export type Command={type:'deploy'|'rollback'}|{type:'write';id:Id;value:'blue'|'green'}|{type:'migrate';id:Id}|{type:'read';id:Id;reader:'old'|'new'|'active'}
export interface WireRecord {name?:string;displayName?:string}
export interface Read {id:Id;reader:1|2;wire:WireRecord|null;expected:string|null;actual:string|null;correct:boolean}
export interface State {modelVersion:'safe-evolution-v1';activeVersion:1|2;records:Partial<Record<Id,WireRecord>>;expected:Partial<Record<Id,string>>;reads:Read[];events:{index:number;at:number;kind:Command['type'];subject:string}[]}
export const defaultConfig=():Config=>({modelVersion:'safe-evolution-v1',reader:'strict',writer:'renamed',migration:'replace'})
export const parseConfig=(v:unknown)=>parseChoiceConfig<Config>(v,{modelVersion:['safe-evolution-v1'],reader:['strict','compatible'],writer:['renamed','dual'],migration:['replace','expand']})
export function parseCommand(value:unknown):Command {const c=value as Command|null;if(!c)throw new Error('演进操作缺失。');if(c.type==='deploy'||c.type==='rollback')return {type:c.type};if(!('id'in c)||!['r1','r2'].includes(c.id))throw new Error('记录 ID 无效。');if(c.type==='migrate')return {type:c.type,id:c.id};if(c.type==='write'&&['blue','green'].includes(c.value))return {type:c.type,id:c.id,value:c.value};if(c.type==='read'&&['old','new','active'].includes(c.reader))return {type:c.type,id:c.id,reader:c.reader};throw new Error('演进操作无效。')}
export function counts(s:State,version:1|2){const reads=s.reads.filter(r=>r.reader===version);return {total:reads.length,good:reads.filter(r=>r.correct).length}}
export function runModel(input:Config,operations:readonly Command[]):State {
  const c=parseConfig(input);if(!Array.isArray(operations)||operations.length>MAX_COMMANDS)throw new Error('超过 40 步操作预算。')
  const s:State={modelVersion:c.modelVersion,activeVersion:1,records:{r1:{name:'blue'}},expected:{r1:'blue'},reads:[],events:[]}
  for(const command of operations.map(parseCommand)){
    if(command.type==='deploy')s.activeVersion=2
    else if(command.type==='rollback')s.activeVersion=1
    else if(command.type==='write'){s.records[command.id]=s.activeVersion===1?{name:command.value}:c.writer==='dual'?{name:command.value,displayName:command.value}:{displayName:command.value};s.expected[command.id]=command.value}
    else if(command.type==='migrate'){const row=s.records[command.id];const value=row?.name??row?.displayName;if(row&&value!==undefined)s.records[command.id]=c.migration==='expand'?{...row,displayName:value}:{displayName:value}}
    else if(command.type==='read'){
      const reader=command.reader==='active'?s.activeVersion:command.reader==='old'?1:2;const row=s.records[command.id]
      const actual=(reader===1?row?.name:c.reader==='strict'?row?.displayName:row?.displayName??row?.name)??null;const expected=s.expected[command.id]??null
      s.reads.push({id:command.id,reader,wire:row?{...row}:null,expected,actual,correct:actual===expected})
    }
    s.events.push({index:s.events.length+1,at:s.events.length,kind:command.type,subject:'id'in command?command.id:`version-${s.activeVersion}`})
  }
  return s
}
