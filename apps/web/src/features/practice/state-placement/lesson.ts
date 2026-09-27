import { createProtocolLesson } from '../../../core/experiments/protocol-lesson'
import { defaultConfig,MAX_COMMANDS,missingValues,parseCommand,parseConfig,runModel,type Command,type State } from './model'
export const exercise={id:'state-placement',kind:'algorithm' as const,version:1,title:'换一个实例，刚才的会话状态还在吗？',category:'基础设计决策',difficulty:'基础',estimatedMinutes:20,summary:'实际写入和读取实例内存或共享状态，比较轮询、会话亲和、故障接管与共享存储恢复。',flow:['定位状态','改变路由','注入故障','核对连续性']}
export const scenarios={routing:'两实例正常路由',failover:'服务实例崩溃',recovery:'共享存储重启',manual:'自由操作'}
export function script(scenario:string):Command[]{const write:Command={type:'write',user:'u1',value:7};const read:Command={type:'read',user:'u1'};if(scenario==='routing')return [write,read,read];if(scenario==='failover')return [write,{type:'crash',node:'A'},read,{type:'restart',node:'A'},read];if(scenario==='recovery')return [write,{type:'crash-store'},read,{type:'restart-store'},read];return []}
export function counts(s:State){const reads=s.observations.filter(o=>o.operation==='read');return {reads:reads.length,good:reads.filter(o=>o.status==='ok').length,bad:reads.filter(o=>o.status!=='ok').length}}
export const lesson=createProtocolLesson({id:exercise.id,versions:{model:'state-placement-v1',definition:1,assessment:1},initialConfig:defaultConfig,scenarios,maxCommands:MAX_COMMANDS,parseConfig,parseCommand,runModel,
  assess:(d,s)=>{const m=counts(s);const fixed=d.config.replicas===2&&d.scenario!=='manual'&&JSON.stringify(d.commands)===JSON.stringify(script(d.scenario));const missing=missingValues(d.config,s)
    const recovered=s.observations.some(o=>o.operation==='read'&&o.reason==='store')&&s.observations.at(-1)?.status==='ok'&&missing===0
    return {task:fixed&&(d.scenario==='recovery'?recovered:m.good===2&&m.bad===0),expected:{good:String(m.good),bad:String(m.bad),missing:String(missing),reason:'state-owner'},messages:[`符合最后确认值的读取 ${m.good} / ${m.reads}；不满足连续性 ${m.bad} 次，现存集合缺少的确认值 ${missing} 个。`,fixed?'保持两实例和原请求/故障脚本。':'本关要求两实例与完整原脚本；不能减少实例或省略故障。','会话亲和能在正常路由中保持访问同一实例，但不会把崩溃实例的内存复制给备用实例。',d.scenario==='recovery'?'本关允许共享存储重启期间不可用，但恢复后必须保留已确认状态；迁出进程状态仍需要设计存储恢复。':'服务实例无本地会话依赖，不代表整个系统没有状态或共享依赖。','客户端确认账本只用于核对，不会回填丢失的服务或存储数据。']}
  },
})
