'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import type { ProjectFile } from '@system-design/model'
import { Workbench, type WorkbenchControls } from '@/components/workbench'
import { createWorkbenchSession, type CompletedWorkbenchRun } from '@/lib/workbench-session'
import { useWorkbenchStore, useWorkbenchStoreApi } from '@/lib/workbench-store-provider'
import { designEdge } from './short-link'
import { DesignNotebook } from './notebook'
import type { DesignExercise } from './types'
import styles from './design.module.css'

function Editor({ exercise, disabled }: { exercise: DesignExercise; disabled: boolean }) {
  const store = useWorkbenchStoreApi()
  const project = useWorkbenchStore((s) => s.project)
  const [source, setSource] = useState(exercise.sourceId)
  const [target, setTarget] = useState('')
  const [port, setPort] = useState<'out' | 'miss'>('out')
  const edit = (fn: (draft: ProjectFile) => void) => {
    const draft = structuredClone(project)
    fn(draft)
    const issue = exercise.editIssue(draft)
    if (issue) { store.getState().setError(issue); return }
    const result = store.getState().commitProjectEdit(draft)
    if (!result.success) store.getState().setError(result.issues.map((i) => i.message).join(' '))
  }
  const selectedSource = project.topology.nodes.some((n) => n.id === source) ? source : exercise.sourceId
  const selectedTarget = project.topology.nodes.some((n) => n.id === target && n.id !== selectedSource && n.type !== 'traffic') ? target : ''
  const selectedPort = project.topology.nodes.find((n) => n.id === selectedSource)?.type === 'cache' ? 'miss' : port === 'miss' ? 'out' : port
  return <section aria-label="设计工具箱"><h2>搭建与连接</h2><p>添加组件后，用下方连接表或画布端口连线。固定条件由检查器验证；画布上的违规编辑会收到反馈。</p>
    <div className={styles.actions}>{exercise.tools.map((tool) => <button key={tool.type} disabled={disabled || project.topology.nodes.filter((n) => n.type === tool.type).length >= tool.limit} onClick={() => edit((draft) => { draft.topology.nodes.push(tool.create(`${tool.type}-${crypto.randomUUID()}`, draft.topology.nodes.filter((n) => n.type === tool.type).length)) })}>添加 {tool.label}</button>)}</div>
    {project.topology.nodes.filter((n) => n.id !== exercise.sourceId).map((node) => <fieldset key={node.id} disabled={disabled}><legend>{node.name}</legend>{exercise.tools.find((t) => t.type === node.type)?.fields.map((field) => <label key={field.key}>{field.label}<select aria-label={field.label} value={Number(node.config[field.key])} onChange={(e) => edit((draft) => { draft.topology.nodes.find((n) => n.id === node.id)!.config[field.key] = Number(e.target.value) })}>{field.values.map((v) => <option key={v} value={v}>{v}</option>)}</select></label>)}<button onClick={() => edit((draft) => { draft.topology.nodes = draft.topology.nodes.filter((n) => n.id !== node.id); draft.topology.edges = draft.topology.edges.filter((e) => e.source !== node.id && e.target !== node.id) })}>移除 {node.name}</button></fieldset>)}
    <fieldset disabled={disabled}><legend>新增连接</legend>
      <label>连接起点<select aria-label="连接起点" value={selectedSource} onChange={(e) => setSource(e.target.value)}>{project.topology.nodes.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}</select></label>
      <label>出口<select aria-label="出口" value={selectedPort} onChange={(e) => setPort(e.target.value as 'out' | 'miss')}><option value={selectedPort}>{selectedPort === 'miss' ? 'miss：未命中回源' : 'out：同步请求'}</option></select></label>
      <label>连接终点<select aria-label="连接终点" value={selectedTarget} onChange={(e) => setTarget(e.target.value)}><option value="">请选择组件</option>{project.topology.nodes.filter((n) => n.id !== selectedSource && n.type !== 'traffic').map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}</select></label>
      <button disabled={!selectedTarget} onClick={() => edit((draft) => { const edge = designEdge(selectedSource, selectedTarget, selectedPort); if (!draft.topology.edges.some((e) => e.source === edge.source && e.target === edge.target && e.sourcePort === edge.sourcePort)) draft.topology.edges.push(edge) })}>连接组件</button>
    </fieldset>
    <ul aria-label="当前连接">{project.topology.edges.map((e) => <li key={e.id}>{project.topology.nodes.find((n) => n.id === e.source)?.name} ({e.sourcePort}) → {project.topology.nodes.find((n) => n.id === e.target)?.name} <button disabled={disabled} aria-label={`删除连接 ${e.id}`} onClick={() => edit((draft) => { draft.topology.edges = draft.topology.edges.filter((edge) => edge.id !== e.id) })}>删除</button></li>)}</ul>
  </section>
}

function Sidebar({ exercise, controls, completed }: { exercise: DesignExercise; controls: WorkbenchControls; completed: CompletedWorkbenchRun | null }) {
  const store = useWorkbenchStoreApi()
  const project = useWorkbenchStore((s) => s.project)
  const running = useWorkbenchStore((s) => s.running)
  const error = useWorkbenchStore((s) => s.error)
  const previous = controls.runs.find(run => !run.imported)
  const latest = completed ?? (previous?.projectSnapshot ? { project: previous.projectSnapshot, result: previous.result } : null)
  const stale = !!latest && JSON.stringify(latest.project) !== JSON.stringify(project)
  const attempts = useMemo(() => controls.runs.filter(run => !run.imported).flatMap((r) => r.projectSnapshot ? [{ ...r, evaluation: exercise.evaluate(r.projectSnapshot, r.result) }] : []), [controls.runs, exercise])
  const evaluation = latest ? exercise.evaluate(latest.project, latest.result) : null
  const [preflight, setPreflight] = useState<string | null>(null)
  const replace = (next: ProjectFile) => { const result = store.getState().commitProjectEdit(next); if (!result.success) store.getState().setError(result.issues.map((i) => i.message).join(' ')); setPreflight(null) }
  return <aside className={styles.sidebar} aria-label="综合设计任务">
    <span>综合设计 · 第一个可验证切片</span><h1>{exercise.title}</h1><p>{exercise.introduction}</p>
    <section><h2>痛点：为什么需要这个设计？</h2><ul>{exercise.pains.map((s) => <li key={s}>{s}</li>)}</ul></section>
    <section><h2>需求与验收目标</h2><ul>{exercise.requirements.map((s) => <li key={s}>{s}</li>)}</ul></section>
    <details><summary>接口与数据模型</summary><dl>{exercise.contracts.map((c) => <div key={c.name}><dt>{c.name}</dt><dd>{c.description}</dd></div>)}</dl></details>
    <p>{exercise.prompt}</p><Editor exercise={exercise} disabled={!controls.ready || running} />
    <div className={styles.actions}><button className={styles.primary} disabled={!controls.ready || running} onClick={() => { const structure = exercise.evaluate(project); if (structure.status === 'fail') { setPreflight(structure.checks.filter((c) => c.status === 'fail').map((c) => c.message).join(' ')); return }; setPreflight(null); void controls.run() }}>{running ? '运行中…' : '运行并验证设计'}</button>{running ? <button onClick={controls.cancel}>取消运行</button> : <button disabled={!controls.ready} onClick={() => replace(exercise.createProject(project.id))}>清空本题设计</button>}</div>
    <p>{controls.ready ? '设计与运行历史保存在此浏览器；各题独立。' : '正在恢复设计…'}</p>
    {preflight || error ? <p role="alert">{preflight ?? error}</p> : null}
    <section data-testid="design-feedback" aria-live="polite"><h2>{stale ? '设计已修改，请重新运行' : evaluation ? evaluation.status === 'pass' ? '本关目标已达成' : evaluation.status === 'fail' ? '继续调整设计' : '需要完整运行证据' : '等待验证设计'}</h2>
      <p>{stale ? '下面保留的是上次运行，不能证明当前设计。' : evaluation?.summary ?? '检查器将验证实际请求路径与性能，不根据组件名称打分。'}</p>
      {evaluation ? <><dl className={styles.metrics}>{exercise.resultMetrics.map((m) => <div key={m.key}><dt>{m.label}</dt><dd>{evaluation.metrics[m.key] === undefined ? '—' : (evaluation.metrics[m.key]! * (m.format === 'percent' ? 100 : 1)).toFixed(1)} {m.format === 'percent' ? '%' : m.unit}</dd></div>)}</dl><ul>{evaluation.checks.map((c) => <li key={c.id}><strong>{c.status === 'pass' ? '✓' : '○'} {c.label}</strong>：{c.message}</li>)}</ul></> : null}
    </section>
    <section data-testid="design-attempts"><h2>比较历史方案</h2><p>每次完整运行保存当时的拓扑与证据。恢复旧方案后可继续修改。</p><div className={styles.table}><table><thead><tr><th>方案</th>{exercise.resultMetrics.map((m) => <th key={m.key}>{m.label}</th>)}<th>结论</th></tr></thead><tbody>{attempts.slice(0, 5).map((a, index) => <tr key={a.runId}><td><button disabled={!controls.ready || running} onClick={() => replace(a.projectSnapshot!)}>恢复方案 {attempts.length - index}</button></td>{exercise.resultMetrics.map((m) => <td key={m.key}>{a.evaluation.metrics[m.key] === undefined ? '—' : (a.evaluation.metrics[m.key]! * (m.format === 'percent' ? 100 : 1)).toFixed(1)}</td>)}<td>{a.evaluation.status === 'pass' ? '通过' : a.evaluation.status === 'fail' ? '未通过' : '证据不足'}</td></tr>)}</tbody></table></div></section>
    <details><summary>参考方案与提示</summary>{exercise.presets.map((p) => <div key={p.id}><p>{p.description}</p><button disabled={!controls.ready || running} onClick={() => replace(p.create(project.id))}>{p.title}</button></div>)}{exercise.hints.map((h) => <p key={h}>{h}</p>)}</details>
    <section><h2>设计取舍</h2><ul>{exercise.decisions.map((d) => <li key={d}>{d}</li>)}</ul></section>
    <DesignNotebook exerciseId={exercise.id} />
    <section><h2>本关边界与后续问题</h2><p>{exercise.boundary}</p><ul>{exercise.exclusions.map((s) => <li key={s}>{s}</li>)}</ul></section>
    <section><h2>补充基础 Lab</h2><div className={styles.actions}>{exercise.relatedLabs.map((lab) => <Link key={lab.id} href={`/practice/${lab.id}`}>{lab.title} →</Link>)}</div></section>
  </aside>
}

function DesignWorkbenchInner({ exercise }: { exercise: DesignExercise }) {
  const [session] = useState(() => createWorkbenchSession({ id: `${exercise.id}:v${exercise.version}`, initialProject: exercise.createProject(`${exercise.id}:v${exercise.version}`) }))
  const [completed, setCompleted] = useState<CompletedWorkbenchRun | null>(null)
  return <div className={styles.page}><nav><Link href="/practice">← 全部练习</Link><span>需求 → 设计 → 验证 → 取舍</span><Link href="/">自由工作台</Link></nav><div className={styles.workspace}><Workbench session={session} embedded onRunCompleted={setCompleted} defaultPanels={{ inspector: false, faults: false, results: true }} sidebar={(controls) => <Sidebar exercise={exercise} controls={controls} completed={completed} />} /></div></div>
}
export function DesignWorkbench({ exercise }: { exercise: DesignExercise }) {
  return <DesignWorkbenchInner key={exercise.id} exercise={exercise} />
}
