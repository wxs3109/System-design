import { createProtocolLesson } from '../../../core/experiments/protocol-lesson'
import { counts,defaultConfig,MAX_COMMANDS,parseCommand,parseConfig,runModel,type Command } from './model'
export const exercise={id:'safe-evolution',kind:'protocol' as const,version:1,title:'回滚了代码，数据也会回去吗？',category:'观测与安全演进',difficulty:'基础',estimatedMinutes:20,summary:'实际写入两种字段格式，交错新旧读者、迁移和回滚；按版本检查错误，观察代码回滚为何不能撤销数据变化。',flow:['固定逻辑数据','观察版本差异','迁移或回滚','验证兼容组合']}
export const scenarios={mixed:'按版本观察灰度结果',rollback:'回滚遇到新写入',migration:'迁移时的新旧共存',manual:'自由演进'}
export function script(scenario:string):Command[]{
  if(scenario==='mixed')return [{type:'deploy'},...Array.from({length:10},(_,i)=>({type:'read' as const,id:'r1' as const,reader:i%5===4?'new' as const:'old' as const}))]
  if(scenario==='rollback')return [{type:'deploy'},{type:'write',id:'r2',value:'green'},{type:'read',id:'r2',reader:'active'},{type:'rollback'},{type:'read',id:'r2',reader:'active'}]
  if(scenario==='migration')return [{type:'migrate',id:'r1'},{type:'read',id:'r1',reader:'old'},{type:'read',id:'r1',reader:'new'}]
  return []
}
export const lesson=createProtocolLesson({id:exercise.id,versions:{model:'safe-evolution-v1',definition:1,assessment:1},initialConfig:defaultConfig,scenarios,maxCommands:MAX_COMMANDS,parseConfig,parseCommand,runModel,
  assess:(d,s)=>{const old=counts(s,1),next=counts(s,2);const fixed=d.scenario!=='manual'&&JSON.stringify(d.commands)===JSON.stringify(script(d.scenario));return {task:fixed&&old.total>0&&next.total>0&&s.reads.every(r=>r.correct),expected:{old:String(old.good),oldTotal:String(old.total),next:String(next.good),nextTotal:String(next.total),reason:'compatibility-before-rollback'},messages:[`旧读者正确 ${old.good}/${old.total}，新读者正确 ${next.good}/${next.total}；总成功 ${old.good+next.good}/${s.reads.length}。`,'总指标可能稀释新版本错误；必须检查实际参与版本和数据格式。','回滚只改变默认代码版本，不改变已写入字段；旧读者能否读取新写入，必须用真实记录验证。','扩展迁移保留原字段；删除原字段前需确认旧读者退出。观察账本中的逻辑期望不会自动修复存储。',fixed?'保持原读写、迁移和版本脚本。':'必须完成本关的兼容组合与操作，不能避开失败读者。']}}
})
