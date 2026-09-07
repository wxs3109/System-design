'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Check, CheckCircle2, ChevronRight, Circle, CircleAlert, FlaskConical, History, Lightbulb, Play, RotateCcw, Square } from 'lucide-react'
import { Workbench, type WorkbenchControls } from '@/components/workbench'
import { createWorkbenchSession, type CompletedWorkbenchRun } from '@/lib/workbench-session'
import { useWorkbenchStore, useWorkbenchStoreApi } from '@/lib/workbench-store-provider'
import { getExercise, type ExerciseDefinition, type ExerciseEvaluation } from './exercises'
import styles from './practice.module.css'

const statusText = { pass: '目标已达成', fail: '继续调整', inconclusive: '需要完整运行' } as const
const format = (value: number | undefined, unit = '') => value === undefined ? '—' : `${Number.isInteger(value) ? value.toLocaleString('zh-CN') : value.toFixed(1)}${unit}`

function ExerciseSidebar({ exercise, controls, completed }: { exercise: ExerciseDefinition; controls: WorkbenchControls; completed: CompletedWorkbenchRun | null }) {
  const store = useWorkbenchStoreApi()
  const project = useWorkbenchStore((state) => state.project)
  const running = useWorkbenchStore((state) => state.running)
  const error = useWorkbenchStore((state) => state.error)
  const service = project.topology.nodes.find((node) => node.id === exercise.editableParameter.nodeId)
  const replicas = service?.type === 'service' ? service.config.replicas : undefined
  const previous = controls.runs[0]
  const restoredEvidence = useRef(false)
  const evidence = useMemo(() => completed ?? (previous?.projectSnapshot ? { project: previous.projectSnapshot, result: previous.result } : null), [completed, previous])
  const stale = evidence !== null && JSON.stringify(evidence.project) !== JSON.stringify(project)
  const evaluation = useMemo(() => evidence ? exercise.evaluate(evidence.project, evidence.result) : null, [exercise, evidence])
  const attempts = useMemo(() => controls.runs.slice(0, 5).flatMap((run) => run.projectSnapshot ? [{ run, evaluation: exercise.evaluate(run.projectSnapshot, run.result) }] : []), [controls.runs, exercise])

  useEffect(() => { store.getState().selectNode(exercise.editableParameter.nodeId) }, [store, exercise.editableParameter.nodeId])
  useEffect(() => {
    if (!controls.ready || restoredEvidence.current || completed) return
    restoredEvidence.current = true
    if (previous?.projectSnapshot && JSON.stringify(previous.projectSnapshot) === JSON.stringify(project)) store.getState().setResult(structuredClone(previous.result))
  }, [controls.ready, completed, previous, project, store])

  const changeReplicas = (count: number) => {
    const draft = structuredClone(store.getState().project)
    const target = draft.topology.nodes.find((node) => node.id === exercise.editableParameter.nodeId)
    if (target?.type !== 'service') { store.getState().setError('找不到练习的 API Service，请重新开始。'); return }
    target.config.replicas = count
    const edit = store.getState().commitProjectEdit(draft)
    if (!edit.success) store.getState().setError(edit.issues.map((issue) => issue.message).join(' '))
  }

  return <aside className={styles.sidebar} aria-label="练习任务与反馈">
    <div className={styles.lessonHeading}><span className={styles.eyebrow}>01 / 容量与排队</span><h1>{exercise.title}</h1><p>先运行 1 个副本观察基线，再选择你认为足够的副本数量。</p></div>
    <div className={styles.givens} aria-label="固定实验条件"><div><strong>120<span> /s</span></strong><small>请求到达率</small></div><div><strong>200<span> ms</span></strong><small>每次处理耗时</small></div><div><strong>10</strong><small>每副本并发槽</small></div></div>
    <section className={styles.taskSection}><h2>实验目标</h2><ul className={styles.objectives}>{exercise.objectives.slice(0, 3).map((objective) => <li key={objective}><Circle size={11} /><span>{objective}</span></li>)}</ul><p className={styles.timing}>前 6 秒持续注入请求，后 14 秒观察排空。最终队列变空，并不代表到达期间没有积压。</p></section>
    <section className={styles.taskSection}><h2>你的设计 <span>只调整副本数</span></h2>
      <div className={styles.replicaChoices} role="group" aria-label={exercise.editableParameter.label}>{Array.from({ length: exercise.editableParameter.max - exercise.editableParameter.min + 1 }, (_, index) => index + exercise.editableParameter.min).map((count) => <button key={count} type="button" aria-label={`${count} 个副本`} aria-pressed={replicas === count} disabled={running || !controls.ready} onClick={() => changeReplicas(count)}><strong>{count}</strong><small>副本</small></button>)}</div>
      <button className={styles.runButton} type="button" disabled={!controls.ready || running} onClick={() => void controls.run()}>{running ? <><FlaskConical size={17} />模拟运行中…</> : <><Play size={17} fill="currentColor" />运行并检查</>}</button>
      <div className={styles.secondaryActions}>{running ? <button type="button" onClick={controls.cancel}><Square size={13} />取消运行</button> : <button type="button" disabled={!controls.ready} onClick={controls.reset}><RotateCcw size={13} />重新开始</button>}<span>{controls.ready ? '进度保存在此浏览器' : '正在恢复练习…'}</span></div>
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    </section>
    <Feedback evaluation={evaluation} stale={stale} restored={!completed && evidence !== null} />
    <details className={styles.hint}><summary><Lightbulb size={15} />需要一点提示？<ChevronRight size={13} /></summary><p>固定耗时模型下，一个副本的处理能力约为 10 ÷ 0.2 = 50 请求/秒。比较总处理能力与 120 请求/秒，再用运行结果验证。增加副本后，也要检查是否还有多余资源。</p><p>输出面板的全程吞吐和利用率包含排空期。本题的排队检查专门观察 0–6 秒到达窗口。</p></details>
    <section className={styles.attempts} data-testid="exercise-attempts"><h2><History size={15} />最近尝试</h2>{attempts.length ? <ol>{attempts.map(({ run, evaluation: attempt }) => <li key={run.runId}><span className={attempt.status === 'pass' ? styles.successDot : styles.attemptDot} /><div><strong>{format(attempt.metrics.replicas)} 个副本</strong><small>{new Date(run.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} · {statusText[attempt.status]}</small></div><span>{format(attempt.metrics.arrivalWindowMaxQueue)}<small>最大排队</small></span></li>)}</ol> : <p>完整运行一次后，这里会记录你的设计和结果。</p>}</section>
    <p className={styles.boundary}>学习模型 · 本题结论基于固定耗时与并发假设，不代表生产容量保证。练习与自由工作台分别保存。</p>
  </aside>
}

function Feedback({ evaluation, stale, restored }: { evaluation: ExerciseEvaluation | null; stale: boolean; restored: boolean }) {
  const status = stale ? 'inconclusive' : evaluation?.status
  return <section className={`${styles.feedback} ${status === 'pass' ? styles.feedbackPass : ''}`} data-testid="exercise-feedback" aria-live="polite">
    <h2>{status === 'pass' ? <CheckCircle2 size={18} /> : evaluation ? <CircleAlert size={18} /> : <FlaskConical size={18} />}{stale ? '有未运行的修改' : evaluation ? statusText[evaluation.status] : '等待第一次实验'}</h2>
    <p>{stale ? '当前设计已改变。以下是上次运行的证据，请重新运行验证新设计。' : evaluation?.summary ?? '运行后会检查到达期间的排队、延迟、完成情况和资源用量。'}</p>
    {restored ? <p className={styles.restoredLabel}>已恢复上次保存的运行证据</p> : null}
    {evaluation ? <><div className={styles.evidenceNumbers}><div><strong>{format(evaluation.metrics.arrivalWindowMaxQueue)}</strong><span>到达期最大排队</span></div><div><strong>{format(evaluation.metrics.latencyP95Ms, ' ms')}</strong><span>完成请求 p95</span></div></div><ul>{evaluation.checks.map((check) => <li key={check.id} className={check.status === 'pass' ? styles.checkPass : styles.checkOther}>{check.status === 'pass' ? <Check size={14} /> : <CircleAlert size={14} />}<div><strong>{check.label}</strong><span>{check.message}</span></div></li>)}</ul></> : null}
  </section>
}

export function PracticeWorkbench({ exerciseId }: { exerciseId: string }) {
  const exercise = getExercise(exerciseId)
  if (!exercise) throw new Error('Unknown exercise.')
  const [session] = useState(() => createWorkbenchSession({
    id: `practice:${exercise.id}:v${exercise.version}`,
    initialProject: exercise.createProject(`practice:${exercise.id}:v${exercise.version}`),
  }))
  const [completed, setCompleted] = useState<CompletedWorkbenchRun | null>(null)
  return <div className={styles.practice}>
    <nav className={styles.practiceNav} aria-label="练习导航"><Link href="/practice"><ArrowLeft size={15} />全部练习</Link><span><FlaskConical size={16} />System Design Lab</span><Link href="/">自由工作台 <ChevronRight size={14} /></Link></nav>
    <div className={styles.workspace}><Workbench session={session} embedded defaultPanels={{ faults: false, inspector: false, results: true }} onRunCompleted={setCompleted} sidebar={(controls) => <ExerciseSidebar exercise={exercise} controls={controls} completed={completed} />} /></div>
  </div>
}
