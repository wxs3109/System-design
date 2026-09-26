'use client'

import Link from 'next/link'
import { StorageNotice, storageLabel } from '../algorithm/storage-notice'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { ArrowLeft, ArrowRight, FlaskConical, Play, Undo2, Redo2, RotateCcw } from 'lucide-react'
import { HotSession } from './session'
import { caseLabels, hotChallenge, hotIdentity, hotKeyExercise, hotProgress, hotResponses, stageLabels, type HotDraft, type Stage } from './lesson'
import { HotControls } from './hot-controls'
import { HotEvidence } from './hot-evidence'
import styles from '../distribution/hashing-lab.module.css'
import hot from './hot-key.module.css'
import { LabConceptLinks } from '../../learning/lab-concept-links'

export function HotKeyLab() {
  const [session] = useState(() => new HotSession())
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot)
  const [error, setError] = useState('')
  useEffect(() => { void session.load() }, [session])
  const { draft } = state
  const attempt = state.attempts.find((item) => item.id === state.activeAttemptId)
  const stale = !!attempt && hotIdentity(attempt.draft) !== hotIdentity(draft)
  const pending = !!attempt && hotResponses(attempt.draft) !== hotResponses(draft)
  const progress = useMemo(() => hotProgress(state.attempts), [state.attempts])
  const edit = (next: HotDraft) => { try { session.edit(next); setError('') } catch (cause) { setError(cause instanceof Error ? cause.message : '输入无效。') } }
  const answer = (field: 'keyAnswer' | 'requestAnswer' | 'ownerAnswer' | 'backendAnswer' | 'meaning' | 'caseId' | 'caseMeaning' | 'reflection', value: string) => edit({ ...draft, [field]: value })
  const run = () => { try { session.run(); setError('') } catch (cause) { setError(cause instanceof Error ? cause.message : '本次运行无法验证。') } }
  const canRun = state.ready && (draft.stage === 'explore' || !!draft.prediction)
  return <main className={styles.lab}>
    <nav className={styles.nav} aria-label="练习导航"><Link href="/practice"><ArrowLeft size={16} />全部练习</Link><span><FlaskConical size={17} />System Design Lab</span><Link href="/practice/consistent-hashing">一致性哈希 <ArrowRight size={15} /></Link></nav>
    <header className={styles.hero}><div><span className={styles.eyebrow}>READ DISTRIBUTION / HOT KEY</span><h1>{hotKeyExercise.title}</h1><p>固定同一批请求，观察一个热门 key，再验证缓存改变了哪些访问。</p></div><div className={styles.progress} aria-label="热点学习进度"><strong>{progress.length === 3 ? '热点与缓存挑战已完成' : `${progress.length} / 3 步骤已验证`}</strong><span>预测 → 操作 → 证据 → 复盘</span></div></header>
    <div className={styles.modeBar} role="group" aria-label="热点实验步骤">{(Object.keys(stageLabels) as Stage[]).map((stage) => <button key={stage} disabled={!state.ready} aria-pressed={draft.stage === stage} onClick={() => edit(hotChallenge(stage))}>{progress.some((item) => item === stage) ? '✓ ' : ''}{stageLabels[stage]}</button>)}<span role="status" data-testid="hot-save-status">{storageLabel(state, '已保存到此浏览器')}</span></div>
    <StorageNotice state={state} session={session} className={styles.error} saveLabel="重试保存热点实验" />
    {state.rejected ? <p role="alert" className={styles.error}>{state.rejected} 条历史证据无法验证，原记录保留并排除评分。</p> : null}
    <LabConceptLinks labId="hot-key" />
    <div className={styles.workspace}>
      <aside className={styles.controls}><HotControls key={JSON.stringify([draft.stage, draft.input.distribution.datasetSeed, draft.input.distribution.keys.length, draft.input.workload.seed, draft.input.workload.count])} draft={draft} ready={state.ready} edit={edit} />
        <section className={styles.panel}><button className={styles.primary} disabled={!canRun} onClick={run}><Play size={15} />运行热点实验</button><div className={styles.actions}><button disabled={!state.ready || !state.undoCount} onClick={() => session.undo()}><Undo2 size={14} />撤销</button><button disabled={!state.ready || !state.redoCount} onClick={() => session.redo()}><Redo2 size={14} />重做</button><button disabled={!state.ready} onClick={() => edit(hotChallenge(draft.stage))}><RotateCcw size={14} />重置实验</button></div><p className={styles.note}>重置保留历史；每次运行都从空缓存开始。</p>{error ? <p role="alert" className={styles.error}>{error}</p> : null}</section>
      </aside>
      <div className={styles.results}>
        <section className={`${styles.feedback} ${attempt?.evaluation.explanation && !stale && !pending ? styles.success : ''}`} aria-live="polite" data-testid="hot-feedback"><strong>{stale ? '有未运行的修改' : !attempt ? '等待第一次热点实验' : pending ? '作答有未提交的修改' : attempt.evaluation.explanation ? '本步骤通过' : attempt.evaluation.task ? '操作完成，继续用证据解释' : '运行证据已记录'}</strong><p>{stale ? '配置或基线已改变。下方保留上次运行的证据，请重新运行验证当前输入。' : !attempt ? '先预测，改变一个条件，再运行。结果会展示完整请求序列的实际访问。' : '所有统计来自本次逐条读取，不把目标概率当成观测结果。'}</p>
          {attempt && !stale ? <><div className={styles.badges}><span>证据：{attempt.evaluation.evidence ? '有效' : '不可验证'}</span><span>任务：{attempt.evaluation.task ? '完成' : draft.stage === 'explore' ? '自由探索' : '待完成'}</span><span>解释：{pending ? '待提交' : attempt.evaluation.explanation ? '通过' : '待完成'}</span></div><ul>{attempt.evaluation.messages.map((message) => <li key={message}>{message}</li>)}</ul></> : null}
        </section>
        {attempt ? <><p className={hot.compactNote}>{stale ? '上次运行证据' : '已运行证据'} · {stageLabels[attempt.draft.stage]} · seed {attempt.draft.input.workload.seed} · {attempt.draft.input.workload.count} 次读取</p><HotEvidence key={attempt.id} input={attempt.draft.input} result={attempt.result} before={attempt.baselineResult} comparison={attempt.comparison} onUseKey={(key) => answer('keyAnswer', key)} /></> : <section className={styles.panel}><h2>这道 Lab 要回答三个问题</h2><ol className={hot.stageList}><li>key 数比较均匀时，请求还可能集中吗？</li><li>更多虚拟节点能否拆散同一个 hot key？</li><li>缓存减少了哪些后端读取，又没有验证什么？</li></ol><p>运行后可以从节点统计追查到具体 key，再查看每一次 hit、miss、过期清理和填充。</p></section>}
        <section className={styles.panel}><span className={styles.eyebrow}>03 / 引用本次证据</span><h2>解释你的观察</h2><fieldset className={hot.fieldSet} disabled={!state.ready}><div className={styles.answerGrid}>
          <label>最热门的 key<input aria-label="最热门的 key" value={draft.keyAnswer} maxLength={200} onChange={(event) => answer('keyAnswer', event.target.value)} placeholder="从热度表选择，或输入完整 key" /></label>
          <label>它的实际读取次数<input aria-label="热门 key 读取次数" inputMode="numeric" maxLength={10} value={draft.requestAnswer} onChange={(event) => answer('requestAnswer', event.target.value)} /></label>
          <label>它的物理 owner<select aria-label="热门 key 的 owner" value={draft.ownerAnswer} onChange={(event) => answer('ownerAnswer', event.target.value)}><option value="">选择节点</option>{draft.input.distribution.nodes.map((node) => <option key={node}>{node}</option>)}</select></label>
          <label>本次总后端读取次数<input aria-label="本次后端读取次数" inputMode="numeric" maxLength={10} value={draft.backendAnswer} onChange={(event) => answer('backendAnswer', event.target.value)} /></label>
          <label>本次结果能说明什么？<select aria-label="热点结果解释" value={draft.meaning} onChange={(event) => answer('meaning', event.target.value)}><option value="">选择解释</option><option value="single-owner">同一 key 的读取仍对应一个物理 owner</option><option value="cache-boundary">后端读取减少，但没有验证缓存自身的容量</option><option value="no-bottleneck">说明整个系统已经没有瓶颈</option><option value="auto-spread">虚拟节点会自动把一个 key 的读取分给多台机器</option></select></label>
          <label>应用背景<select aria-label="热点应用背景" value={draft.caseId} onChange={(event) => answer('caseId', event.target.value)}><option value="">选择一个案例</option>{Object.entries(caseLabels).map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select></label>
          <label>本实验与该案例的联系<select aria-label="热点案例关联" value={draft.caseMeaning} onChange={(event) => answer('caseMeaning', event.target.value)}><option value="">选择联系</option><option value="read-hotspot">同一资源被反复读取，访问可能集中</option><option value="celebrity">已经验证 Celebrity 的写入扩散</option><option value="delivery">已经保证消息的顺序与交付</option></select></label>
        </div><label>你的复盘<textarea aria-label="热点复盘" rows={3} maxLength={4000} value={draft.reflection} onChange={(event) => answer('reflection', event.target.value)} placeholder="原文保存，不自动判分。你会如何把这次观察用于设计？" /></label></fieldset>
          <button className={styles.primary} disabled={!canRun || !attempt || stale} onClick={run}>检查热点解释并记录</button>
          <details className={styles.exploreSettings}><summary>提示：先看分母，再解释原因</summary><p>节点的 key 份额以全部 key 为分母；请求份额以全部读取为分母。缓存命中返回不访问 owner；首次读取的冷 miss 也必须计入。</p><p>更多虚拟节点没有复制 key。共享缓存不改变分片归属；它自己的处理能力仍需要另一个资源模型。</p></details>
        </section>
      </div>
    </div>
    <section className={styles.panel} data-testid="hot-history"><h2>热点实验记录 <span className={styles.tag}>{state.attempts.length}</span></h2><p className={styles.note}>保存实际请求序列、输入、基线、操作、结果、预测与复盘。最近 10 次列在下方；恢复后可以查看完整证据。</p>{state.attempts.length ? state.attempts.slice(0, 10).map((item) => <details key={item.id} className={styles.historyItem}><summary>{stageLabels[item.draft.stage]} · {item.draft.input.workload.pattern === 'uniform' ? '均匀访问' : `${item.draft.input.workload.probability * 100}% 目标热点`} · 后端 {item.result.totals.backendReads} 次 · {item.evaluation.explanation ? '解释通过' : '已记录'}<small>{new Date(item.createdAt).toLocaleString('zh-CN')}</small></summary><p>预测：{item.draft.prediction || '未填写'} · 操作：{item.draft.operations.join(' → ')}</p><p>复盘：{item.draft.reflection || '未填写'}</p><button disabled={!state.ready} onClick={() => session.restoreAttempt(item)}>恢复热点尝试</button></details>) : <p>运行后会在此记录你的实验。</p>}</section>
    <section className={styles.caseSection}><h2>带回经典系统设计案例</h2><div className={styles.caseGrid}>{Object.entries(caseLabels).map(([id, title]) => <article key={id} className={`${styles.panel} ${hot.caseCard}`}><span className={styles.eyebrow}>应用背景 · 综合案例待实现</span><h3>{title}</h3><p>{({ shortlink: '某条短链接突然走红，短码均匀分片仍可能出现集中读取。', feed: '某条内容被反复访问；读取热点与 Celebrity 的写扩散是两个问题。', video: '某段视频被大量读取；这里仅统计读取次数，不建模对象大小或带宽。', chat: '热门群的会话记录被反复读取；消息交付、presence 和顺序不在本实验范围。' })[id as keyof typeof caseLabels]}</p></article>)}</div></section>
    <footer className={styles.boundary}><strong>学习模型的边界</strong><p>固定只读值、成功源读取、单 key 单 owner、顺序处理、零获取延迟。缓存位于分片路由前，每次实验从空 LRU 开始；命中不续期，先清理过期再 lookup。结束快照取最后一次请求时刻。</p><p>hot-key-v1 / reads-v1 / murmur-counter-v1。采样计数使用完整序列；没有 CPU、每 shard 排队、吞吐上限或 p95 模型，也没有写入一致性、并发 miss 合并或真实中间件连接。记录与一致性哈希和自由工作台分别保存。</p></footer>
  </main>
}
