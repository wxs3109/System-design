import { parseChoiceConfig } from '../../../core/experiments/choice-input'
export const MAX_COMMANDS=40
export interface Config {modelVersion:'tenant-isolation-v1';admission:'shared'|'reserved';schedule:'fifo'|'round-robin'}
export type Command={type:'submit';tenant:'A'|'B';count:1|2|8}|{type:'tick'}
export interface Job {id:number;tenant:'A'|'B';createdAt:number;status:'queued'|'completed'|'rejected';startedAt:number|null;finishedAt:number|null}
export interface State {modelVersion:'tenant-isolation-v1';now:number;jobs:Job[];lastTenant:'A'|'B'|null;idleMs:number;events:{index:number;at:number;kind:Command['type'];subject:string}[]}
export const defaultConfig=():Config=>({modelVersion:'tenant-isolation-v1',admission:'shared',schedule:'fifo'})
export const parseConfig=(v:unknown)=>parseChoiceConfig<Config>(v,{modelVersion:['tenant-isolation-v1'],admission:['shared','reserved'],schedule:['fifo','round-robin']})
export function parseCommand(value:unknown):Command {const c=value as Command|null;if(c?.type==='tick')return {type:c.type};if(c?.type==='submit'&&['A','B'].includes(c.tenant)&&[1,2,8].includes(c.count))return {type:c.type,tenant:c.tenant,count:c.count};throw new Error('租户工作操作无效。')}
export function counts(s:State,tenant:'A'|'B'){const jobs=s.jobs.filter(j=>j.tenant===tenant);return {offered:jobs.length,rejected:jobs.filter(j=>j.status==='rejected').length,completed:jobs.filter(j=>j.status==='completed').length,onTime:jobs.filter(j=>j.finishedAt!==null&&j.finishedAt-j.createdAt<=40).length}}
export function runModel(input:Config,operations:readonly Command[]):State {
  const c=parseConfig(input);if(!Array.isArray(operations)||operations.length>MAX_COMMANDS)throw new Error('超过 40 步操作预算。')
  const s:State={modelVersion:c.modelVersion,now:0,jobs:[],lastTenant:null,idleMs:0,events:[]}
  for(const command of operations.map(parseCommand)){
    if(command.type==='submit'){
      if(s.jobs.length+command.count>40)throw new Error('超过 40 个作业预算。')
      for(let i=0;i<command.count;i++){
        const queued=s.jobs.filter(j=>j.status==='queued');const allowed=queued.length<6&&(c.admission==='shared'||queued.filter(j=>j.tenant===command.tenant).length<3)
        s.jobs.push({id:s.jobs.length+1,tenant:command.tenant,createdAt:s.now,status:allowed?'queued':'rejected',startedAt:null,finishedAt:null})
      }
    }else{
      const queued=s.jobs.filter(j=>j.status==='queued');const next=c.schedule==='fifo'?queued[0]:queued.find(j=>j.tenant!==s.lastTenant)??queued[0]
      if(next){next.startedAt=s.now;next.finishedAt=s.now+10;next.status='completed';s.lastTenant=next.tenant}else s.idleMs+=10
      s.now+=10
    }
    s.events.push({index:s.events.length+1,at:s.now,kind:command.type,subject:command.type==='submit'?command.tenant:'worker'})
  }
  return s
}
