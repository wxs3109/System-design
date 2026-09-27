'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Check, CheckCircle2, ChevronRight, Circle, CircleAlert, FlaskConical, History, Lightbulb, Play, RotateCcw, Square } from 'lucide-react'
import type { ProjectFile } from '@system-design/model'
import { Workbench, type WorkbenchControls } from '@/components/workbench'
import { createWorkbenchSession, type CompletedWorkbenchRun } from '@/lib/workbench-session'
import { useWorkbenchStore, useWorkbenchStoreApi } from '@/lib/workbench-store-provider'
import { getExercise, type ExerciseDefinition, type ExerciseEvaluation, type ExerciseMetricDisplay, type ExerciseParameter } from './exercises'
import { readExerciseParameter, withExerciseParameter } from './exercise-project'
import styles from './practice.module.css'
import { LabConceptLinks } from '../learning/lab-concept-links'

const statusText = { pass: '目标已达成', fail: '继续调整', inconclusive: '需要完整运行' } as const
const formatMetric = (value: number | undefined, display: ExerciseMetricDisplay) => {
  if (value === undefined || !Number.isFinite(value)) return '—'
  const number = display.format === 'percent' ? value * 100 : value
  const unit = display.unit ?? (display.format === 'percent' ? '%' : '')
  return `${Number.isInteger(number) ? number.toLocaleString('zh-CN') : number.toFixed(1)}${unit ? `${unit === '%' ? '' : ' '}${unit}` : ''}`
}
const configurationLabel = (project: ProjectFile, parameters: readonly ExerciseParameter[]) => parameters.map((parameter) => {
  const value = readExerciseParameter(project, parameter)
  const choice = parameter.choices.find((item) => item.value === value)
  return `${parameters.length > 1 ? `${parameter.label}：` : ''}${choice?.label ?? '参数缺失'}`
}).join(' · ')
const hasComparableEvidence = (value: ExerciseEvaluation) => ['constraints', 'evidence'].every((id) => value.checks.some((check) => check.id === id && check.status === 'pass')) && value.checks.every((check) => check.status !== 'inconclusive')

function ExerciseSidebar({ exercise, controls, completed }: { exercise: ExerciseDefinition; controls: WorkbenchControls; completed: CompletedWorkbenchRun | null }) {
  const store = useWorkbenchStoreApi()
  const project = useWorkbenchStore((state) => state.project)
  const running = useWorkbenchStore((state) => state.running)
  const error = useWorkbenchStore((state) => state.error)
  const previous = controls.runs.find(run => !run.imported)
  const restoredEvidence = useRef(false)
  const evidence = useMemo(() => completed ?? (previous?.projectSnapshot ? { project: previous.projectSnapshot, result: previous.result } : null), [completed, previous])
  // Match WorkbenchSession's snapshot identity: any project edit needs a rerun.
  const stale = evidence !== null && JSON.stringify(evidence.project) !== JSON.stringify(project)
  const evaluation = useMemo(() => evidence ? exercise.evaluate(evidence.project, evidence.result) : null, [exercise, evidence])
  const attempts = useMemo(() => controls.runs.filter(run => !run.imported).slice(0, 5).flatMap((run) => run.projectSnapshot ? [{ run, label: configurationLabel(run.projectSnapshot, exercise.parameters), evaluation: exercise.evaluate(run.projectSnapshot, run.result) }] : []), [controls.runs, exercise])
  const comparison = attempts.find((attempt) => attempt.run.runId !== evidence?.result.runId && hasComparableEvidence(attempt.evaluation))

  useEffect(() => { if (controls.ready) store.getState().selectNode(exercise.focusNodeId) }, [controls.ready, store, exercise.focusNodeId])
  useEffect(() => {
    if (!controls.ready || restoredEvidence.current || completed) return
    restoredEvidence.current = true
    if (previous?.projectSnapshot && JSON.stringify(previous.projectSnapshot) === JSON.stringify(project)) store.getState().setResult(structuredClone(previous.result))
  }, [controls.ready, completed, previous, project, store])

  const changeParameter = (parameter: ExerciseParameter, value: number) => {
    try {
      const draft = withExerciseParameter(store.getState().project, parameter, value)
      const edit = store.getState().commitProjectEdit(draft)
      if (!edit.success) store.getState().setError(edit.issues.map((issue) => issue.message).join(' '))
      else store.getState().selectNode(parameter.nodeId)
    } catch (cause) { store.getState().setError(cause instanceof Error ? cause.message : '无法更新练习参数。') }
  }

  return <aside className={styles.sidebar} aria-label="练习任务与反馈">
    <div className={styles.lessonHeading}><span className={styles.eyebrow}>{exercise.category} · {exercise.difficulty}</span><h1>{exercise.title}</h1><p>{exercise.introduction}</p></div>
    <LabConceptLinks labId={exercise.id} />
    <div className={styles.givens} aria-label="固定实验条件">{exercise.givens.map((given) => <div key={given.label}><strong>{given.value}{given.unit ? <span> {given.unit}</span> : null}</strong><small>{given.label}</small></div>)}</div>
    <section className={styles.taskSection}><h2>题目说明</h2><p className={styles.promptText}>{exercise.prompt}</p></section>
    <section className={styles.taskSection}><h2>实验目标</h2><ul className={styles.objectives}>{exercise.objectives.map((objective) => <li key={objective}><Circle size={11} /><span>{objective}</span></li>)}</ul><p className={styles.timing}>{exercise.observationNote}</p></section>
    <section className={styles.taskSection}><h2>你的设计 <span>{exercise.parameters.length} 项可调整参数</span></h2>
      {exercise.parameters.map((parameter) => <div key={parameter.id} className={styles.parameterGroup} data-parameter-id={parameter.id}>
        <h3>{parameter.label}</h3><div className={styles.parameterChoices} role="group" aria-label={parameter.label}>{parameter.choices.map((choice) => <button key={choice.value} type="button" aria-label={choice.label} aria-pressed={readExerciseParameter(project, parameter) === choice.value} disabled={running || !controls.ready} onClick={() => changeParameter(parameter, choice.value)}><strong>{choice.value}</strong><small>{parameter.unit}</small></button>)}</div>
      </div>)}
      <button className={styles.runButton} type="button" disabled={!controls.ready || running} onClick={() => void controls.run()}>{running ? <><FlaskConical size={17} />模拟运行中…</> : <><Play size={17} fill="currentColor" />运行并检查</>}</button>
      <div className={styles.secondaryActions}>{running ? <button type="button" onClick={controls.cancel}><Square size={13} />取消运行</button> : <button type="button" disabled={!controls.ready} onClick={controls.reset}><RotateCcw size={13} />重新开始</button>}<span>{controls.ready ? '进度保存在此浏览器' : '正在恢复练习…'}</span></div>
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    </section>
    <Feedback exercise={exercise} evaluation={evaluation} stale={stale} restored={!completed && evidence !== null} {...(comparison ? { comparison: { label: comparison.label, evaluation: comparison.evaluation } } : {})} />
    {exercise.hints.length > 0 ? <details className={styles.hint}><summary><Lightbulb size={15} />需要一点提示？<ChevronRight size={13} /></summary>{exercise.hints.map((hint) => <p key={hint}>{hint}</p>)}</details> : null}
    <section className={styles.attempts} data-testid="exercise-attempts"><h2><History size={15} />最近尝试</h2>{attempts.length ? <ol>{attempts.map(({ run, label, evaluation: attempt }) => <li key={run.runId}><span className={attempt.status === 'pass' ? styles.successDot : styles.attemptDot} /><div><strong>{label}</strong><small>{new Date(run.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} · {statusText[attempt.status]}</small></div><span>{formatMetric(attempt.metrics[exercise.attemptMetric.key], exercise.attemptMetric)}<small>{exercise.attemptMetric.label}</small></span></li>)}</ol> : <p>完整运行一次后，这里会记录你的设计和结果。</p>}</section>
    <p className={styles.boundary}>学习模型 · {exercise.boundary} 每道练习与自由工作台分别保存。</p>
  </aside>
}

function Feedback({ exercise, evaluation, stale, restored, comparison }: { exercise: ExerciseDefinition; evaluation: ExerciseEvaluation | null; stale: boolean; restored: boolean; comparison?: { label: string; evaluation: ExerciseEvaluation } }) {
  const status = stale ? 'inconclusive' : evaluation?.status
  return <section className={`${styles.feedback} ${status === 'pass' ? styles.feedbackPass : ''}`} data-testid="exercise-feedback" aria-live="polite">
    <h2>{status === 'pass' ? <CheckCircle2 size={18} /> : evaluation ? <CircleAlert size={18} /> : <FlaskConical size={18} />}{stale ? '有未运行的修改' : evaluation ? statusText[evaluation.status] : '等待第一次实验'}</h2>
    <p>{stale ? '当前设计已改变。以下是上次运行的证据，请重新运行验证新设计。' : evaluation?.summary ?? '运行后会按本题目标检查实际结果，并显示对应的证据。'}</p>
    {restored ? <p className={styles.restoredLabel}>已恢复上次保存的运行证据</p> : null}
    {evaluation ? <>
      <div className={styles.evidenceNumbers}>{exercise.resultMetrics.map((metric) => <div key={metric.key}><strong>{formatMetric(evaluation.metrics[metric.key], metric)}</strong><span>{metric.label}</span></div>)}</div>
      {!stale && comparison && hasComparableEvidence(evaluation) ? <div className={styles.comparison} data-testid="exercise-comparison"><h3>与上次有效运行对比</h3><p>{comparison.label}</p><table><thead><tr><th>指标</th><th>上次</th><th>本次</th></tr></thead><tbody>{exercise.resultMetrics.map((metric) => <tr key={metric.key}><th>{metric.label}</th><td>{formatMetric(comparison.evaluation.metrics[metric.key], metric)}</td><td>{formatMetric(evaluation.metrics[metric.key], metric)}</td></tr>)}</tbody></table></div> : null}
      <ul>{evaluation.checks.map((check) => <li key={check.id} className={check.status === 'pass' ? styles.checkPass : styles.checkOther}>{check.status === 'pass' ? <Check size={14} /> : <CircleAlert size={14} />}<div><strong>{check.label}</strong><span>{check.message}</span></div></li>)}</ul>
    </> : null}
  </section>
}

function ExerciseWorkbench({ exercise }: { exercise: ExerciseDefinition }) {
  const [session] = useState(() => createWorkbenchSession({ id: `practice:${exercise.id}:v${exercise.version}`, initialProject: exercise.createProject(`practice:${exercise.id}:v${exercise.version}`) }))
  const [completed, setCompleted] = useState<CompletedWorkbenchRun | null>(null)
  return <div className={styles.practice}>
    <nav className={styles.practiceNav} aria-label="练习导航"><Link href="/practice"><ArrowLeft size={15} />全部练习</Link><span><FlaskConical size={16} />System Design Lab</span><Link href="/">自由工作台 <ChevronRight size={14} /></Link></nav>
    <div className={styles.workspace}><Workbench session={session} embedded defaultPanels={{ faults: false, inspector: false, results: true }} onRunCompleted={setCompleted} sidebar={(controls) => <ExerciseSidebar exercise={exercise} controls={controls} completed={completed} />} /></div>
  </div>
}

export function PracticeWorkbench({ exerciseId }: { exerciseId: string }) {
  const exercise = getExercise(exerciseId)
  if (!exercise) throw new Error('Unknown exercise.')
  return <ExerciseWorkbench key={`${exercise.id}@${exercise.version}`} exercise={exercise} />
}
