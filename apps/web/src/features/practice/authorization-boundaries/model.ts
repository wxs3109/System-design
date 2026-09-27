import { parseChoiceConfig } from '../../../core/experiments/choice-input'
export const MAX_COMMANDS = 40
export type User = 'alice' | 'bob'
export type Resource = 'a' | 'b'
export interface Config { modelVersion:'authorization-boundaries-v1'; check:'identity'|'resource'; cache:'none'|'ttl'|'version'; key:'user'|'resource' }
export type Command = {type:'read'|'grant'|'revoke';user:User;resource:Resource}|{type:'advance';ms:number}
export interface Observation {user:User;resource:Resource;expected:boolean;allowed:boolean;data:string|null;policyVersion:number;cached:boolean}
export interface State {modelVersion:'authorization-boundaries-v1';now:number;policyVersion:number;grants:Record<string,boolean>;cache:Record<string,{allowed:boolean;version:number;expiresAt:number}>;policyChecks:number;observations:Observation[];events:{index:number;at:number;kind:Command['type'];subject:string}[]}
export const resources = {a:{owner:'alice',data:'A-content'},b:{owner:'bob',data:'B-content'}} as const
export const defaultConfig=():Config=>({modelVersion:'authorization-boundaries-v1',check:'identity',cache:'ttl',key:'resource'})
export const parseConfig=(value:unknown)=>parseChoiceConfig<Config>(value,{modelVersion:['authorization-boundaries-v1'],check:['identity','resource'],cache:['none','ttl','version'],key:['user','resource']})
export function parseCommand(value:unknown):Command {
  const c=value as Command|null
  if(!c)throw new Error('授权操作缺失。')
  if(c.type==='advance'){if(!Number.isSafeInteger(c.ms)||c.ms<1||c.ms>1000)throw new Error('时间无效。');return {type:c.type,ms:c.ms}}
  if(['read','grant','revoke'].includes(c.type)&&['alice','bob'].includes(c.user)&&['a','b'].includes(c.resource))return {type:c.type,user:c.user,resource:c.resource}
  throw new Error('授权操作无效。')
}
export const violations=(s:State)=>s.observations.filter(o=>o.allowed!==o.expected)
export function runModel(input:Config,operations:readonly Command[]):State {
  const c=parseConfig(input);if(!Array.isArray(operations)||operations.length>MAX_COMMANDS)throw new Error('超过 40 步操作预算。')
  const s:State={modelVersion:c.modelVersion,now:0,policyVersion:1,grants:{'alice:a':true,'bob:b':true},cache:{},policyChecks:0,observations:[],events:[]}
  for(const command of operations.map(parseCommand)){
    s.now+=command.type==='advance'?command.ms:1
    if(command.type==='grant'||command.type==='revoke'){s.grants[`${command.user}:${command.resource}`]=command.type==='grant';s.policyVersion++}
    else if(command.type==='read'){
      const expected=resources[command.resource].owner===command.user&&s.grants[`${command.user}:${command.resource}`]===true
      const key=c.key==='user'?command.user:`${command.user}:${command.resource}`
      const entry=s.cache[key];let allowed=true;let cached=false
      if(c.check==='resource'){
        if(c.cache!=='none'&&entry&&entry.expiresAt>s.now&&(c.cache!=='version'||entry.version===s.policyVersion)){allowed=entry.allowed;cached=true}
        else {s.policyChecks++;allowed=expected;if(c.cache!=='none')s.cache[key]={allowed,version:s.policyVersion,expiresAt:s.now+100}}
      }
      s.observations.push({user:command.user,resource:command.resource,expected,allowed,data:allowed?resources[command.resource].data:null,policyVersion:s.policyVersion,cached})
    }
    s.events.push({index:s.events.length+1,at:s.now,kind:command.type,subject:command.type==='advance'?'clock':`${command.user}:${command.resource}`})
  }
  return s
}
