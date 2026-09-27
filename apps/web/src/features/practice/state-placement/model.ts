import { parseChoiceConfig } from '../../../core/experiments/choice-input'
export const MAX_COMMANDS = 40
export type User = 'u1' | 'u2'
export interface Config { modelVersion: 'state-placement-v1'; replicas: 1 | 2; placement: 'local' | 'shared'; routing: 'round-robin' | 'sticky'; persistence: 'volatile' | 'stable' }
export type Command = { type: 'write'; user: User; value: number } | { type: 'read'; user: User } | { type: 'crash' | 'restart'; node: 'A' | 'B' } | { type: 'crash-store' | 'restart-store' }
export interface Observation { id: number; operation: 'read' | 'write'; user: User; node: string | null; value: number | null; expected: number | null; status: 'ok' | 'missing' | 'unavailable'; reason: 'service' | 'store' | null }
export interface State { modelVersion: 'state-placement-v1'; nodes: { id: string; online: boolean; local: Record<string,number> }[]; store: { online: boolean; memory: Record<string,number>; stable: Record<string,number> }; acknowledged: Record<string,number>; observations: Observation[]; events: {index:number;at:number;kind:Command['type'];subject:string}[] }
export const defaultConfig = ():Config => ({ modelVersion:'state-placement-v1',replicas:2,placement:'local',routing:'round-robin',persistence:'volatile' })
export const parseConfig = (v:unknown) => parseChoiceConfig<Config>(v,{modelVersion:['state-placement-v1'],replicas:[1,2],placement:['local','shared'],routing:['round-robin','sticky'],persistence:['volatile','stable']})
export function parseCommand(value:unknown):Command {
  const c=value as Command|null; if(!c) throw new Error('状态操作缺失。')
  if(c.type==='crash-store'||c.type==='restart-store')return {type:c.type}
  if(c.type==='crash'||c.type==='restart'){if(!['A','B'].includes(c.node))throw new Error('实例无效。');return {type:c.type,node:c.node}}
  if(c.type==='read'||c.type==='write'){if(!['u1','u2'].includes(c.user))throw new Error('用户无效。');if(c.type==='read')return {type:c.type,user:c.user};if(!Number.isSafeInteger(c.value)||c.value<1||c.value>9)throw new Error('会话值无效。');return {type:c.type,user:c.user,value:c.value}}
  throw new Error('未知状态操作。')
}
export function missingValues(c:Config,s:State) { const stores=c.placement==='shared'?[s.store.memory,s.store.stable]:s.nodes.map(n=>n.local);return Object.entries(s.acknowledged).filter(([user,value])=>!stores.some(store=>store[user]===value)).length }
export function runModel(input:Config,operations:readonly Command[]):State {
  const c=parseConfig(input);if(!Array.isArray(operations)||operations.length>MAX_COMMANDS)throw new Error('超过 40 步操作预算。')
  const s:State={modelVersion:c.modelVersion,nodes:Array.from({length:c.replicas},(_,i)=>({id:i?'B':'A',online:true,local:{}})),store:{online:true,memory:{},stable:{}},acknowledged:{},observations:[],events:[]}
  for(const command of operations.map(parseCommand)) {
    if(command.type==='crash'||command.type==='restart'){const n=s.nodes.find(n=>n.id===command.node);if(n){n.online=command.type==='restart';n.local={}}}
    else if(command.type==='crash-store'){s.store.online=false;s.store.memory={}}
    else if(command.type==='restart-store'){if(!s.store.online){s.store.online=true;s.store.memory={...s.store.stable}}}
    else if(command.type==='read'||command.type==='write') {
      const available=s.nodes.filter(n=>n.online);const preferred=s.nodes[command.user==='u1'?0:1]
      const node=c.routing==='sticky'?(preferred?.online?preferred:available[0]):available[s.observations.length%(available.length||1)]
      const observation:Observation={id:s.observations.length+1,operation:command.type,user:command.user,node:node?.id??null,value:null,expected:command.type==='write'?command.value:s.acknowledged[command.user]??null,status:'unavailable',reason:node?'store':'service'}
      if(node&&(c.placement==='local'||s.store.online)) {
        const storage=c.placement==='local'?node.local:s.store.memory
        if(command.type==='write'){storage[command.user]=command.value;if(c.placement==='shared'&&c.persistence==='stable')s.store.stable[command.user]=command.value;s.acknowledged[command.user]=command.value}
        observation.value=storage[command.user]??null;observation.status=observation.value===observation.expected?'ok':'missing';observation.reason=null
      }
      s.observations.push(observation)
    }
    s.events.push({index:s.events.length+1,at:s.events.length,kind:command.type,subject:'node'in command?command.node:'user'in command?command.user:'shared-store'})
  }
  return s
}
