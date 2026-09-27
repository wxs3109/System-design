import { parseChoiceConfig } from '../../../core/experiments/choice-input'
export const MAX_COMMANDS=40
export interface Config { modelVersion:'cache-coherence-v1'; policy:'ttl'|'invalidate'|'versioned'; coalesce:boolean; ttl:20|100 }
export type Command={type:'read';client:'A'|'B'|'C'}|{type:'complete';flight:number}|{type:'write'}|{type:'advance';ms:number}
export interface Read {id:number;client:string;minimumVersion:number;startedAt:number;completedAt:number|null;value:number|null;version:number|null;source:'cache'|'origin'|null}
export interface Flight {id:number;version:number;value:number;waiters:number[];pending:boolean;filled:boolean|null}
export interface State {modelVersion:'cache-coherence-v1';now:number;origin:{version:number;value:number};versions:{version:number;value:number}[];cache:{version:number;value:number;expiresAt:number}|null;reads:Read[];flights:Flight[];expirations:number;events:{index:number;at:number;kind:Command['type'];subject:string}[]}
export const defaultConfig=():Config=>({modelVersion:'cache-coherence-v1',policy:'ttl',coalesce:false,ttl:20})
export const parseConfig=(v:unknown)=>parseChoiceConfig<Config>(v,{modelVersion:['cache-coherence-v1'],policy:['ttl','invalidate','versioned'],coalesce:[false,true],ttl:[20,100]})
export function parseCommand(value:unknown):Command {const c=value as Command|null;if(!c)throw new Error('缓存操作缺失。');if(c.type==='write')return {type:c.type};if(c.type==='read'&&['A','B','C'].includes(c.client))return {type:c.type,client:c.client};if(c.type==='complete'&&Number.isSafeInteger(c.flight)&&c.flight>0&&c.flight<=40)return {type:c.type,flight:c.flight};if(c.type==='advance'&&Number.isSafeInteger(c.ms)&&c.ms>0&&c.ms<=1000)return {type:c.type,ms:c.ms};throw new Error('缓存操作无效。')}
export function staleReads(s:State){return s.reads.filter(r=>r.completedAt!==null&&((r.version??0)<r.minimumVersion||s.versions.find(v=>v.version===r.version)?.value!==r.value))}
export function runModel(input:Config,operations:readonly Command[]):State {
  const c=parseConfig(input);if(!Array.isArray(operations)||operations.length>MAX_COMMANDS)throw new Error('超过 40 步操作预算。')
  const s:State={modelVersion:c.modelVersion,now:0,origin:{version:1,value:10},versions:[{version:1,value:10}],cache:null,reads:[],flights:[],expirations:0,events:[]}
  for(const command of operations.map(parseCommand)) {
    s.now+=command.type==='advance'?command.ms:1
    if(command.type==='write'){s.origin={version:s.origin.version+1,value:s.origin.value+10};s.versions.push({...s.origin});if(c.policy!=='ttl')s.cache=null}
    else if(command.type==='read') {
      if(s.cache&&s.cache.expiresAt<=s.now){s.cache=null;s.expirations++}
      const r:Read={id:s.reads.length+1,client:command.client,minimumVersion:s.origin.version,startedAt:s.now,completedAt:null,value:null,version:null,source:null};s.reads.push(r)
      if(s.cache){r.completedAt=s.now;r.value=s.cache.value;r.version=s.cache.version;r.source='cache'}
      else {
        const existing=c.coalesce?s.flights.find(f=>f.pending&&(c.policy!=='versioned'||f.version===s.origin.version)):undefined
        if(existing)existing.waiters.push(r.id)
        else s.flights.push({id:s.flights.length+1,...s.origin,waiters:[r.id],pending:true,filled:null})
      }
    } else if(command.type==='complete') {
      const f=s.flights.find(f=>f.id===command.flight&&f.pending)
      if(f){f.pending=false;f.filled=c.policy!=='versioned'||f.version===s.origin.version;if(f.filled)s.cache={version:f.version,value:f.value,expiresAt:s.now+c.ttl};for(const id of f.waiters){const r=s.reads.find(r=>r.id===id)!;r.value=f.value;r.version=f.version;r.completedAt=s.now;r.source='origin'}}
    }
    s.events.push({index:s.events.length+1,at:s.now,kind:command.type,subject:command.type==='read'?command.client:command.type==='complete'?String(command.flight):'item'})
  }
  return s
}
