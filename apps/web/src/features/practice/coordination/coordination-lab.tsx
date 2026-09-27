'use client'
import Link from 'next/link'
import { StorageNotice, storageLabel } from '../../../components/experiments/storage-notice'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { LabConceptLinks } from '../../learning/lab-concept-links'
import { CoordinationSession } from './session'
import { answersIdentity, identity, initialDraft, exercises, scenarioCommands, scenarioLabels, scenariosFor, type Draft, type LabId, type Scenario } from './lesson'
import { MAX_COMMANDS, runModel, same, type Command, type Config } from './model'
import { CoordinationLiveView, processLabels, observationLabels } from './live-view'
import styles from '../retry-idempotency/retry-lab.module.css'

const goals: Record<Scenario, string> = { pause: '暂停 A，推进到观察超时。进程状态与观察者判断是否相同？恢复后再递送心跳，观察怀疑如何被清除。', partition: 'A 仍然运行，但链路分区。等待检测超时，检查观察者能否区分它与崩溃。', crash: '让 A 崩溃并触发超时。还可以递送崩溃前的在途心跳，看看“近期收到”能否证明当前活着。', 'stale-write': 'A 发送写入后暂停。租约到期，B 接管并写入新值，然后递送 A 的旧包。让资源拒绝覆盖。', 'false-suspicion': '检测超时短于租约有效期。观察者怀疑 A 时让 B 申请租约，再恢复 A，检查怀疑能否直接转移持有权。', 'fence-window': '开启 Fencing，B 获得新 token，但先递送旧包，再递送 B 的新包。观察资源实际见到新 token 前的保护边界。', manual: '自由交错心跳、暂停、崩溃、网络分区、租约与写入。自由实验保存证据，不计入关卡进度。' }
const commandLabel = (c: Command) => ({ advance: '推进时间', 'send-heartbeat': '发送心跳', 'deliver-heartbeat': '递送心跳', 'drop-heartbeat': '丢弃心跳', pause: '暂停进程', resume: '恢复进程', crash: '崩溃', restart: '重启', partition: '网络分区', reconnect: '连通网络', acquire: '申请租约', renew: '续租', 'prepare-write': '准备写入', 'deliver-write': '递送写入', 'drop-write': '丢弃写入' })[c.type]

export function CoordinationLab({ labId }: { labId: LabId }) { return <Experiment key={labId} labId={labId} /> }
function Experiment({ labId }: { labId: LabId }) {
  const [session] = useState(() => new CoordinationSession(labId))
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot)
  useEffect(() => { void session.load() }, [session])
  const { draft: d } = state
  const [error, setError] = useState('')
  const frame = useMemo(() => { try { return { result: runModel(d.config, d.commands), error: '' } } catch (e) { return { result: null, error: e instanceof Error ? e.message : '状态无法恢复。' } } }, [d.config, d.commands])
  const guide = useMemo(() => d.scenario === 'manual' ? [] : scenarioCommands(d.config, d.scenario), [d.config, d.scenario])
  const next = same(d.commands, guide.slice(0, d.commands.length)) ? guide[d.commands.length] : undefined
  const completed = state.attempts.find((a) => a.id === state.activeAttemptId)
  const stale = !!completed && identity(completed.draft) !== identity(d)
  const changedAnswers = !!completed && answersIdentity(completed.draft) !== answersIdentity(d)
  const finished = new Set(state.attempts.filter((a) => a.evaluation.status === 'pass' && a.evaluation.explanation && a.draft.scenario !== 'manual').map((a) => a.draft.scenario))
  const edit = (value: Draft) => { try { runModel(value.config, value.commands); session.edit(value); setError('') } catch (e) { setError(e instanceof Error ? e.message : '操作无效。') } }
  const act = (command: Command) => edit({ ...d, commands: [...d.commands, command] })
  const config = (patch: Partial<Config>) => edit({ ...d, config: { ...d.config, ...patch }, commands: [] })
  const answer = (field: 'prediction' | 'observedAnswer' | 'actualAnswer' | 'valueAnswer' | 'rejectedAnswer' | 'reasonAnswer' | 'reflection', value: string) => edit({ ...d, [field]: value })
  const disabled = !state.ready || !frame.result || d.commands.length >= MAX_COMMANDS
  const lease = labId === 'lease-fencing'
  const metadata = exercises.find((e) => e.id === labId)!
  return <main className={styles.page}>
    <nav className={styles.nav} aria-label="协调实验导航"><Link href="/practice">← 全部实验</Link><span>{lease ? 'LEASE / FENCING' : 'HEARTBEAT'}</span><Link href={lease ? '/learn/leases-locks' : '/learn/heartbeat'}>相关原理</Link></nav>
    <header className={styles.hero}><div><span className={styles.eyebrow}>可操作协调协议 LAB</span><h1>{metadata.title}</h1><p>{metadata.summary}</p></div><div className={styles.progress} aria-label="协调实验学习进度"><strong>{finished.size} / 3 故障挑战已验证</strong><span>分别核对真实状态、局部判断与写入权限</span></div></header>
    <LabConceptLinks labId={labId} />
    <div className={styles.scenarios} role="group" aria-label="协调故障场景">{scenariosFor(labId).map((scenario) => <button key={scenario} disabled={!state.ready} aria-pressed={d.scenario === scenario} onClick={() => edit({ ...initialDraft(labId), scenario, config: d.config })}>{scenarioLabels[scenario]}</button>)}<span role="status" data-testid="coordination-save-status">{storageLabel(state)}</span></div>
    <StorageNotice state={state} session={session} className={styles.error} saveLabel="重试保存协调实验" />
    {state.rejected ? <p role="alert">{state.rejected} 条记录不能验证，保留原记录并排除评分。</p> : null}
    <section className={styles.configuration} aria-label="协调协议配置"><div className={styles.settings}>
      <label>心跳间隔<select aria-label="心跳间隔" disabled={!state.ready} value={d.config.intervalMs} onChange={(e) => config({ intervalMs: Number(e.target.value) })}>{[100, 500].map((v) => <option key={v} value={v}>{v} ms</option>)}</select></label>
      <label>检测超时<select aria-label="检测超时" disabled={!state.ready} value={d.config.timeoutMs} onChange={(e) => config({ timeoutMs: Number(e.target.value) })}>{[300, 1000, 2000].map((v) => <option key={v} value={v}>{v} ms</option>)}</select></label>
      {lease ? <><label>租约有效期<select aria-label="租约有效期" disabled={!state.ready} value={d.config.leaseMs} onChange={(e) => config({ leaseMs: Number(e.target.value) })}>{[500, 1500, 5000].map((v) => <option key={v} value={v}>{v} ms</option>)}</select></label><label>资源端 Fencing<select aria-label="资源端 Fencing" disabled={!state.ready} value={String(d.config.fencing)} onChange={(e) => config({ fencing: e.target.value === 'true' })}><option value="false">关闭：直接接受写入</option><option value="true">开启：拒绝低于已接受世代的 token</option></select></label></> : null}
    </div><p className={styles.note}>调整参数从空状态重开，历史尝试保留。时间仅由你的操作推进。</p></section>
    <section className={styles.guide} aria-label="协调步骤引导"><div><strong>{scenarioLabels[d.scenario]}</strong><p>{goals[d.scenario]}</p></div><div className={styles.guideActions}>{d.scenario !== 'manual' ? <><button className={styles.primary} disabled={disabled || !next} onClick={() => { if (next) act(next) }}>{next ? `下一步：${commandLabel(next)}` : '向导已完成或进入自由操作'}</button><button disabled={!state.ready} onClick={() => edit({ ...d, commands: guide })}>运行完整协调故障示例</button></> : null}<button disabled={!state.ready || !state.undoCount} onClick={() => session.undo()}>撤销</button><button disabled={!state.ready || !state.redoCount} onClick={() => session.redo()}>重做</button><button disabled={!state.ready} onClick={() => edit({ ...d, commands: [] })}>清空协调实验</button></div></section>
    {error || frame.error ? <p role="alert" className={styles.error}>{error || frame.error}<button onClick={() => edit(initialDraft(labId))}>恢复默认协调实验</button></p> : null}
    {frame.result ? <CoordinationLiveView state={frame.result} config={d.config} act={act} disabled={disabled} showLease={lease} /> : null}
    <section className={styles.panel}><h2>核对观察与事实</h2><div className={styles.answers}>
      <label>最初预测<select aria-label="协调实验预测" disabled={!state.ready} value={d.prediction} onChange={(e) => answer('prediction', e.target.value)}><option value="">预测允许出错</option><option value="unknown">还不确定</option><option value="dead">检测超时就能确定节点死亡</option><option value="uncertain">观察者可能误判；持有权和写入还需检查</option></select></label>
      <label>此刻观察者对 A 的判断<select aria-label="观察者判断作答" disabled={!state.ready} value={d.observedAnswer} onChange={(e) => answer('observedAnswer', e.target.value)}><option value="">选择判断</option>{Object.entries(observationLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>此刻 A 的实际进程状态<select aria-label="真实状态作答" disabled={!state.ready} value={d.actualAnswer} onChange={(e) => answer('actualAnswer', e.target.value)}><option value="">选择真实状态</option>{Object.entries(processLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {lease ? <><label>资源最终值<input aria-label="资源结果作答" disabled={!state.ready} value={d.valueAnswer} maxLength={40} onChange={(e) => answer('valueAnswer', e.target.value)} /></label><label>拒绝几次写入？<input aria-label="拒绝写入作答" disabled={!state.ready} value={d.rejectedAnswer} inputMode="numeric" maxLength={5} onChange={(e) => answer('rejectedAnswer', e.target.value)} /></label></> : null}
      <label>为什么？<select aria-label="协调边界解释" disabled={!state.ready} value={d.reasonAnswer} onChange={(e) => answer('reasonAnswer', e.target.value)}><option value="">选择解释</option><option value={lease ? 'resource-token-check' : 'observation-not-proof'}>{lease ? '持有权、故障怀疑与资源已见 token 分别检查' : '心跳超时只提供怀疑，延迟消息也只证明曾经发送'}</option><option value="dead-proof">超时可以证明远端进程已经停止</option><option value="lease-revokes">租约过期自动撤销网络中的旧写入</option></select></label>
    </div><label>复盘（保存原文，不自动评分）<textarea aria-label="协调实验复盘" disabled={!state.ready} value={d.reflection} rows={2} maxLength={4000} onChange={(e) => answer('reflection', e.target.value)} /></label><button className={styles.primary} disabled={!state.ready || !frame.result || !d.commands.length} onClick={() => { try { session.run(); setError('') } catch (e) { setError(e instanceof Error ? e.message : '无法核验。') } }}>核对并保存协调结果</button>
      <div className={styles.feedback} data-testid="coordination-feedback" aria-live="polite"><h3>{stale ? '动作或配置已改变，请重新核验' : !completed ? '操作后核对结果' : completed.evaluation.task ? !changedAnswers && completed.evaluation.explanation ? '本关协调验证通过' : '故障目标满足，继续解释证据' : '故障或保护条件尚未满足'}</h3>{completed && !stale ? <ul>{completed.evaluation.messages.map((message) => <li key={message}>{message}</li>)}</ul> : <p>检查器重算完整命令和事件；当前状态不会被旧成绩覆盖。</p>}</div>
    </section>
    <section className={styles.panel} data-testid="coordination-history"><h2>已保存协调实验 · {state.attempts.length}</h2>{state.attempts.slice(0, 10).map((a) => <details key={a.id} className={styles.historyItem}><summary>{scenarioLabels[a.draft.scenario]} · {new Date(a.createdAt).toLocaleString('zh-CN')} · {a.evaluation.task && a.evaluation.explanation ? '已验证' : '已记录'}</summary><p>{a.draft.reflection || '尚未填写复盘。'}</p><button disabled={!state.ready} onClick={() => session.restoreAttempt(a)}>恢复协调尝试</button></details>)}</section>
    <footer className={styles.boundary}><strong>可执行模型的范围</strong><p>coordination-v1：两个 Worker、独立观察者、一个可信租约授予者和一个资源。命令瞬时执行，时间为共享的教学逻辑钟；不模拟真实时钟偏差、Raft 选举或授予者崩溃。申请和续租抽象为一次同步往返。进程重启世代单调是模型前提。</p><p>网络包由你递送或丢弃。暂停保留本地状态；崩溃丢失本地租约，已发消息仍在。资源保留最高已接受 token 并拒绝更低的世代；这不等于查询当前租约、阻止同世代乱序或保证恰好一次。最多 100 个命令、200 条心跳、20 条写入和 10,000 ms。撤销回退教学历史，不是生产环境回滚。</p></footer>
  </main>
}
