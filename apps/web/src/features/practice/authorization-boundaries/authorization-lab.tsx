'use client'
import { ProtocolExperiment } from '../protocol/experiment'
import { ConfigurationFields } from '../protocol/configuration-fields'
import { AnswerFields } from '../protocol/answer-fields'
import { MAX_COMMANDS,runModel,violations,type Command } from './model'
import { exercise,lesson,scenarioConfig,scenarios,script } from './lesson'
import styles from '../retry-idempotency/retry-lab.module.css'
const label=(c:Command)=>c.type==='advance'?`推进 ${c.ms} 逻辑 ms`:`${c.type==='read'?'读取':c.type==='grant'?'授予':'撤销'} ${c.user} → ${c.resource}`
const manual:Command[]=[{type:'read',user:'alice',resource:'a'},{type:'read',user:'alice',resource:'b'},{type:'read',user:'bob',resource:'b'},{type:'revoke',user:'alice',resource:'a'},{type:'grant',user:'alice',resource:'a'},{type:'advance',ms:101}]
export function AuthorizationLab(){return <ProtocolExperiment id={exercise.id} title={exercise.title} summary={exercise.summary} conceptId="security-boundaries" createSession={()=>lesson.session()} initial={lesson.initial} scenarios={scenarios}
  goals={{ownership:'Alice 与 Bob 都是已知身份，但私有对象只能由其所有者读取。合法请求仍须成功，不能一律拒绝。',revocation:'先缓存 Alice 的合法授权，再撤销。之后的新请求必须拒绝，Bob 的合法访问仍可继续。',scope:'先检查 Alice 的对象 A，再让同一身份访问 B。观察按用户缓存一个布尔许可为什么不够。',manual:'管理动作由可信操作者执行；自由尝试授权、撤销和时间，不计挑战通过。'}}
  selectScenario={(_d,scenario)=>({...lesson.initial(),scenario,config:scenarioConfig(scenario)})} runModel={runModel} guide={d=>script(d.scenario)} commandLabel={label} maxCommands={MAX_COMMANDS}
  renderConfig={(d,edit,disabled)=><ConfigurationFields config={d.config} change={config=>edit({...d,config,commands:[]})} disabled={disabled} fields={[
    {key:'check',label:'授权检查范围',choices:[{value:'identity',label:'只确认身份存在'},{value:'resource',label:'核对用户、私有对象与授权'}]},
    {key:'cache',label:'授权缓存策略',choices:[{value:'none',label:'每次权威检查'},{value:'ttl',label:'仅靠 100 逻辑 ms TTL'},{value:'version',label:'缓存并核对当前策略版本'}]},
    {key:'key',label:'授权缓存键',choices:[{value:'user',label:'只有用户'},{value:'resource',label:'用户 + 对象'}]},
  ]} />}
  renderLive={(_d,s,act,disabled)=><><section className={styles.metrics}><div><span>错误授权决定</span><strong data-testid="auth-wrong">{violations(s).length}</strong></div><div><span>权威授权检查</span><strong data-testid="auth-checks">{s.policyChecks}</strong></div><div><span>当前策略版本</span><strong>{s.policyVersion}</strong></div></section>
    <section className={styles.panel}><h2>每次实际返回</h2><p>A 属于 Alice，B 属于 Bob；身份已知不代表拥有另一对象的权限。</p><div className={styles.tableScroll}><table aria-label="授权结果账本"><thead><tr><th>用户 / 对象</th><th>当前规则</th><th>实际决定</th><th>返回数据</th><th>缓存</th></tr></thead><tbody>{s.observations.map((o,i)=><tr key={i}><th>{o.user} / {o.resource}</th><td>{o.expected?'允许':'拒绝'}</td><td>{o.allowed?'放行':'拒绝'}</td><td>{o.data??'未返回'}</td><td>{o.cached?'命中':'未使用'}</td></tr>)}</tbody></table></div><div className={styles.faultActions}>{manual.map(c=><button disabled={disabled} key={label(c)} onClick={()=>act(c)}>{label(c)}</button>)}</div></section></>}
  renderAnswers={(d,edit,disabled)=><AnswerFields answers={d.answers} change={answers=>edit({...d,answers})} disabled={disabled} fields={[{id:'reads',label:'授权读取次数'},{id:'wrong',label:'错误授权决定数'},{id:'checks',label:'权威授权检查次数'},{id:'reason',label:'授权边界解释',options:[{value:'resource-and-revocation',label:'许可必须绑定对象并遵守撤销条件'},{value:'logged-in',label:'已登录用户可以读取任何对象'}]}]} />}
  compare={d=>({headings:['错误决定','权威检查'],rows:[{label:'仅身份',config:{...d.config,check:'identity' as const}},{label:'对象授权 + TTL',config:{...d.config,check:'resource' as const,cache:'ttl' as const}},{label:'对象授权 + 版本',config:{...d.config,check:'resource' as const,cache:'version' as const}},{label:'每次检查',config:{...d.config,check:'resource' as const,cache:'none' as const}}].map(row=>{const s=runModel(row.config,script(d.scenario));return {label:row.label,values:[violations(s).length,s.policyChecks]}})})}
  boundary={['authorization-boundaries-v1：两个已认证的符号用户与两个私有对象。授权变更是可信管理操作；没有真实登录、令牌签名、密码学或管理 API。最多 40 步，原始对象内容是固定教学字符串。', '版本模式假设当前策略版本可信且可取得，只计完整规则评估次数，不计版本服务延迟与故障。生产撤销窗口和缓存失效需要各自协议；仅添加一个版本字段并不足够。', '读取时按当前权威规则核对实际数据释放，历史泄露不会被后来撤销或修复抹去。本题不外推真实系统安全保证。']} />}
