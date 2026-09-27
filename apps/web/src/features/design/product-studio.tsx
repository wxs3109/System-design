'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { ModelPreview } from '../../core/experiments/execution'
import { useExperiment } from '../../components/experiments/use-experiment'
import { PRODUCT_COMMAND_LIMIT, productLesson, productFeedback, compatibleProductAttempt, isCurrentProductAttempt } from './product-lesson'
import { DesignNotebook } from './notebook'
import { Diagram } from './product-diagram'
import { StorageNotice, storageLabel } from '../../components/experiments/storage-notice'
import type { DesignConfig, ProductDesign } from './product-types'
import styles from './product.module.css'

function Studio({ design }: { design: ProductDesign }) {
  const [lesson] = useState(() => productLesson(design))
  const { session, state } = useExperiment(() => lesson.session())
  const draft = state.draft
  const preview = useMemo(() => new ModelPreview((input: { config: DesignConfig; commands: readonly string[] }) => design.run(input.config, input.commands)), [design])
  const result = preview.read({ config: draft.config, commands: draft.commands })
  const view = useMemo(() => design.present(result), [design, result])
  const scenario = design.scenarios.find((s) => s.id === draft.scenario)
  const attempt = state.attempts.find((a) => a.id === state.activeAttemptId)
  const stale = !!attempt && JSON.stringify([attempt.draft.config, attempt.draft.commands, attempt.draft.scenario]) !== JSON.stringify([draft.config, draft.commands, draft.scenario])
  const [action, setAction] = useState(Object.keys(design.actions)[0]!)
  const [error, setError] = useState('')
  const [comparison, setComparison] = useState<{ scenario: string; rows: { title: string; values: number[]; passed: boolean }[] } | null>(null)
  const edit = (next: typeof draft) => { try { lesson.parseDraft(next); preview.read({ config: next.config, commands: next.commands }); session.edit(next); setError('') } catch (e) { setError(e instanceof Error ? e.message : '操作无法执行。') } }
  const act = (command: string) => edit({ ...draft, commands: [...draft.commands, command] })
  const next = scenario && JSON.stringify(draft.commands) === JSON.stringify(scenario.script.slice(0, draft.commands.length)) ? scenario.script[draft.commands.length] : undefined
  const verified = new Set(state.attempts.filter((a) => a.evaluation.task && compatibleProductAttempt(design, a)).map((a) => a.draft.scenario))
  return <main className={styles.page}>
    <nav><Link href="/practice">← 全部练习</Link><span>产品需求 · 设计决策 · 故障证据</span><Link href="/">自由工作台</Link></nav>
    <header><span className={styles.eyebrow}>综合系统设计 · 有限业务模型</span><h1>{design.title}</h1><p>{design.summary}</p><strong data-testid="product-progress">{verified.size} / {design.scenarios.length} 个场景已验证</strong></header>
    <div className={styles.layout}>
      <aside className={styles.brief} aria-label="产品设计说明">
        <section><h2>痛点：为什么需要这个设计？</h2><ul>{design.pains.map((p) => <li key={p}>{p}</li>)}</ul></section>
        <section><h2>需求与验收目标</h2><ul>{design.requirements.map((p) => <li key={p}>{p}</li>)}</ul></section>
        <details><summary>接口与数据模型</summary>{design.contracts.map((c) => <div key={c.name}><h3>{c.name}</h3><p>{c.description}</p></div>)}</details>
        <section><h2>设计取舍</h2><ul>{design.decisions.map((p) => <li key={p}>{p}</li>)}</ul></section>
        <DesignNotebook exerciseId={design.id} />
        <section><h2>关联基础 Lab</h2>{design.relatedLabs.map((l) => <p key={l.id}><Link href={`/practice/${l.id}`}>{l.title} →</Link></p>)}</section>
        <section><h2>模型边界</h2>{design.boundary.map((b) => <p key={b}>{b}</p>)}</section>
      </aside>
      <div className={styles.experiment}>
        <section className={styles.panel} aria-label="设计策略"><h2>1. 选择设计策略</h2><div className={styles.config}>{design.fields.map((f) => <label key={f.id}>{f.label}<select aria-label={f.label} value={draft.config[f.id]} disabled={!state.ready} onChange={(e) => edit({ ...draft, config: { ...draft.config, [f.id]: e.target.value }, commands: [] })}>{f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>)}</div><p>改变策略从空状态重放，旧证据保留在历史里。</p><ol className={styles.architecture} aria-label="当前方案请求路径">{design.architecture(draft.config).map((path) => <li key={path}>{path}</li>)}</ol></section>
        <section className={styles.panel}><h2>2. 执行业务与故障场景</h2><div className={styles.actions} role="group" aria-label="设计场景">{design.scenarios.map((s) => <button key={s.id} disabled={!state.ready} aria-pressed={s.id === draft.scenario} onClick={() => edit({ ...draft, scenario: s.id, commands: [] })}>{s.title}</button>)}<button disabled={!state.ready} aria-pressed={draft.scenario === 'manual'} onClick={() => edit({ ...draft, scenario: 'manual', commands: [] })}>自由探索</button></div><h3>{scenario?.title ?? '自由探索'}</h3><p>{scenario?.goal ?? '手动交错操作并观察结果；自由探索只记录证据，不计场景通过。'}</p>
          <div className={styles.actions}>{scenario ? <><button className={styles.primary} disabled={!state.ready || !next} onClick={() => { if (next) act(next) }}>{next ? `下一步：${design.actions[next]}` : '场景步骤已完成或进入自由操作'}</button><button disabled={!state.ready} onClick={() => edit({ ...draft, commands: [...scenario.script] })}>执行本关场景</button></> : null}<button disabled={!state.ready || !state.undoCount} onClick={() => session.undo()}>撤销</button><button disabled={!state.ready || !state.redoCount} onClick={() => session.redo()}>重做</button><button disabled={!state.ready} onClick={() => edit({ ...draft, commands: [] })}>清空操作</button></div>
          <div className={styles.manual}><label>手动操作<select aria-label="手动操作" disabled={!state.ready} value={action} onChange={(e) => setAction(e.target.value)}>{Object.entries(design.actions).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label><button disabled={!state.ready || draft.commands.length >= PRODUCT_COMMAND_LIMIT} onClick={() => act(action)}>执行一步</button></div><p>{draft.commands.length} / {PRODUCT_COMMAND_LIMIT} 步 · <span data-testid="product-save-status">{storageLabel(state)}</span></p><StorageNotice state={state} session={session} saveLabel="重试保存设计" />{state.rejected ? <p role="alert">{state.rejected} 条历史无法重算验证，已排除评分；原记录保留。</p> : null}{error ? <p role="alert">{error}</p> : null}
        </section>
        <section className={styles.panel} aria-label="实际运行状态"><h2>3. 查看实际状态与证据</h2><dl className={styles.metrics}>{design.metricLabels.map((m) => <div key={m.key}><dt>{m.label}</dt><dd>{result.metrics[m.key] ?? '—'}</dd></div>)}</dl><div className={styles.tables}>{view.tables.map((table) => <div className={styles.table} key={table.title}><h3>{table.title}</h3><table aria-label={table.title}><thead><tr>{table.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead><tbody>{table.rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}</tbody></table>{!table.rows.length ? <p>尚无记录</p> : null}</div>)}</div>
          {view.diagrams?.map((diagram) => <Diagram key={diagram.title} diagram={diagram} />)}
          <details open><summary>业务事件时间线（逻辑步骤）</summary><ol className={styles.events} data-testid="product-events">{view.events.map((e, i) => <li key={i}><strong>{e.step}. {design.actions[e.action] ?? e.action}</strong><span>{e.detail}</span></li>)}</ol></details>
          <button className={styles.primary} disabled={!state.ready || !draft.commands.length} onClick={() => { try { session.run(); setError('') } catch (e) { setError(e instanceof Error ? e.message : '证据验证失败。') } }}>核验并保存设计</button>
          <div className={styles.feedback} data-testid="product-feedback" aria-live="polite"><h3>{stale ? '设计或操作已改变，请重新核验' : !attempt ? '尚未核验' : !compatibleProductAttempt(design, attempt) ? '历史版本结果，当前版本需要重新核验' : attempt.evaluation.task ? '本关设计验证通过' : '本关目标尚未满足'}</h3>{attempt && !stale ? <ul>{productFeedback(design, attempt).map((m) => <li key={m}>{m}</li>)}</ul> : <p>检查器重放全部操作、核对状态与事件，再按本关业务不变量判断。笔记不自动评分。</p>}</div>
        </section>
        <section className={styles.panel}><h2>4. 在同一场景下比较方案</h2><p>独立重放相同操作序列，不修改你的方案，也不自动记录通过。</p><button disabled={!state.ready || !scenario} onClick={() => { if (scenario) setComparison({ scenario: scenario.id, rows: design.alternatives.map((a) => { const r = design.run(a.config, scenario.script); return { title: a.title, values: design.metricLabels.map((m) => r.metrics[m.key] ?? 0), passed: scenario.check(r).every((c) => c.pass) } }) }) }}>运行方案对照</button>{comparison ? <div className={styles.table}><p>{comparison.scenario === draft.scenario ? '当前场景对照' : '这是之前场景的对照，请重新比较。'}</p><table aria-label="设计方案对照"><thead><tr><th>方案</th>{design.metricLabels.map((m) => <th key={m.key}>{m.label}</th>)}<th>本关目标</th></tr></thead><tbody>{comparison.rows.map((row) => <tr key={row.title}><th>{row.title}</th>{row.values.map((v, i) => <td key={i}>{v}</td>)}<td>{row.passed ? '满足' : '未满足'}</td></tr>)}</tbody></table></div> : null}<details><summary>载入参考策略</summary>{design.alternatives.map((a) => <button key={a.title} disabled={!state.ready} onClick={() => edit({ ...draft, config: { ...a.config }, commands: [] })}>{a.title}</button>)}</details></section>
        <section className={styles.panel} data-testid="product-history"><h2>历史设计 · {state.attempts.length}</h2>{state.attempts.slice(0, 10).map((a) => <details key={a.id}><summary>{design.scenarios.find((s) => s.id === a.draft.scenario)?.title ?? '自由探索'} · {a.evaluation.task ? '已验证' : '已记录'}</summary><p>{isCurrentProductAttempt(a) ? `模型 ${a.versions.model} · 题目 ${a.versions.definition} · 检查 ${a.versions.assessment}` : '旧格式记录 · 使用原版本校验器验证'}</p><p>{design.fields.map((f) => `${f.label}：${f.options.find((o) => o.value === a.draft.config[f.id])?.label}`).join('；')}</p><p>{design.metricLabels.map((m) => `${m.label} ${a.result.metrics[m.key]}`).join(' · ')}</p><button disabled={!state.ready} onClick={() => { try { session.restoreAttempt(a); setError('') } catch (e) { setError(e instanceof Error ? e.message : '历史草稿需要迁移后才能编辑。') } }}>恢复这次设计</button></details>)}</section>
      </div>
    </div>
  </main>
}

export function ProductStudio({ design }: { design: ProductDesign }) {
  return <Studio key={design.id} design={design} />
}
