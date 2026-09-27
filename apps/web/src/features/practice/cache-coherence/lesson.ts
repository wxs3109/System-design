import { createProtocolLesson } from '../../../core/experiments/protocol-lesson'
import { defaultConfig,MAX_COMMANDS,parseCommand,parseConfig,runModel,staleReads,type Command,type Config } from './model'
export const exercise={id:'cache-coherence',kind:'protocol' as const,version:1,title:'缓存删了，为什么旧值还会回来？',category:'缓存与设计取舍',difficulty:'基础',estimatedMinutes:25,summary:'实际交错读取、源数据更新和延迟回填，比较 TTL、失效、版本保护及同键请求合并。',flow:['观察旧值','交错回填','合并回源','核对新鲜度与工作量']}
export const scenarios={stale:'更新后的旧缓存',fill:'迟到的旧回填',herd:'同时过期与回源',manual:'自由交错'}
export function script(c:Config,scenario:string):Command[]{
  if(scenario==='manual')return []
  const commands:Command[]=[];const act=(command:Command)=>{commands.push(command);return runModel(c,commands)}
  const drain=()=>{for(let i=0;i<10;i++){const next=runModel(c,commands).flights.find(f=>f.pending);if(!next)return;act({type:'complete',flight:next.id})}throw new Error('回源超出实验预算。')}
  act({type:'read',client:'A'})
  if(scenario==='fill'){act({type:'write'});drain();act({type:'read',client:'B'});drain()}
  else {drain();if(scenario==='stale'){act({type:'write'});act({type:'read',client:'B'})}else{act({type:'advance',ms:101});for(const client of ['A','B','C'] as const)act({type:'read',client})}drain()}
  return commands
}
export const lesson=createProtocolLesson({id:exercise.id,versions:{model:'cache-coherence-v1',definition:1,assessment:1},initialConfig:defaultConfig,scenarios,maxCommands:MAX_COMMANDS,parseConfig,parseCommand,runModel,
  assess:(d,s)=>{const stale=staleReads(s).length;const pending=s.reads.filter(r=>r.completedAt===null).length;const expectedReads=d.scenario==='herd'?4:2;const fixed=d.scenario!=='manual'&&JSON.stringify(d.commands)===JSON.stringify(script(d.config,d.scenario));return {task:fixed&&s.reads.length===expectedReads&&!pending&&!stale&&(d.scenario!=='herd'||s.flights.length<=2),expected:{reads:String(s.reads.length),origin:String(s.flights.length),stale:String(stale),reason:'freshness-and-inflight'},messages:[`逻辑读取 ${s.reads.length} 次，实际源站读取 ${s.flights.length} 次；过时读取 ${stale} 次，等待中 ${pending} 次。`,`旧回填被拒绝 ${s.flights.filter(f=>f.filled===false).length} 次；过期 ${s.expirations} 次。`,'已完成写入之后开始的读，不能返回更早版本；与写入重叠的早先读取允许返回它原先捕获的值。','删除缓存不取消旧回源；回填和同键合并都需要核对版本。合并请求减少回源，不增加源站本身的处理能力。',fixed?'保持了原读取、更新和重叠窗口。':'需要保留本关读取和故障交错；跳过请求或等待到另一条件不能通过。']}}
})
