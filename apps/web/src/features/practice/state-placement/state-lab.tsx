'use client'
import { ProtocolExperiment } from '../protocol/experiment'
import { ConfigurationFields } from '../protocol/configuration-fields'
import { AnswerFields } from '../protocol/answer-fields'
import { MAX_COMMANDS,missingValues,runModel,type Command } from './model'
import { counts,exercise,lesson,scenarios,script } from './lesson'
import styles from '../retry-idempotency/retry-lab.module.css'
const label=(c:Command)=>c.type==='write'?`写入 ${c.user} = ${c.value}`:c.type==='read'?`读取 ${c.user}`:c.type==='crash'?`关闭实例 ${c.node}`:c.type==='restart'?`重启实例 ${c.node}`:c.type==='crash-store'?'让共享存储崩溃':'恢复共享存储'
const manual:Command[]=[{type:'write',user:'u1',value:7},{type:'write',user:'u2',value:9},{type:'read',user:'u1'},{type:'read',user:'u2'},{type:'crash',node:'A'},{type:'restart',node:'A'},{type:'crash-store'},{type:'restart-store'}]
export function StatePlacementLab(){return <ProtocolExperiment id={exercise.id} title={exercise.title} summary={exercise.summary} conceptId="state-and-scaling" createSession={()=>lesson.session()} initial={lesson.initial} scenarios={scenarios}
  goals={{routing:'在两台健康实例中写入 7，再读取两次；每次都应看到最后确认的值。正常条件下可能有多种方案。',failover:'写入 7 后关闭 A，在 B 上继续读取，再重启 A。所有读取都应保留会话连续性。',recovery:'已选择共享状态，验证存储进程崩溃与恢复。允许重启期间一次读取不可用，但恢复后值必须仍为 7。',manual:'自由交错两个用户的读写、路由与恢复，观察实际状态，不自动计通关。'}}
  selectScenario={(d,scenario)=>({...lesson.initial(),scenario,config:{...d.config,...(scenario==='recovery'?{placement:'shared' as const}:{})}})} runModel={runModel} guide={d=>script(d.scenario)} commandLabel={label} maxCommands={MAX_COMMANDS}
  renderConfig={(d,edit,disabled)=><ConfigurationFields config={d.config} disabled={disabled} change={config=>edit({...d,config,commands:[]})} fields={[
    {key:'replicas',label:'服务实例数量',choices:[{value:1,label:'1'},{value:2,label:'2'}]},
    {key:'placement',label:'会话状态位置',locked:d.scenario==='recovery',choices:[{value:'local',label:'各实例本地内存'},{value:'shared',label:'共同访问共享存储'}]},
    {key:'routing',label:'会话路由',choices:[{value:'round-robin',label:'健康实例轮询'},{value:'sticky',label:'优先固定实例，失效时接管'}]},
    {key:'persistence',label:'共享状态确认条件',choices:[{value:'volatile',label:'仅共享进程内存'},{value:'stable',label:'稳定保存后确认'}]},
  ]} />}
  renderLive={(d,s,act,disabled)=>{const m=counts(s);return <><section className={styles.metrics}><div><span>符合确认值的读取</span><strong data-testid="placement-good">{m.good}</strong></div><div><span>连续性未满足</span><strong data-testid="placement-bad">{m.bad}</strong></div><div><span>确认值缺失</span><strong data-testid="placement-missing">{missingValues(d.config,s)}</strong></div></section>
    <div className={styles.actors}>{s.nodes.map(n=><section className={styles.actor} key={n.id}><h2>实例 {n.id} · {n.online?'在线':'离线'}</h2><p>本地会话：{JSON.stringify(n.local)}</p></section>)}<section className={styles.actor}><h2>共享存储 · {s.store.online?'在线':'离线'}</h2><p>内存：{JSON.stringify(s.store.memory)}</p><p>稳定集合：{JSON.stringify(s.store.stable)}</p><p>客户端最后确认：{JSON.stringify(s.acknowledged)}</p></section></div>
    <section className={styles.panel}><h2>路由和实际返回</h2><div className={styles.tableScroll}><table aria-label="状态路由账本"><thead><tr><th>请求</th><th>用户 / 操作</th><th>实例</th><th>应有值</th><th>返回值</th><th>结果</th></tr></thead><tbody>{s.observations.map(o=><tr key={o.id}><th>{o.id}</th><td>{o.user} / {o.operation}</td><td>{o.node??'无'}</td><td>{o.expected??'无'}</td><td>{o.value??'无'}</td><td>{o.status==='ok'?'符合':o.status==='missing'?'状态缺失或过时':`不可用：${o.reason}`}</td></tr>)}</tbody></table></div></section>
    <section className={styles.panel}><h2>手动操作</h2><div className={styles.faultActions}>{manual.map(c=><button key={label(c)} disabled={disabled} onClick={()=>act(c)}>{label(c)}</button>)}</div></section></>}}
  renderAnswers={(d,edit,disabled)=><AnswerFields answers={d.answers} change={answers=>edit({...d,answers})} disabled={disabled} fields={[{id:'good',label:'正确连续读取次数'},{id:'bad',label:'未满足连续性次数'},{id:'missing',label:'确认值缺失数'},{id:'reason',label:'状态扩展边界',options:[{value:'state-owner',label:'跟踪实际状态所有者、路由和恢复条件'},{value:'replicas',label:'有两个服务就自动共享和持久保存状态'}]}]} />}
  compare={d=>({headings:['正确读取','未满足连续性','确认值缺失'],rows:[{label:'本地 + 轮询',config:{...d.config,placement:'local' as const,routing:'round-robin' as const}},{label:'本地 + 亲和',config:{...d.config,placement:'local' as const,routing:'sticky' as const}},{label:'共享内存',config:{...d.config,placement:'shared' as const,persistence:'volatile' as const}},{label:'共享稳定状态',config:{...d.config,placement:'shared' as const,persistence:'stable' as const}}].map(row=>{const s=runModel(row.config,script(d.scenario));const m=counts(s);return {label:row.label,values:[m.good,m.bad,missingValues(row.config,s)]}})})}
  boundary={['state-placement-v1：两个可信符号用户、最多两个服务实例和一个共享存储。请求串行；亲和固定 u1 优先 A、u2 优先 B，不可用时立即选健康实例。没有真实负载均衡、连接、鉴权或故障探测协议。', '实例崩溃或重启清空本地会话；共享进程崩溃清空共享内存，重启只读取实际稳定集合。稳定保存为原子教学动作，不覆盖磁盘永久丢失或数据复制。', '客户端确认账本是观察依据；不会给存储补数据。最多 40 步；正常路由下亲和可以有效，故障接管需要另外验证；共享状态仍可能成为单点。']} />}
