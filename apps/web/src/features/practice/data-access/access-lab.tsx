'use client'
import { ProtocolExperiment } from '../protocol/experiment'
import { ConfigurationFields } from '../protocol/configuration-fields'
import { AnswerFields } from '../protocol/answer-fields'
import { dataContract, MAX_COMMANDS, runModel, type Command } from './model'
import { correct, exercise, lesson, reference, scenarios, script } from './lesson'
import styles from '../retry-idempotency/retry-lab.module.css'
const label = (c: Command) => c.type === 'point' ? `按 ID 读取 ${c.id}` : c.type === 'range' ? `按时间列出 ${c.owner}` : c.type === 'move' ? `把 ${c.id} 改为 ${c.owner} / ${c.time}` : '重建当前索引'
export function DataAccessLab() {
  return <ProtocolExperiment id={exercise.id} title={exercise.title} summary={exercise.summary} conceptId="storage-access-patterns" createSession={() => lesson.session()} initial={lesson.initial} scenarios={scenarios}
    goals={{ point:'查到 r07，实际只读取一条记录；全扫描即使结果正确，也不满足本关访问工作量。', range:'完整列出 u1 的记录并按时间排序，实际读取不超过 5 条；不能只返回部分结果。', maintenance:'移动记录后，每次查询都必须与当时源数据一致，并保持末次读取不超过 5 条。观察延迟维护遗漏了什么。', payload:'业务只需要四个元数据字段。完整列出 u1，读取不超过 5 条且载荷读入小于 1000 bytes。', manual:'比较同一数据集的路径和更新，自由操作不自动计为通过。' }}
    selectScenario={(_d,scenario) => ({...lesson.initial(),scenario})} runModel={runModel} guide={d=>script(d.scenario)} commandLabel={label} maxCommands={MAX_COMMANDS}
    renderConfig={(d,edit,disabled)=><ConfigurationFields config={d.config} disabled={disabled} change={config=>edit({...d,config,commands:[]})} fields={[
      {key:'path',label:'访问路径',choices:[{value:'scan',label:'强制全扫描'},{value:'primary',label:'主键定位 / 范围回退扫描'},{value:'ordered',label:'主键 + 用户/时间有序索引'}]},
      {key:'maintenance',label:'二级索引维护',choices:[{value:'inline',label:'更新时同步维护'},{value:'deferred',label:'等待显式刷新'}]},
      {key:'layout',label:'记录载荷布局',choices:[{value:'embedded',label:'元数据与 256 字节内容一起读取'},{value:'split',label:'元数据与内容分开存放'}]},
    ]} />}
    renderLive={(d,s,act,disabled)=><>
      <section className={styles.metrics}><div><span>末次实际读取记录</span><strong data-testid="access-examined">{s.queries.at(-1)?.rowsExamined ?? 0}</strong></div><div><span>末次读入 bytes</span><strong data-testid="access-bytes">{s.queries.at(-1)?.bytesRead ?? 0}</strong></div><div><span>曾出现不完整结果</span><strong data-testid="access-wrong">{s.queries.filter(q=>!correct(q)).length}</strong></div><div><span>索引条目维护操作</span><strong>{s.indexWrites+s.indexRemovals}</strong></div></section>
      <section className={styles.panel}><h2>实际访问与参考结果</h2><div className={styles.tableScroll}><table aria-label="数据访问账本"><thead><tr><th>查询</th><th>实际结果（时间顺序）</th><th>应有结果</th><th>记录 / 索引探测</th><th>bytes</th></tr></thead><tbody>{s.queries.map((q,i)=><tr key={i}><th>{label(q.command)}</th><td>{q.rows.map(r=>r.id).join(', ')}</td><td>{reference(q).map(r=>r.id).join(', ')}</td><td>{q.rowsExamined} / {q.indexProbes}</td><td>{q.bytesRead}</td></tr>)}</tbody></table></div><p>参考结果从查询发生时的源记录独立枚举；记录读取、索引比较、维护操作分别计数，不混为“查询耗时”。</p></section>
      <section className={styles.panel}><h2>手动操作与当前数据</h2><div className={styles.faultActions}>{[{type:'point',id:'r07'},{type:'range',owner:'u1'},{type:'range',owner:'u2'},{type:'move',id:'r05',owner:'u2',time:7},{type:'refresh'}].map(c=><button key={label(c as Command)} disabled={disabled} onClick={()=>act(c as Command)}>{label(c as Command)}</button>)}</div><p>{Object.values(s.rows).map(r=>`${r.id}: ${r.owner}@${r.time}`).join('；')}</p><details><summary>字段、主键和索引声明</summary><div className={styles.tableScroll}><pre>{JSON.stringify(dataContract(d.config),null,2)}</pre></div></details></section>
    </>}
    renderAnswers={(d,edit,disabled)=><AnswerFields answers={d.answers} change={answers=>edit({...d,answers})} disabled={disabled} fields={[{id:'rows',label:'末次返回记录数'},{id:'examined',label:'末次读取记录数'},{id:'wrong',label:'历史不完整查询数'},{id:'reason',label:'访问路径选择依据',options:[{value:'access-and-maintenance',label:'访问形状、结果完整性与维护代价共同决定'},{value:'brand',label:'选择某个数据库名称就足够'}]}]} />}
    compare={d=>({headings:['末次读取记录','末次 bytes','历史错误查询','索引维护操作'],rows:(['scan','primary','ordered'] as const).map(path=>{const s=runModel({...d.config,path},script(d.scenario));return {label:path,values:[s.queries.at(-1)?.rowsExamined??0,s.queries.at(-1)?.bytesRead??0,s.queries.filter(q=>!correct(q)).length,s.indexWrites+s.indexRemovals]}})})}
    boundary={['data-access-v1：16 条实际符号记录、主键字典与按 owner/time/id 排序的二级条目。用二分定位范围起点，顺序读取匹配条目；不是完整 B+ Tree、页缓存、SQL 优化器或厂商基准。最多 30 步。', '关系数据合同复用平台 Schema，声明字段、主键和索引；声明本身不代替执行。强制扫描是对照路径，主键字典的固定初始化未当成每次查询开销；二级索引初建、更新和刷新单独计数。', '源记录更新是单条原子操作，延迟索引可能遗漏已更新的成员；刷新后仍保留此前反例。读取字节是选定 JSON 载荷的 UTF-8 大小，不包含物理页、WAL 或网络协议开销；不据此判断通用事务、join 或数据库品牌能力。']} />
}
