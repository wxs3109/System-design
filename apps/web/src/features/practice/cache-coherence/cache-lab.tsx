'use client'
import { ProtocolExperiment } from '../protocol/experiment'
import { ConfigurationFields } from '../protocol/configuration-fields'
import { AnswerFields } from '../protocol/answer-fields'
import { MAX_COMMANDS,runModel,staleReads,type Command } from './model'
import { exercise,lesson,scenarios,script } from './lesson'
import styles from '../retry-idempotency/retry-lab.module.css'
const label=(c:Command)=>c.type==='read'?`客户端 ${c.client} 读取`:c.type==='write'?'提交源数据下一版本':c.type==='advance'?`推进 ${c.ms} 逻辑 ms`:`完成回源 ${c.flight}`
export function CacheCoherenceLab(){return <ProtocolExperiment id={exercise.id} title={exercise.title} summary={exercise.summary} conceptId="caching" createSession={()=>lesson.session()} initial={lesson.initial} scenarios={scenarios}
  goals={{stale:'缓存命中后提交更新，再发起新读。要求读到已完成更新，不能把高命中率当成正确性。',fill:'让旧回源跨过写入与失效，再完成它。后续读取不得被迟到回填带回旧版本。',herd:'预热后等待 101 个逻辑 ms，再并发开始三次读取。四次读取都需完成，含预热在内的实际回源不超过两次。',manual:'自行安排读取、写入、逻辑时间和回源完成；查看实际版本，不自动计为通过。'}}
  selectScenario={(d,scenario)=>({...lesson.initial(),scenario,config:d.config})} runModel={runModel} guide={d=>script(d.config,d.scenario)} commandLabel={label} maxCommands={MAX_COMMANDS}
  renderConfig={(d,edit,disabled)=><ConfigurationFields config={d.config} disabled={disabled} change={config=>edit({...d,config,commands:[]})} fields={[
    {key:'policy',label:'缓存更新策略',choices:[{value:'ttl',label:'只等 TTL 到期'},{value:'invalidate',label:'写入后删除缓存'},{value:'versioned',label:'失效 + 版本校验回填与合并'}]},
    {key:'coalesce',label:'同键在途合并',choices:[{value:false,label:'每次 miss 单独回源'},{value:true,label:'合并兼容的在途读取'}]},
    {key:'ttl',label:'缓存 TTL（逻辑 ms）',choices:[{value:20,label:'20'},{value:100,label:'100'}]},
  ]} />}
  renderLive={(_d,s,act,disabled)=><>
    <section className={styles.metrics}><div><span>逻辑读取</span><strong>{s.reads.length}</strong></div><div><span>实际回源</span><strong data-testid="coherence-origin">{s.flights.length}</strong></div><div><span>过时读取</span><strong data-testid="coherence-stale">{staleReads(s).length}</strong></div><div><span>拒绝旧回填</span><strong>{s.flights.filter(f=>f.filled===false).length}</strong></div></section>
    <section className={styles.panel}><h2>源数据、缓存与在途读取</h2><p>逻辑时间 {s.now}；源数据 {s.origin.value}（v{s.origin.version}）；缓存 {s.cache?`${s.cache.value} / v${s.cache.version} / 到期 ${s.cache.expiresAt}`:'空'}。</p><div className={styles.faultActions}>{(['A','B','C'] as const).map(client=><button disabled={disabled} key={client} onClick={()=>act({type:'read',client})}>客户端 {client} 读取</button>)}<button disabled={disabled} onClick={()=>act({type:'write'})}>提交源数据下一版本</button><button disabled={disabled} onClick={()=>act({type:'advance',ms:101})}>推进 101 逻辑 ms</button>{s.flights.filter(f=>f.pending).map(f=><button key={f.id} disabled={disabled} onClick={()=>act({type:'complete',flight:f.id})}>完成回源 {f.id}</button>)}</div><p>{s.flights.map(f=>`回源 ${f.id}：捕获 v${f.version}，等待者 ${f.waiters.join(',')}，${f.pending?'等待完成':f.filled?'已经回填':'未回填旧版本'}`).join('；')}</p></section>
    <section className={styles.panel}><h2>实际读取账本</h2><div className={styles.tableScroll}><table aria-label="缓存版本账本"><thead><tr><th>读取</th><th>开始时最低版本</th><th>实际值 / 版本</th><th>来源</th><th>开始 / 完成</th></tr></thead><tbody>{s.reads.map(r=><tr key={r.id}><th>{r.client}-{r.id}</th><td>{r.minimumVersion}</td><td>{r.value??'等待'} / {r.version??'—'}</td><td>{r.source??'等待'}</td><td>{r.startedAt} / {r.completedAt??'等待'}</td></tr>)}</tbody></table></div><p>未完成的读取不会被当成成功；之前的过时读取也不会因后来回填了新值而消失。</p></section>
  </>}
  renderAnswers={(d,edit,disabled)=><AnswerFields answers={d.answers} change={answers=>edit({...d,answers})} disabled={disabled} fields={[{id:'reads',label:'逻辑读取次数作答'},{id:'origin',label:'实际回源次数作答'},{id:'stale',label:'过时读取次数作答'},{id:'reason',label:'缓存保证的边界',options:[{value:'freshness-and-inflight',label:'同时核对新鲜度、在途版本与实际回源'},{value:'hit-rate',label:'只要命中率高就正确'}]}]} />}
  compare={d=>({headings:['实际回源','过时读取','未完成'],rows:[{label:'TTL',config:{...d.config,policy:'ttl' as const,coalesce:false}},{label:'仅失效',config:{...d.config,policy:'invalidate' as const,coalesce:false}},{label:'版本保护',config:{...d.config,policy:'versioned' as const,coalesce:false}},{label:'版本保护与合并',config:{...d.config,policy:'versioned' as const,coalesce:true}}].map(row=>{const s=runModel(row.config,script(row.config,d.scenario));return {label:row.label,values:[s.flights.length,staleReads(s).length,s.reads.filter(r=>r.completedAt===null).length]}})})}
  boundary={['cache-coherence-v1：单个键、一个权威源、一个缓存与三个逻辑客户端。源读在发起时捕获实际值和版本，完成由操作控制。最多 40 步，TTL 使用逻辑时间；不模拟缓存容量、真实延迟或多节点失效传播。', '版本保护要求写入者维护并传播同一可信版本；合并仅限兼容版本。旧回源仍可完成先前读取，但不能把缓存降回旧版本。它不自动解决跨键事务、权限撤销或所有一致性保证。', '新鲜度合同是已完成写入之后开始的读不能返回更早版本；重叠读允许返回旧快照。固定业务调用相同，实际回源数量由策略决定；合并不是减少原始需求。']} />}
