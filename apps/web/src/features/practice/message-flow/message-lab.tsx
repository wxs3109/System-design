'use client'

import Link from 'next/link'
import { StorageNotice, storageLabel } from '../algorithm/storage-notice'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { ArrowLeft, RotateCcw, Undo2, Redo2 } from 'lucide-react'
import { LabConceptLinks } from '../../learning/lab-concept-links'
import { MessageSession } from './session'
import { answersIdentity, identity, initialDraft, messageExercises, productionCommands, progress, scenarioCommands, scenarioLabels, scenariosFor, type Draft, type LabId, type Scenario } from './lesson'
import { consumerLabels, producerLabels, MAX_COMMANDS, runModel, same, type Command, type Config, type State } from './model'
import { MessageLiveView } from './live-view'
import styles from '../retry-idempotency/retry-lab.module.css'

const commandLabel = (command: Command) => ({ 'create-task': '提交业务任务', relay: '发布 Outbox 待办', 'start-consumer': '开启投递', 'pause-consumer': '暂停新投递', 'crash-worker': 'Worker 崩溃', 'restart-worker': '重启 Worker', 'crash-producer': '生产者崩溃', 'restart-producer': '重启生产者', publish: '发送业务事件', 'accept-publication': 'Broker 接纳发布', 'drop-publication': '丢弃发布', 'deliver-confirm': '递送发布确认', 'drop-confirm': '丢弃发布确认', 'mark-sent': '标记 Outbox 已发送', 'deliver-work': '递送到 Worker', 'drop-work': '丢弃工作投递', process: '执行业务效果', checkpoint: '保存 Checkpoint', 'resend-ack': '重发 ACK', 'fail-work': '让处理失败', 'deliver-ack': '递送消费 ACK', 'drop-ack': '丢弃消费 ACK', redrive: '修复后重放', advance: '推进逻辑时间' })[command.type]
const goals: Record<Scenario, string> = {
  'before-effect': 'Worker 收到消息后，在执行业务效果之前崩溃。比较提前 ACK 与处理后确认，检查队列空了是否真的代表工作完成。',
  'after-effect': '业务效果刚发生就让 Worker 崩溃，尚未进行下一个独立步骤。观察单独保存 Checkpoint 留下的重做窗口。',
  'lost-ack': '保存业务效果和进度之后，丢弃 ACK，推进到可见性超时，再处理同一逻辑消息的重投。',
  'commit-gap': '只提交业务任务，然后在发送前让生产者崩溃。恢复后查看是否有可靠发送意图可以继续发布。',
  'confirm-gap': 'Broker 已接纳消息，但生产者在提交 Outbox 发送标记前崩溃。恢复后再次发布，检查重复副本与消费效果。',
  'consumer-gap': 'Outbox 已成功发送，Worker 在产生效果后崩溃。检验可靠发布是否也保护了消费者的效果/进度窗口。',
  manual: '自由交错生产、确认、消费与故障。可增加到两份在途投递，观察乱序完成、旧 ACK、死信和重放。',
}

export function MessageLab({ labId }: { labId: LabId }) { return <MessageExperiment key={labId} labId={labId} /> }
function MessageExperiment({ labId }: { labId: LabId }) {
  const [session] = useState(() => new MessageSession(labId))
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot)
  useEffect(() => { void session.load() }, [session])
  const { draft } = state
  const metadata = messageExercises.find((entry) => entry.id === labId)!
  const [error, setError] = useState('')
  const [comparison, setComparison] = useState<{ key: string; rows: { title: string; result: State }[] } | null>(null)
  const frame = useMemo(() => { try { return { result: runModel(draft.config, draft.commands), error: '' } } catch (cause) { return { result: null, error: cause instanceof Error ? cause.message : '实验无法恢复。' } } }, [draft.config, draft.commands])
  const guide = useMemo(() => draft.scenario === 'manual' ? [] : scenarioCommands(draft.config, draft.scenario), [draft.config, draft.scenario])
  const next = same(draft.commands, guide.slice(0, draft.commands.length)) ? guide[draft.commands.length] : undefined
  const completed = state.attempts.find((attempt) => attempt.id === state.activeAttemptId)
  const stale = !!completed && identity(completed.draft) !== identity(draft)
  const changedAnswers = !!completed && answersIdentity(completed.draft) !== answersIdentity(draft)
  const finished = useMemo(() => progress(state.attempts, labId), [state.attempts, labId])
  const edit = (value: Draft) => { try { runModel(value.config, value.commands); session.edit(value); setError('') } catch (cause) { setError(cause instanceof Error ? cause.message : '操作无效。') } }
  const act = (command: Command) => edit({ ...draft, commands: [...draft.commands, command] })
  const configure = (config: Config) => edit({ ...draft, config, commands: [] })
  const answer = (field: 'prediction' | 'effectAnswer' | 'checkpointAnswer' | 'ackAnswer' | 'reasonAnswer' | 'reflection', value: string) => edit({ ...draft, [field]: value })
  const save = () => { try { session.run(); setError('') } catch (cause) { setError(cause instanceof Error ? cause.message : '无法验证。') } }
  const compare = () => {
    if (draft.scenario === 'manual') return
    const scenario = draft.scenario
    const variants = labId === 'ack-checkpoint' ? (['early', 'split', 'atomic'] as const).map((consumer) => ({ title: consumerLabels[consumer], config: { ...draft.config, consumer } })) : (['direct', 'outbox'] as const).map((producer) => ({ title: producerLabels[producer], config: { ...draft.config, producer } }))
    setComparison({ key: JSON.stringify([draft.scenario, draft.config]), rows: variants.map(({ title, config }) => ({ title, result: runModel(config, scenarioCommands(config, scenario)) })) })
  }
  const disabled = !state.ready || draft.commands.length >= MAX_COMMANDS || !frame.result
  const verdict = completed?.evaluation
  return <main className={styles.page}>
    <nav className={styles.nav} aria-label="消息实验导航"><Link href="/practice"><ArrowLeft size={15} />全部实验</Link><span>{labId === 'ack-checkpoint' ? 'ACK / CHECKPOINT' : 'TRANSACTIONAL OUTBOX'}</span><Link href={labId === 'ack-checkpoint' ? '/learn/acknowledgements' : '/learn/transactional-outbox'}>相关原理</Link></nav>
    <header className={styles.hero}><div><span className={styles.eyebrow}>可操作消息协议 LAB</span><h1>{metadata.title}</h1><p>{metadata.summary}</p></div><div className={styles.progress} aria-label="消息实验学习进度"><strong>{finished.length} / 3 故障挑战已验证</strong><span>业务效果、恢复进度、交付确认分别检查</span></div></header>
    <LabConceptLinks labId={labId} />
    <div className={styles.scenarios} role="group" aria-label="消息故障场景">{scenariosFor(labId).map((scenario) => <button key={scenario} disabled={!state.ready} aria-pressed={draft.scenario === scenario} onClick={() => edit({ ...initialDraft(labId), scenario, config: draft.config })}>{scenarioLabels[scenario]}</button>)}<span role="status" data-testid="message-save-status">{storageLabel(state)}</span></div>
    <StorageNotice state={state} session={session} className={styles.error} saveLabel="重试保存消息实验" />
    {state.rejected ? <p role="alert" className={styles.error}>{state.rejected} 条记录无法验证，原记录保留并排除评分。</p> : null}
    <section className={styles.configuration} aria-label="消息协议配置"><div className={styles.settings}>
      <label>生产者提交方式<select aria-label="生产者提交方式" disabled={!state.ready || labId === 'ack-checkpoint'} value={draft.config.producer} onChange={(event) => configure({ ...draft.config, producer: event.target.value as Config['producer'] })}>{Object.entries(producerLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label>消费者处理策略<select aria-label="消费者处理策略" disabled={!state.ready} value={draft.config.consumer} onChange={(event) => configure({ ...draft.config, consumer: event.target.value as Config['consumer'] })}>{Object.entries(consumerLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label>可见性超时<select aria-label="消息可见性超时" disabled={!state.ready} value={draft.config.visibilityMs} onChange={(event) => configure({ ...draft.config, visibilityMs: Number(event.target.value) })}>{[100, 500, 1000].map((value) => <option key={value} value={value}>{value} ms</option>)}</select></label>
      <label>每轮投递预算<select aria-label="消息投递预算" disabled={!state.ready} value={draft.config.maxDeliveries} onChange={(event) => configure({ ...draft.config, maxDeliveries: Number(event.target.value) })}>{[2, 3, 5].map((value) => <option key={value} value={value}>{value} 次</option>)}</select></label>
      <label>同时在途额度<select aria-label="同时在途额度" disabled={!state.ready} value={draft.config.prefetch} onChange={(event) => configure({ ...draft.config, prefetch: Number(event.target.value) })}><option value={1}>1 份有效投递</option><option value={2}>2 份有效投递</option></select></label>
    </div><p className={styles.note}>改变策略从空状态重开，可撤销；历史尝试保留。旧凭据到期只释放 broker 额度，不会停止旧 Worker 的执行。</p></section>
    <section className={styles.guide} aria-label="消息步骤引导"><div><strong>{scenarioLabels[draft.scenario]}</strong><p>{goals[draft.scenario]}</p></div><div className={styles.guideActions}>{draft.scenario !== 'manual' ? <><button className={styles.primary} disabled={disabled || !next} onClick={() => { if (next) act(next) }}>{next ? `下一步：${commandLabel(next)}` : '向导已完成或进入自由操作'}</button><button disabled={!state.ready} onClick={() => edit({ ...draft, commands: guide })}>运行完整消息故障示例</button></> : null}<button disabled={!state.ready || !state.undoCount} onClick={() => session.undo()}><Undo2 size={14} />撤销</button><button disabled={!state.ready || !state.redoCount} onClick={() => session.redo()}><Redo2 size={14} />重做</button><button disabled={!state.ready} onClick={() => edit({ ...draft, commands: [] })}><RotateCcw size={14} />清空消息实验</button></div></section>
    {error || frame.error ? <p role="alert" className={styles.error}>{error || frame.error}<button onClick={() => edit(initialDraft(labId))}>恢复默认消息实验</button></p> : null}
    {draft.commands.length >= MAX_COMMANDS ? <p className={styles.note}>已经达到 150 个操作的预算；可以保存现有证据或重新开始。</p> : null}
    {frame.result ? <MessageLiveView config={draft.config} state={frame.result} act={act} produce={() => { try { edit({ ...draft, commands: productionCommands(draft.config, draft.commands) }) } catch (cause) { setError(cause instanceof Error ? cause.message : '不能生产消息。') } }} disabled={disabled} /> : null}
    <section className={styles.panel}><div className={styles.heading}><h2>相同故障，比较策略</h2><button disabled={!state.ready || draft.scenario === 'manual'} onClick={compare}>运行消息策略对照</button></div><p className={styles.note}>所有对照由相同状态模型执行对应故障步骤，不填入预置成功数字，也不自动计为通关。</p>{comparison ? <><p>{comparison.key === JSON.stringify([draft.scenario, draft.config]) ? '当前配置的独立对照' : '配置已变化，这是上次对照'}</p><div className={styles.tableScroll}><table aria-label="消息策略对照表"><thead><tr><th>策略</th><th>业务任务</th><th>发布次数</th><th>投递次数</th><th>效果</th><th>Checkpoint</th><th>确认副本</th></tr></thead><tbody>{comparison.rows.map(({ title, result }) => <tr key={title}><th>{title}</th><td>{result.tasks.length}</td><td>{result.publications.length}</td><td>{result.deliveries.length}</td><td>{result.effects.length}</td><td>{result.checkpoints.length}</td><td>{result.copies.filter((copy) => copy.status === 'acked').length}</td></tr>)}</tbody></table></div></> : null}</section>
    <section className={styles.panel}><h2>核对三个边界，保存证据</h2><div className={styles.answers}>
      <label>最初预测<select aria-label="消息实验预测" value={draft.prediction} disabled={!state.ready} onChange={(event) => answer('prediction', event.target.value)}><option value="">预测允许出错</option><option value="lost">可能丢工作</option><option value="duplicate">可能重复执行</option><option value="safe">可以安全恢复</option><option value="unknown">还不确定</option></select></label>
      <label>实际产生几次业务效果？<input aria-label="消息效果次数作答" value={draft.effectAnswer} disabled={!state.ready} inputMode="numeric" maxLength={10} onChange={(event) => answer('effectAnswer', event.target.value)} /></label>
      <label>持久 Checkpoint 有几条？<input aria-label="消息 Checkpoint 作答" value={draft.checkpointAnswer} disabled={!state.ready} inputMode="numeric" maxLength={10} onChange={(event) => answer('checkpointAnswer', event.target.value)} /></label>
      <label>Broker 已确认几份队列副本？<input aria-label="消息确认副本作答" value={draft.ackAnswer} disabled={!state.ready} inputMode="numeric" maxLength={10} onChange={(event) => answer('ackAnswer', event.target.value)} /></label>
      <label>这些计数是什么关系？<select aria-label="消息边界解释" value={draft.reasonAnswer} disabled={!state.ready} onChange={(event) => answer('reasonAnswer', event.target.value)}><option value="">选择解释</option><option value="separate-boundaries">提交、消费效果、恢复进度和交付确认是独立边界</option><option value="queue-empty">队列空了就代表业务完成</option><option value="outbox-once">使用 Outbox 就不会重复投递或执行</option><option value="ack-effect">每个 ACK 都等于新增一次业务效果</option></select></label>
    </div><label>复盘（原文保存，不自动判分）<textarea aria-label="消息实验复盘" value={draft.reflection} disabled={!state.ready} rows={2} maxLength={4000} onChange={(event) => answer('reflection', event.target.value)} /></label><button className={styles.primary} disabled={!state.ready || !frame.result || !draft.commands.length} onClick={save}>核对并保存消息结果</button>
      <div className={styles.feedback} data-testid="message-feedback" aria-live="polite"><h3>{stale ? '动作或配置已改变，请重新核验' : !verdict ? '操作后核对结果' : verdict.status === 'pass' ? changedAnswers || !verdict.explanation ? '运行目标满足，继续解释证据' : '本关消息验证通过' : !verdict.noDuplicates ? '发现重复业务效果' : !verdict.settled ? '还有在途或未处理工作' : '业务效果、进度或确认尚未满足目标'}</h3>{verdict && !stale ? <><div className={styles.verdicts}><span>证据 {verdict.evidence ? '有效' : '无效'}</span><span>效果 {verdict.noDuplicates && verdict.allEffects ? '每项一次' : '缺失或重复'}</span><span>进度 {verdict.allCheckpoints ? '完整' : '缺失'}</span><span>确认 {verdict.allAcknowledged ? '完成' : '未完成'}</span><span>解释 {changedAnswers ? '待提交' : verdict.explanation ? '正确' : '待完成'}</span></div><ul>{verdict.messages.map((message) => <li key={message}>{message}</li>)}</ul></> : <p>检查器核对实际账本与全部事件；不执行任何工作也不能通过。</p>}</div>
    </section>
    <section className={styles.panel} data-testid="message-history"><h2>已保存消息实验 · {state.attempts.length}</h2><p className={styles.note}>当前操作自动保存。核验生成不可覆盖的尝试，最近 10 次列在下方；恢复后可以继续操作同一状态。</p>{state.attempts.slice(0, 10).map((attempt) => <details className={styles.historyItem} key={attempt.id}><summary>{scenarioLabels[attempt.draft.scenario]} · {consumerLabels[attempt.draft.config.consumer]} · 效果 {attempt.result.effects.length} 次 · {attempt.evaluation.status === 'pass' && attempt.evaluation.explanation ? '已验证' : '已记录'}</summary><p>{producerLabels[attempt.draft.config.producer]} · {new Date(attempt.createdAt).toLocaleString('zh-CN')}</p><p>{attempt.draft.reflection || '尚未填写复盘。'}</p><button disabled={!state.ready} onClick={() => session.restoreAttempt(attempt)}>恢复消息尝试</button></details>)}</section>
    <footer className={styles.boundary}><strong>可执行模型的范围</strong><p>message-flow-v1：单一生产者、单一逻辑消费者、带可见性超时的队列和各自的符号稳定状态。业务效果是每个任务向完成账本追加一次记录；Worker 以 Checkpoint 判断重做。副本身份、投递凭据与逻辑消息身份分别记录，旧 ACK 不确认新凭据。</p><p>生产者任务与 Outbox、消费者效果与 Checkpoint 分别拥有本地原子边界；没有跨两者的全局事务。稳定存储和 broker 保留是本模型的明确前提；不模拟磁盘或 broker 崩溃，不承诺外部副作用恰好一次，也不实现某个真实 broker 的完整协议。</p><p>最多 3 个任务、12 次发布、30 次投递、150 个手动命令和 120,000 ms。命令步骤逻辑瞬时，时间只驱动到期；连续完成位置是任务序号，不冒充 Kafka offset。撤销/重置回退教学实验，不是业务回滚。</p></footer>
  </main>
}
