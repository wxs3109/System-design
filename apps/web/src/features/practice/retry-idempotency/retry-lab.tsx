'use client'

import Link from 'next/link'
import { StorageNotice, storageLabel } from '../../../components/experiments/storage-notice'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { ArrowLeft, ArrowRight, FlaskConical, RotateCcw, Undo2, Redo2 } from 'lucide-react'
import { LabConceptLinks } from '../../learning/lab-concept-links'
import { RetrySession } from './session'
import { experimentIdentity, initialDraft, progress, responseIdentity, retryExercise, scenarioCommands, scenarioLabels, type RetryDraft, type Scenario } from './lesson'
import { clientStatus, MAX_COMMANDS, runProtocol, same, strategies, strategyLabels, type Command, type ProtocolState, type RetryConfig } from './model'
import { clientLabels, LiveView, Timeline } from './live-view'
import styles from './retry-lab.module.css'

const commandLabel = (command: Command) => {
  switch (command.type) {
    case 'submit': return '提交请求'
    case 'deliver-request': return `递送 ${command.requestId}`
    case 'drop-request': return `丢弃 ${command.requestId}`
    case 'commit': return `处理 ${command.requestId}`
    case 'deliver-response': return `递送 ${command.responseId}`
    case 'drop-response': return `丢弃 ${command.responseId}`
    case 'advance': return `推进 ${command.ms} ms，触发到期计时器`
    case 'retry': return `用 ${command.key} 手动重试`
    case 'crash': return '服务崩溃'
    case 'restart': return '重启服务'
  }
}
const goals: Record<Scenario, string> = {
  'response-lost': '先递送并处理 request-1，再丢弃 response-1。推进超时并处理重试，核对实际创建次数与客户端收到的结果。',
  'request-lost': '在 request-1 到达服务之前丢弃它。观察不重试的后果，再让重试完成这项业务。',
  'late-request': '保留 request-1 不递送，等待超时重试。先处理 request-2 并返回结果，然后再递送旧请求，检查是否产生迟到的重复效果。',
  manual: '自由递送、延迟、丢弃、并发重试或让服务崩溃。一个命令推进一次状态变化，完整事件可随时核对。',
}

export function RetryIdempotencyLab() {
  const [session] = useState(() => new RetrySession())
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot)
  useEffect(() => { void session.load() }, [session])
  const { draft } = state
  const [error, setError] = useState('')
  const [comparison, setComparison] = useState<{ fingerprint: string; scenario: string; runs: { strategy: RetryConfig['strategy']; result: ProtocolState }[] } | null>(null)
  const frame = useMemo(() => { try { return { result: runProtocol(draft.config, draft.commands), error: '' } } catch (cause) { return { result: null, error: cause instanceof Error ? cause.message : '无法恢复实验。' } } }, [draft.config, draft.commands])
  const guide = useMemo(() => draft.scenario === 'manual' ? [] : scenarioCommands(draft.config, draft.scenario), [draft.config, draft.scenario])
  const guidePrefix = same(draft.commands, guide.slice(0, draft.commands.length))
  const nextCommand = guidePrefix ? guide[draft.commands.length] : undefined
  const completed = state.attempts.find((attempt) => attempt.id === state.activeAttemptId)
  const stale = !!completed && experimentIdentity(completed.draft) !== experimentIdentity(draft)
  const answersChanged = !!completed && responseIdentity(completed.draft) !== responseIdentity(draft)
  const achievements = useMemo(() => progress(state.attempts), [state.attempts])
  const disabled = !state.ready || draft.commands.length >= MAX_COMMANDS || !frame.result
  const edit = (next: RetryDraft) => {
    try { runProtocol(next.config, next.commands); session.edit(next); setError('') } catch (cause) { setError(cause instanceof Error ? cause.message : '操作无效。') }
  }
  const act = (command: Command) => edit({ ...draft, commands: [...draft.commands, command] })
  const configure = (config: RetryConfig) => edit({ ...draft, config, commands: [] })
  const answer = (field: 'prediction' | 'createdAnswer' | 'clientAnswer' | 'reasonAnswer' | 'reflection', value: string) => edit({ ...draft, [field]: value })
  const saveAttempt = () => { try { session.run(); setError('') } catch (cause) { setError(cause instanceof Error ? cause.message : '无法验证本次实验。') } }
  const compareStrategies = () => {
    if (draft.scenario === 'manual') return
    const scenario = draft.scenario
    const runs = strategies.map((strategy) => { const config = { ...draft.config, strategy }; return { strategy, result: runProtocol(config, scenarioCommands(config, scenario)) } })
    setComparison({ fingerprint: JSON.stringify([draft.config, scenario]), scenario: scenarioLabels[scenario], runs })
  }
  const verdict = completed?.evaluation
  const heading = stale ? '动作或配置已改变，请重新核验' : !verdict ? '操作后核对结果' : verdict.status === 'pass' ? answersChanged || !verdict.explanation ? '运行目标满足，继续解释证据' : '本关验证通过' : !verdict.noDuplicate ? '发现重复创建' : !verdict.settled ? '还有可能改变结果的在途工作' : '尚未同时满足单一效果与结果确认'
  return <main className={styles.page}>
    <nav className={styles.nav} aria-label="实验导航"><Link href="/practice"><ArrowLeft size={15} />全部实验</Link><span><FlaskConical size={17} />可操作协议 Lab</span><Link href="/learn/idempotency">幂等原理 <ArrowRight size={15} /></Link></nav>
    <header className={styles.hero}><div><span className={styles.eyebrow}>REQUEST / RESPONSE / FAILURE</span><h1>{retryExercise.title}</h1><p>递送或丢弃消息，推进超时，亲手观察一次业务意图如何产生一个或多个任务。</p></div><div className={styles.progress} aria-label="请求可靠性学习进度"><strong>{achievements.length} / 3 故障挑战已验证</strong><span>先操作，再用真实状态解释结果</span></div></header>
    <LabConceptLinks labId="retry-idempotency" />
    <div className={styles.scenarios} role="group" aria-label="请求故障场景">{(Object.keys(scenarioLabels) as Scenario[]).map((scenario) => <button key={scenario} disabled={!state.ready} aria-pressed={draft.scenario === scenario} onClick={() => edit({ ...initialDraft(), scenario, config: draft.config })}>{scenarioLabels[scenario]}</button>)}<span role="status" data-testid="retry-save-status">{storageLabel(state)}</span></div>
    <StorageNotice state={state} session={session} className={styles.error} saveLabel="重试保存协议实验" />
    {state.rejected ? <p role="alert" className={styles.error}>{state.rejected} 条记录无法验证；原始记录保留，未计入进度。</p> : null}
    <section className={styles.configuration} aria-label="请求实验配置"><div className={styles.strategyGroup} role="group" aria-label="重试策略">{strategies.map((strategy) => <button key={strategy} disabled={!state.ready} aria-pressed={draft.config.strategy === strategy} onClick={() => configure({ ...draft.config, strategy })}>{strategyLabels[strategy]}</button>)}</div><div className={styles.settings}>
      <label>等待超时<select aria-label="请求等待超时" disabled={!state.ready} value={draft.config.timeoutMs} onChange={(event) => configure({ ...draft.config, timeoutMs: Number(event.target.value) })}>{[100, 500, 1000].map((value) => <option key={value} value={value}>{value} ms</option>)}</select></label>
      <label>重试退避<select aria-label="请求重试退避" disabled={!state.ready} value={draft.config.retryDelayMs} onChange={(event) => configure({ ...draft.config, retryDelayMs: Number(event.target.value) })}>{[0, 100, 500].map((value) => <option key={value} value={value}>{value} ms · 固定</option>)}</select></label>
      <label>总尝试预算<select aria-label="请求尝试预算" disabled={!state.ready || draft.config.strategy === 'no-retry'} value={draft.config.maxAttempts} onChange={(event) => configure({ ...draft.config, maxAttempts: Number(event.target.value) })}>{[1, 2, 3, 5].map((value) => <option key={value} value={value}>{value} 次（含首次）</option>)}</select></label>
      <label>去重保留期<select aria-label="幂等记录保留期" disabled={!state.ready || draft.config.strategy !== 'idempotent'} value={draft.config.retentionMs} onChange={(event) => configure({ ...draft.config, retentionMs: Number(event.target.value) })}>{[200, 2000, 10000, 60000].map((value) => <option key={value} value={value}>{value} ms</option>)}</select></label>
    </div><p className={styles.note}>修改策略或参数会从空状态重新开始，可撤销，已保存尝试保留。不重试策略只发送一次。当前意图：{draft.config.callerId} / {draft.config.payload.videoId} / {draft.config.payload.format}，初始键 {draft.config.key}。</p></section>
    <section className={styles.guide} aria-label="逐步操作引导"><div><strong>{scenarioLabels[draft.scenario]}</strong><p>{goals[draft.scenario]}</p></div><div className={styles.guideActions}>{draft.scenario !== 'manual' ? <><button className={styles.primary} disabled={disabled || !nextCommand} onClick={() => { if (nextCommand) act(nextCommand) }}>{nextCommand ? `下一步：${commandLabel(nextCommand)}` : guidePrefix ? '向导步骤已执行完' : '已使用自由操作'}</button><button disabled={!state.ready} onClick={() => edit({ ...draft, commands: guide })}>运行完整故障示例</button></> : null}<button disabled={!state.ready || !state.undoCount} onClick={() => session.undo()}><Undo2 size={14} />撤销</button><button disabled={!state.ready || !state.redoCount} onClick={() => session.redo()}><Redo2 size={14} />重做</button><button disabled={!state.ready} onClick={() => edit({ ...draft, commands: [] })}><RotateCcw size={14} />清空操作重新开始</button></div></section>
    {error || frame.error ? <p role="alert" className={styles.error}>{error || frame.error} <button onClick={() => edit(initialDraft())}>恢复默认实验</button></p> : null}
    {draft.commands.length >= MAX_COMMANDS ? <p className={styles.note}>已达到 {MAX_COMMANDS} 步操作预算。可保存当前证据或开始新实验。</p> : null}
    {frame.result ? <><LiveView key={JSON.stringify(draft.config)} config={draft.config} state={frame.result} act={act} disabled={disabled} /><Timeline events={frame.result.events} /></> : null}
    <section className={styles.panel}><div className={styles.heading}><h2>同一种故障，对比三种策略</h2><button disabled={!state.ready || draft.scenario === 'manual'} onClick={compareStrategies}>运行三种策略对照</button></div><p className={styles.note}>每种策略从空状态执行同一类故障步骤；结果都由上面的状态模型计算。此表是独立对照，不改变当前手动操作或自动记为通关。</p>
      {comparison ? <><p>{comparison.scenario}{comparison.fingerprint !== JSON.stringify([draft.config, draft.scenario]) ? ' · 配置已变化，这是上一次对照' : ''}</p><div className={styles.tableScroll}><table aria-label="重试策略对照表"><thead><tr><th>策略</th><th>尝试</th><th>实际创建</th><th>重放</th><th>客户端获知</th></tr></thead><tbody>{comparison.runs.map(({ strategy, result }) => <tr key={strategy}><th>{strategyLabels[strategy]}</th><td>{result.requests.length}</td><td>{result.store.tasks.length}</td><td>{result.responses.filter((response) => response.outcome === 'replayed').length}</td><td>{result.knownTaskIds.join('、') || clientLabels[clientStatus(result)]}</td></tr>)}</tbody></table></div></> : <p className={styles.note}>可先手动体验，再运行这个对照。改变保留期、超时或预算会影响实际结果。</p>}
    </section>
    <section className={styles.panel}><h2>核对证据，保存这次尝试</h2><div className={styles.answers}>
      <label>最初的预测<select aria-label="请求实验预测" value={draft.prediction} onChange={(event) => answer('prediction', event.target.value)} disabled={!state.ready}><option value="">允许预测错误</option><option value="one">只会创建一个任务</option><option value="duplicate">可能重复创建</option><option value="unknown">还不确定</option></select></label>
      <label>服务端实际创建了几个任务？<input aria-label="任务创建次数作答" inputMode="numeric" maxLength={10} value={draft.createdAnswer} onChange={(event) => answer('createdAnswer', event.target.value)} disabled={!state.ready} /></label>
      <label>客户端目前知道什么？<select aria-label="客户端状态作答" value={draft.clientAnswer} onChange={(event) => answer('clientAnswer', event.target.value)} disabled={!state.ready}><option value="">按客户端视角回答</option>{Object.entries(clientLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>为什么超时不能直接代表业务失败？<select aria-label="超时含义作答" value={draft.reasonAnswer} onChange={(event) => answer('reasonAnswer', event.target.value)} disabled={!state.ready}><option value="">选择解释</option><option value="unknown-does-not-mean-failed">提交可能已发生，只是响应没到；也可能请求没到</option><option value="rolled-back">超时会自动撤销服务端任务</option><option value="always-created">只要超时，任务就一定已经创建</option></select></label>
    </div><label>复盘（原文保存，不自动判理解）<textarea aria-label="请求实验复盘" maxLength={4000} rows={2} value={draft.reflection} onChange={(event) => answer('reflection', event.target.value)} disabled={!state.ready} /></label><button className={styles.primary} disabled={!state.ready || !frame.result || !draft.commands.length} onClick={saveAttempt}>核对并保存结果</button>
      <div className={styles.feedback} aria-live="polite" data-testid="retry-feedback"><h3>{heading}</h3>{verdict && !stale ? <><div className={styles.verdicts}><span>证据 {verdict.evidence ? '有效' : '无效'}</span><span>单一效果 {verdict.noDuplicate ? '未重复' : '已重复'}</span><span>结果确认 {verdict.clientInformed ? '满足' : '不满足'}</span><span>解释 {answersChanged ? '待重新提交' : verdict.explanation ? '正确' : '待完成'}</span></div><ul>{verdict.messages.map((message) => <li key={message}>{message}</li>)}</ul></> : <p>{stale ? '当前面板仍是实时执行状态；上次保存的核验只适用于它自己的配置与操作记录。' : '运行模型后会分别检查业务效果、客户端观察和未完成消息，不会仅凭选择了幂等策略就判通过。'}</p>}</div>
    </section>
    <section className={styles.panel} data-testid="retry-history"><h2>已保存尝试 · {state.attempts.length}</h2><p className={styles.note}>当前操作会自动保存；点击“核对并保存结果”形成不可覆盖的尝试。恢复尝试后可从同一状态继续，最近 10 次列在下方。</p>{state.attempts.slice(0, 10).map((attempt) => <details key={attempt.id} className={styles.historyItem}><summary>{scenarioLabels[attempt.draft.scenario]} · {strategyLabels[attempt.draft.config.strategy]} · 创建 {attempt.result.store.tasks.length} 个 · {attempt.evaluation.status === 'pass' && attempt.evaluation.explanation ? '已验证' : '已记录'}</summary><p>{new Date(attempt.createdAt).toLocaleString('zh-CN')} · {attempt.draft.commands.length} 步操作</p><p>{attempt.draft.reflection || '尚未填写文字复盘。'}</p><button disabled={!state.ready} onClick={() => session.restoreAttempt(attempt)}>恢复协议尝试</button></details>)}</section>
    <footer className={styles.boundary}><strong>这个实验执行了什么</strong><p>request-retry-v1：一个客户端、一项视频任务提交意图、一台服务和一个符号稳定任务表。每次递送、丢弃、原子处理、崩溃或时间推进都执行状态转换。服务端处理步骤不计耗时，逻辑时间只驱动超时、固定重试退避和去重保留期。</p><p>幂等作用域为调用方 + create-transcode + key；同键绑定规范参数。稳定表的原子性与崩溃后保留是明确的模型前提，不是对真实数据库、跨服务事务或磁盘容灾的证明。上限为 5 次发送、100 个手动命令和 120,000 ms；预算结束仍可能结果未知。</p><p>撤销和重置用于回退或重开整个教学实验，不是向服务端发送业务回滚或补偿命令。</p></footer>
  </main>
}
