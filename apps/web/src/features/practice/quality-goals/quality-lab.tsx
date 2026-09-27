'use client'
import { ProtocolExperiment } from '../protocol/experiment'
import { AnswerFields } from '../protocol/answer-fields'
import { ConfigurationFields } from '../protocol/configuration-fields'
import { exercise, goals, lesson, measures, scenarioCommands, scenarios } from './lesson'
import { MAX_COMMANDS, missingAcknowledged, runModel, type Command, type State } from './model'
import styles from '../retry-idempotency/retry-lab.module.css'

const labels: Record<Command['type'], string> = { read: '读取核心与附加内容', write: '写入并等待确认', 'read-confirmed': '读取已确认记录', 'fail-domain': '关闭服务故障域', 'recover-domain': '恢复服务故障域', 'crash-storage': '让存储进程崩溃', 'recover-storage': '从稳定集合恢复存储', 'fail-dependency': '关闭附加依赖', 'recover-dependency': '恢复附加依赖' }
const commandLabel = (c: Command) => `${labels[c.type]}${'domain' in c ? ` ${c.domain}` : ''}`
const statusLabels = { complete: '完整返回', degraded: '仅核心内容', unavailable: '不可用', 'data-missing': '缺少已确认数据' }
const manual: Command[] = [{ type: 'read' }, { type: 'write' }, { type: 'read-confirmed' }, { type: 'fail-domain', domain: 'A' }, { type: 'recover-domain', domain: 'A' }, { type: 'fail-domain', domain: 'B' }, { type: 'recover-domain', domain: 'B' }, { type: 'crash-storage' }, { type: 'recover-storage' }, { type: 'fail-dependency' }, { type: 'recover-dependency' }]
function Live({ state, allowDegraded, act, disabled }: { state: State; allowDegraded: boolean; act: (c: Command) => void; disabled: boolean }) {
  const m = measures(state, allowDegraded)
  return <>
    <section className={styles.metrics} aria-label="目标证据"><div><span>符合本关请求合同</span><strong data-testid="quality-good">{m.good} / {m.offered}</strong></div><div><span>完整内容返回</span><strong data-testid="quality-full">{m.full}</strong></div><div><span>确认后缺失记录</span><strong data-testid="quality-missing">{m.missing}</strong></div><div><span>本次请求比例</span><strong>{m.fraction === null ? '尚无请求' : `${(m.fraction * 100).toFixed(0)}%`}</strong></div></section>
    <div className={styles.actors}><section className={styles.actor}><h2>服务实例与故障域</h2>{state.instances.map(n => <p key={n.id}>{n.id} · 域 {n.domain} · {n.online ? '可处理' : '不可处理'}</p>)}<p>路由只选当前可处理实例；本模型不计算故障探测与切换延迟。</p></section><section className={styles.actor}><h2>独立存储与确认</h2><p>存储进程：{state.storage.online ? '在线' : '离线'}</p><p>易失集合：{state.storage.memory.join(', ') || '空'}</p><p>稳定集合：{state.storage.stable.join(', ') || '空'}</p><p>曾确认：{state.acknowledgements.map(a => a.recordId).join(', ') || '无'}</p><p>无法从现存集合恢复：{missingAcknowledged(state).join(', ') || '无'}</p></section><section className={styles.actor}><h2>附加依赖与内容要求</h2><p>依赖：{state.dependencyOnline ? '在线' : '不可用'}</p><p>{allowDegraded ? '本关允许只返回核心内容。' : '当前请求统计要求完整内容。'}</p><p>服务副本不改变存储份数；读取成功也不能补回已经丢失的记录。</p></section></div>
    <section className={styles.panel}><h2>每个请求实际得到什么</h2><div className={styles.tableScroll}><table aria-label="目标请求账本"><thead><tr><th>请求</th><th>操作</th><th>实例</th><th>结果</th><th>延迟</th><th>实际内容</th></tr></thead><tbody>{state.requests.map(r => <tr key={r.id}><th>{r.id}</th><td>{labels[r.operation]}</td><td>{r.instance ?? '无'}</td><td>{statusLabels[r.status]}</td><td>{r.latencyMs} ms</td><td>{r.values.join(', ') || '无'}</td></tr>)}</tbody></table></div><p>失败和缺失数据的请求仍在分母中。100 ms 是本实验约定的阈值，延迟为教学常数。</p></section>
    <section className={styles.panel}><h2>手动验证边界</h2><div className={styles.faultActions}>{manual.map(c => <button disabled={disabled} key={commandLabel(c)} onClick={() => act(c)}>{commandLabel(c)}</button>)}</div><p>额外操作用于探索；固定挑战仍按原需求与故障脚本核验。</p></section>
  </>
}
export function QualityGoalsLab() {
  return <ProtocolExperiment id={exercise.id} title={exercise.title} summary={exercise.summary} conceptId="quality-goals" createSession={() => lesson.session()} initial={lesson.initial} scenarios={scenarios} goals={goals}
    selectScenario={(d, scenario) => ({ ...lesson.initial(), scenario, config: d.config })} runModel={runModel} guide={d => scenarioCommands(d.scenario)} commandLabel={commandLabel} maxCommands={MAX_COMMANDS}
    renderConfig={(d, edit, disabled) => <ConfigurationFields config={d.config} disabled={disabled} change={config => edit({ ...d, config, commands: [] })} fields={[
      { key: 'replicas', label: '服务实例数', ariaLabel: '目标实验服务实例数', choices: [{ value: 1, label: '1 个实例' }, { value: 2, label: '2 个实例' }] },
      { key: 'placement', label: '实例放置', ariaLabel: '目标实验实例放置', choices: [{ value: 'shared', label: '同一故障域 A' }, { value: 'separate', label: '分别放在 A / B' }] },
      { key: 'acknowledgement', label: '写入确认边界', ariaLabel: '目标实验确认边界', choices: [{ value: 'memory', label: '写入易失内存后确认' }, { value: 'stable', label: '稳定保存后确认' }] },
      { key: 'dependency', label: '附加依赖失败策略', ariaLabel: '目标实验依赖策略', choices: [{ value: 'required', label: '完整依赖失败就返回失败' }, { value: 'degrade', label: '失败时仅返回核心内容' }] },
    ]} />}
    renderLive={(d, s, act, disabled) => <Live state={s} allowDegraded={d.scenario === 'degradation'} act={act} disabled={disabled} />}
    renderAnswers={(d, edit, disabled) => <AnswerFields fields={[{ id: 'offered', label: '本次请求数' }, { id: 'good', label: '满足请求合同的次数' }, { id: 'missing', label: '已确认但缺失的记录数' }, { id: 'reason', label: '本关保证成立的原因', options: [{ value: 'failure-domains', label: '剩余实例覆盖本次故障范围' }, { value: 'commit-boundary', label: '确认发生在稳定保存之后' }, { value: 'allowed-degradation', label: '需求明确允许核心内容降级' }, { value: 'more-replicas', label: '只要增加副本就能保证所有目标' }] }]} answers={d.answers} disabled={disabled} change={answers => edit({ ...d, answers })} />}
    compare={d => ({ headings: ['合约内成功 / 全部请求', '完整返回', '降级返回', '确认后缺失'], rows: (d.scenario === 'availability'
      ? [{ label: '单实例', config: { ...d.config, replicas: 1 as const } }, { label: '同域双实例', config: { ...d.config, replicas: 2 as const, placement: 'shared' as const } }, { label: '跨域双实例', config: { ...d.config, replicas: 2 as const, placement: 'separate' as const } }]
      : d.scenario === 'durability' ? [{ label: '内存确认', config: { ...d.config, acknowledgement: 'memory' as const } }, { label: '稳定保存后确认', config: { ...d.config, acknowledgement: 'stable' as const } }]
      : [{ label: '完整依赖', config: { ...d.config, dependency: 'required' as const } }, { label: '允许核心内容降级', config: { ...d.config, dependency: 'degrade' as const } }]).map(row => { const m = measures(runModel(row.config, scenarioCommands(d.scenario)), d.scenario === 'degradation'); return { label: row.label, values: [`${m.good} / ${m.offered}`, m.full, m.degraded, m.missing] } }) })}
    boundary={['quality-goals-v1：最多两个服务实例、两个服务故障域、一个独立符号存储和一个附加依赖。服务域故障只作用于服务，存储故障单独触发；没有自动复制存储。路由即时避开已知失败实例，不模拟探测延迟、容量竞争或网络协议。', '稳定保存是模型中的原子动作，保护进程崩溃；不模拟磁盘永久丢失、复制协议、真实 fsync 或生产持久性概率。读写真实改变并读取符号记录集合，确认清单不能修补数据。', '请求串行执行，延迟为声明常数，最多 40 个操作。请求比例只说明本次脚本；本关允许的降级不能扩展为所有业务都允许。实验不会运行真实服务或存储。']} />
}
