'use client'
import Link from 'next/link'
import { StorageNotice, storageLabel } from '../../../components/experiments/storage-notice'
import { useMemo, useState, type ReactNode } from 'react'
import { ModelPreview } from '../../../core/experiments/execution'
import { useExperiment } from '../../../components/experiments/use-experiment'
import type { LabSession } from '../../../core/experiments/session'
import { LabConceptLinks } from '../../learning/lab-concept-links'
import styles from '../retry-idempotency/retry-lab.module.css'

export interface ExperimentDraft<C, Cmd> { scenario: string; config: C; commands: Cmd[]; prediction: string; reflection: string }
interface Verdict { evidence: boolean; task: boolean; explanation: boolean; status: 'pass' | 'fail' | 'inconclusive'; messages: string[] }
export interface ExperimentAttempt<D> { id: string; createdAt: number; draft: D; evaluation: Verdict }
export interface Comparison { headings: string[]; rows: { label: string; values: (string | number)[] }[] }
interface Props<C, Cmd, D extends ExperimentDraft<C, Cmd>, S, A extends ExperimentAttempt<D>> {
  id: string; title: string; summary: string; conceptId: string; createSession: () => LabSession<D, A>
  initial: () => D; scenarios: Record<string, string>; goals: Record<string, string>; selectScenario: (draft: D, scenario: string) => D
  runModel: (config: C, commands: readonly Cmd[]) => S; guide: (draft: D) => Cmd[]; commandLabel: (command: Cmd) => string; maxCommands: number
  renderConfig: (draft: D, edit: (draft: D) => void, disabled: boolean) => ReactNode
  renderLive: (draft: D, result: S, act: (command: Cmd) => void, disabled: boolean) => ReactNode
  renderAnswers: (draft: D, edit: (draft: D) => void, disabled: boolean) => ReactNode
  compare: (draft: D) => Comparison; boundary: string[]
}
const executionKey = <C, Cmd,>(d: ExperimentDraft<C, Cmd>) => JSON.stringify([d.scenario, d.config, d.commands])
const answerKey = <C, Cmd,>(d: ExperimentDraft<C, Cmd>) => JSON.stringify(Object.fromEntries(Object.entries(d).filter(([key]) => !['scenario', 'config', 'commands'].includes(key))))

/** Shared learning/session UI. Execution and grading remain owned by each lab's contract. */
export function ProtocolExperiment<C, Cmd, D extends ExperimentDraft<C, Cmd>, S, A extends ExperimentAttempt<D>>(props: Props<C, Cmd, D, S, A>) {
  const { session, state } = useExperiment(props.createSession)
  const { draft: d } = state
  const { runModel } = props
  const [error, setError] = useState('')
  const [comparison, setComparison] = useState<{ key: string; result: Comparison } | null>(null)
  const preview = useMemo(() => new ModelPreview((input: { config: C; commands: readonly Cmd[] }) => runModel(input.config, input.commands)), [runModel])
  const frame = useMemo(() => { try { return { result: preview.read({ config: d.config, commands: d.commands }), error: '' } } catch (e) { return { result: null, error: e instanceof Error ? e.message : '实验状态无法恢复。' } } }, [preview, d.config, d.commands])
  const guide = props.guide(d)
  const next = JSON.stringify(d.commands) === JSON.stringify(guide.slice(0, d.commands.length)) ? guide[d.commands.length] : undefined
  const completed = state.attempts.find((a) => a.id === state.activeAttemptId)
  const stale = !!completed && executionKey(completed.draft) !== executionKey(d)
  const changedAnswers = !!completed && answerKey(completed.draft) !== answerKey(d)
  const finished = new Set(state.attempts.filter((a) => a.evaluation.task && a.evaluation.explanation && a.draft.scenario !== 'manual').map((a) => a.draft.scenario))
  const edit = (value: D) => { try { preview.read({ config: value.config, commands: value.commands }); session.edit(value); setError('') } catch (e) { setError(e instanceof Error ? e.message : '操作无效。') } }
  const act = (command: Cmd) => edit({ ...d, commands: [...d.commands, command] })
  const disabled = !state.ready || frame.result === null || d.commands.length >= props.maxCommands
  const compare = () => { try { setComparison({ key: JSON.stringify([d.scenario, d.config]), result: props.compare(d) }); setError('') } catch (e) { setError(e instanceof Error ? e.message : '无法比较。') } }
  return <main className={styles.page}>
    <nav className={styles.nav} aria-label="实验导航"><Link href="/practice">← 全部实验</Link><span>预测 · 操作 · 核验证据</span><Link href={`/learn/${props.conceptId}`}>相关原理</Link></nav>
    <header className={styles.hero}><div><span className={styles.eyebrow}>系统设计基础 LAB</span><h1>{props.title}</h1><p>{props.summary}</p></div><div className={styles.progress} aria-label="实验学习进度"><strong>{finished.size} / {Object.keys(props.scenarios).filter((key) => key !== 'manual').length} 挑战已验证</strong><span>根据实际结果核验，不按策略名称评分</span></div></header>
    <LabConceptLinks labId={props.id} />
    <div className={styles.scenarios} role="group" aria-label="实验场景">{Object.entries(props.scenarios).map(([id, label]) => <button key={id} disabled={!state.ready} aria-pressed={d.scenario === id} onClick={() => edit(props.selectScenario(d, id))}>{label}</button>)}<span role="status" data-testid="experiment-save-status">{storageLabel(state)}</span></div>
    <StorageNotice state={state} session={session} className={styles.error} saveLabel="重试保存实验" />
    {state.rejected ? <p role="alert" className={styles.error}>{state.rejected} 条记录无法验证，保留原记录并排除评分。</p> : null}
    <section className={styles.configuration} aria-label="实验配置">{props.renderConfig(d, edit, !state.ready)}<p className={styles.note}>修改配置从空状态重开，可以撤销；历史尝试保留。更换挑战不会清除已保存的证据。</p></section>
    <section className={styles.guide} aria-label="实验步骤引导"><div><strong>{props.scenarios[d.scenario]}</strong><p>{props.goals[d.scenario]}</p></div><div className={styles.guideActions}>{d.scenario !== 'manual' ? <><button className={styles.primary} disabled={disabled || !next} onClick={() => { if (next) act(next) }}>{next ? `下一步：${props.commandLabel(next)}` : '向导已完成或进入自由操作'}</button><button disabled={!state.ready} onClick={() => edit({ ...d, commands: guide })}>运行完整实验示例</button></> : null}<button disabled={!state.ready || !state.undoCount} onClick={() => session.undo()}>撤销</button><button disabled={!state.ready || !state.redoCount} onClick={() => session.redo()}>重做</button><button disabled={!state.ready} onClick={() => edit({ ...d, commands: [] })}>清空当前实验</button></div></section>
    {error || frame.error ? <p role="alert" className={styles.error}>{error || frame.error} <button onClick={() => edit(props.initial())}>恢复默认实验</button></p> : null}
    {d.commands.length >= props.maxCommands ? <p className={styles.note}>已到本次操作预算，可保存现有证据或重开实验。</p> : null}
    {frame.result !== null ? <div id="experiment-state">{props.renderLive(d, frame.result, act, disabled)}</div> : null}
    <section className={styles.panel}><div className={styles.heading}><h2>相同条件，比较策略</h2><button disabled={!state.ready || d.scenario === 'manual'} onClick={compare}>运行策略对照</button></div><p className={styles.note}>对照逐条运行同一模型，不改变当前操作，也不自动计为通关。</p>{comparison ? <><p>{comparison.key === JSON.stringify([d.scenario, d.config]) ? '当前配置的独立对照' : '配置已变化，这是上次对照'}</p><div className={styles.tableScroll}><table aria-label="实验策略对照表"><thead><tr><th>策略</th>{comparison.result.headings.map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{comparison.result.rows.map((row) => <tr key={row.label}><th>{row.label}</th>{row.values.map((value, index) => <td key={index}>{value}</td>)}</tr>)}</tbody></table></div></> : null}</section>
    <section className={styles.panel}><h2>根据实际证据作答</h2><label>最初预测<select aria-label="实验预测" value={d.prediction} disabled={!state.ready} onChange={(e) => edit({ ...d, prediction: e.target.value })}><option value="">预测允许出错</option><option value="unknown">还不确定</option><option value="safe">当前策略能满足目标</option><option value="risk">当前策略可能违反目标</option></select></label>{props.renderAnswers(d, edit, !state.ready)}<label>复盘（保存原文，不自动评分）<textarea aria-label="实验复盘" value={d.reflection} rows={2} maxLength={4000} disabled={!state.ready} onChange={(e) => edit({ ...d, reflection: e.target.value })} /></label><button className={styles.primary} disabled={!state.ready || frame.result === null || !d.commands.length} onClick={() => { try { session.run(); setError('') } catch (e) { setError(e instanceof Error ? e.message : '无法核验。') } }}>核对并保存实验</button>
      <div className={styles.feedback} data-testid="experiment-feedback" aria-live="polite"><h3>{stale ? '动作或配置已改变，请重新核验' : !completed ? '操作后核对结果' : completed.evaluation.task ? !changedAnswers && completed.evaluation.explanation ? '本关实验验证通过' : '运行目标满足，继续解释证据' : '运行目标尚未满足'}</h3>{changedAnswers && !stale ? <p>作答已修改，下方是上次核验记录；重新保存后更新解释结论。</p> : null}{completed && !stale ? <ul>{completed.evaluation.messages.map((message) => <li key={message}>{message}</li>)}</ul> : <p>检查器重算完整结果和事件，记录未完成工作与反例。</p>}</div>
    </section>
    <section className={styles.panel} data-testid="experiment-history"><h2>已保存实验 · {state.attempts.length}</h2>{state.attempts.slice(0, 10).map((a) => <details className={styles.historyItem} key={a.id}><summary>{props.scenarios[a.draft.scenario]} · {a.evaluation.task && a.evaluation.explanation ? '已验证' : '已记录'}</summary><p>{new Date(a.createdAt).toLocaleString('zh-CN')} · {a.draft.reflection || '尚未填写复盘。'}</p><button disabled={!state.ready} onClick={() => session.restoreAttempt(a)}>恢复实验尝试</button></details>)}</section>
    <footer className={styles.boundary}><strong>模型范围与成立条件</strong>{props.boundary.map((p) => <p key={p}>{p}</p>)}</footer>
  </main>
}
