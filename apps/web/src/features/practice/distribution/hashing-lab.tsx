'use client'

import Link from 'next/link'
import { StorageNotice, storageLabel } from '../algorithm/storage-notice'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { ArrowLeft, ArrowRight, Check, FlaskConical, Play, RotateCcw, Undo2, Redo2 } from 'lucide-react'
import { AlgorithmSession } from './session'
import { challenge, experimentIdentity, hashingExercise, learningProgress, responseIdentity, type Draft, type Mode } from './lesson'
import { distribute, makeInput, methodLabels, methods, type DistributionInput, type Method } from './model'
import { DistributionView } from './distribution-view'
import styles from './hashing-lab.module.css'
import { LabConceptLinks } from '../../learning/lab-concept-links'

const modeLabels: Record<Mode, string> = { add: '扩容比较', remove: '迁移挑战', explore: '自由探索' }
const cases = [
  ['缓存集群', '扩容时哪些 key 换 owner？这些访问可能遇到冷缓存。', '本题不计算预热或数据搬迁耗时。'],
  ['短链接 · CASE-01', '短码分布与热门链接的读取压力，是两个不同的问题。', 'Service、缓存与 DB 的完整读取路径是后续综合题。'],
  ['News Feed · CASE-02', '用户与内容如何分片？热门内容可能集中读取。', 'Celebrity 的写扩散需要另一个模型。'],
  ['Chat · CASE-06', '如何分配会话？热门群的访问是否集中？', '本题不验证消息顺序、交付、presence 或连接迁移。'],
  ['Video · CASE-08', '视频与分片的 key 如何分布？热门资源落在哪里？', '对象大小、CDN、带宽与播放会话留在后续实验。'],
]

export function HashingLab() {
  const [session] = useState(() => new AlgorithmSession())
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot)
  useEffect(() => { void session.load() }, [session])
  const { draft } = state
  const [seed, setSeed] = useState('my-experiment')
  const [count, setCount] = useState(1024)
  const [inputError, setInputError] = useState('')
  const preview = useMemo(() => distribute(draft.input), [draft.input])
  const baseline = useMemo(() => draft.baseline ? distribute(draft.baseline) : null, [draft.baseline])
  const attempt = state.attempts.find((item) => item.id === state.activeAttemptId)
  const stale = !!attempt && experimentIdentity(attempt.draft) !== experimentIdentity(draft)
  const responsePending = !!attempt && responseIdentity(attempt.draft) !== responseIdentity(draft)
  const current = attempt && !stale ? attempt : null
  const progress = useMemo(() => learningProgress(state.attempts), [state.attempts])
  const complete = progress.methods.length === 3 && progress.transfer
  const edit = (next: Draft) => { try { session.edit(next); setInputError('') } catch (error) { setInputError(error instanceof Error ? error.message : '输入无效。') } }
  const updateInput = (input: DistributionInput, operation: string) => edit({ ...draft, input, operations: [...draft.operations, operation] })
  const answer = (field: 'prediction' | 'movedKey' | 'movedCount' | 'locality' | 'balance' | 'reflection', value: string) => edit({ ...draft, [field]: value })
  const start = (mode: Mode, method: Method = draft.input.method, virtualNodes = draft.input.virtualNodes === 1 ? 32 : draft.input.virtualNodes) => edit(challenge(mode, method, virtualNodes))
  const changeMethod = (method: Method) => draft.mode === 'explore' ? updateInput({ ...draft.input, method, virtualNodes: method === 'vnodes' ? 32 : 1 }, `方法：${method}`) : start(draft.mode, method)
  const addNode = () => {
    let index = 1
    while ([...draft.input.nodes, ...(draft.baseline?.nodes ?? []), ...draft.operations].some((item) => item.includes(`node-${String(index).padStart(2, '0')}`))) index++
    const nodeId = draft.mode === 'add' ? 'node-e' : `node-${String(index).padStart(2, '0')}`
    updateInput({ ...draft.input, nodes: [...draft.input.nodes, nodeId] }, `新增 ${nodeId}`)
  }
  const removeNode = (nodeId: string) => updateInput({ ...draft.input, nodes: draft.input.nodes.filter((id) => id !== nodeId) }, `移除 ${nodeId}`)
  const canRun = state.ready && (draft.mode === 'explore' || !!draft.prediction)
  return <main className={styles.lab}>
    <nav className={styles.nav} aria-label="练习导航"><Link href="/practice"><ArrowLeft size={16} />全部练习</Link><span><FlaskConical size={17} />System Design Lab</span><Link href="/">自由工作台 <ArrowRight size={15} /></Link></nav>
    <header className={styles.hero}><div><span className={styles.eyebrow}>数据分布 / CONSISTENT HASHING</span><h1>{hashingExercise.title}</h1><p>同一批 key，三种分配方法。改变成员，追踪变化，用证据解释你的设计。</p></div><div className={styles.progress} aria-label="学习进度"><strong>{complete ? '本题挑战已完成' : `${progress.methods.length} / 3 方法已验证`}</strong><span>{progress.transfer ? '✓ 移除节点迁移题已完成' : '下一步：在新数据集移除节点'}</span></div></header>
    <div className={styles.modeBar} role="group" aria-label="实验模式">{(['add', 'remove', 'explore'] as const).map((mode) => <button key={mode} aria-pressed={draft.mode === mode} disabled={!state.ready} onClick={() => start(mode)}>{modeLabels[mode]}</button>)}<span role="status" data-testid="algorithm-save-status">{storageLabel(state, '已保存到此浏览器')}</span></div>
    <StorageNotice state={state} session={session} className={styles.error} saveLabel="重试保存当前实验" />
    {state.rejected ? <p role="alert" className={styles.error}>{state.rejected} 条历史证据无法验证，已保留原记录并排除评分。</p> : null}
    <LabConceptLinks labId="consistent-hashing" />
    <div className={styles.workspace}>
      <aside className={styles.controls}>
        <section className={styles.panel}><span className={styles.eyebrow}>01 / 固定条件与预测</span><h2>{modeLabels[draft.mode]}</h2><p>{draft.mode === 'add' ? '保持同一批 key，从 4 个节点开始新增 node-e。分别完成三种方法，再比较各自的变化。' : draft.mode === 'remove' ? '换一组 256 个 key，从 5 个节点移除 node-c。使用本次证据回答，不沿用上一题数字。' : '自由选择成员、方法和数据集，固定基线后做受控比较。探索记录不计入指导题通过。'}</p>
          <div className={styles.facts}><span>Seed <b>{draft.input.datasetSeed}</b></span><span>Key 集合 <b>{draft.input.keys.length} 个 · 固定</b></span></div>
          <label>你的预测<select value={draft.prediction} disabled={!state.ready} onChange={(event) => answer('prediction', event.target.value)}><option value="">先选一个预测（允许出错）</option><option value="local">只有与变更节点有关的 key 换 owner</option><option value="spread">其他节点之间的 key 也会换 owner</option><option value="uncertain">还不确定，先观察</option></select></label>
          <p className={styles.note}>预测不计对错；观察后可以纠正。每个 key 只有一个物理 owner。</p>
        </section>
        <section className={styles.panel}><span className={styles.eyebrow}>02 / 改变成员并运行</span><h2>你的实验</h2><div className={styles.methods} role="group" aria-label="分配方法">{methods.map((method) => <button key={method} disabled={!state.ready} aria-pressed={draft.input.method === method} onClick={() => changeMethod(method)}>{progress.methods.includes(method) ? <Check size={13} /> : null}{methodLabels[method]}</button>)}</div>
          {draft.input.method === 'vnodes' ? <label>每节点 token 数<select value={draft.input.virtualNodes} onChange={(event) => draft.mode === 'explore' ? updateInput({ ...draft.input, virtualNodes: Number(event.target.value) }, `token 数：${event.target.value}`) : start(draft.mode, 'vnodes', Number(event.target.value))}>{[8, 32, 128].map((value) => <option key={value} value={value}>{value}</option>)}</select></label> : null}
          <ul className={styles.members} aria-label="物理节点">{draft.input.nodes.map((nodeId) => <li key={nodeId}><span>{nodeId}</span><button aria-label={`移除 ${nodeId}`} disabled={!state.ready || draft.input.nodes.length === 1 || draft.mode === 'add' || (draft.mode === 'remove' && nodeId !== 'node-c')} onClick={() => removeNode(nodeId)}>移除</button></li>)}</ul>
          <button className={styles.secondary} disabled={!state.ready || draft.input.nodes.length >= 12 || draft.mode === 'remove' || (draft.mode === 'add' && draft.input.nodes.includes('node-e'))} onClick={addNode}>+ {draft.mode === 'add' ? '新增 node-e' : '添加节点'}</button>
          {draft.mode === 'explore' ? <><button className={styles.secondary} onClick={() => edit({ ...draft, baseline: structuredClone(draft.input), operations: [...draft.operations, '固定基线'] })}>固定当前配置为基线</button><details className={styles.exploreSettings}><summary>开始新的数据集</summary><label>新 Seed<input value={seed} maxLength={80} onChange={(event) => setSeed(event.target.value)} /></label><label>Key 数量<select value={count} onChange={(event) => setCount(Number(event.target.value))}>{[256, 1024, 4096].map((value) => <option key={value}>{value}</option>)}</select></label><button onClick={() => { try { updateInput({ ...draft.input, ...makeInput(seed, count), nodes: draft.input.nodes, method: draft.input.method, virtualNodes: draft.input.virtualNodes }, `新数据集：${seed}`) } catch (error) { setInputError(error instanceof Error ? error.message : '输入无效。') } }}>生成新数据集</button><p className={styles.note}>旧基线保留为参考；不同数据集不能计算重映射对照。</p></details></> : <p className={styles.note}>指导题的基线与当前方法一致。换方法或 token 数会重新开始这一组实验。</p>}
          {inputError ? <p role="alert" className={styles.error}>{inputError}</p> : null}
          <button className={styles.primary} disabled={!canRun} onClick={() => session.run()}><Play size={15} />运行并记录</button><div className={styles.actions}><button disabled={!state.ready || !state.undoCount} onClick={() => session.undo()}><Undo2 size={14} />撤销</button><button disabled={!state.ready || !state.redoCount} onClick={() => session.redo()}><Redo2 size={14} />重做</button><button disabled={!state.ready} onClick={() => start(draft.mode)}><RotateCcw size={14} />重置实验</button></div><p className={styles.note}>重置保留所有尝试记录。预览不会自动算作已完成实验。</p>
        </section>
      </aside>
      <div className={styles.results}>
        <section className={`${styles.feedback} ${current?.evaluation.explanation && !responsePending ? styles.success : ''}`} aria-live="polite" data-testid="algorithm-feedback"><strong>{stale ? '有未运行的修改' : !current ? '等待第一次运行' : responsePending ? '复盘有未提交的修改' : current.evaluation.explanation ? '本次挑战通过' : current.evaluation.task ? '操作完成，继续用证据解释' : '运行证据已记录'}</strong><p>{stale ? '当前配置或基线已改变。下方显示新配置预览，上次结果保留在历史中。' : !current ? '先预测并操作，再运行。下方是当前配置预览。' : '结果来自完整 key 集的实际分配计算。'}</p>{current ? <><div className={styles.badges}><span>证据：{current.evaluation.evidence ? '有效' : '不可验证'}</span><span>操作：{current.evaluation.task ? '完成' : draft.mode === 'explore' ? '自由探索' : '待完成'}</span><span>解释：{responsePending ? '待提交' : current.evaluation.explanation ? '通过' : '待完成'}</span></div><ul>{current.evaluation.messages.map((message) => <li key={message}>{message}</li>)}</ul></> : null}</section>
        <DistributionView result={current?.result ?? preview} baseline={current?.baselineResult ?? baseline} label={current ? '已运行证据' : '当前配置预览 · 尚未提交'} onUseKey={(key) => answer('movedKey', key)} />
        <section className={styles.panel}><span className={styles.eyebrow}>03 / 用证据解释</span><h2>范围与均衡，是同一个目标吗？</h2><div className={styles.answerGrid}>
          <label>发生变化的 key<input placeholder="从归属表选择，或输入完整 key" value={draft.movedKey} maxLength={200} onChange={(event) => answer('movedKey', event.target.value)} /></label>
          <label>需要重映射的 key 数<input inputMode="numeric" value={draft.movedCount} maxLength={10} onChange={(event) => answer('movedCount', event.target.value)} placeholder="本次完整计数" /></label>
          <label>本次变化涉及哪些节点？<select value={draft.locality} onChange={(event) => answer('locality', event.target.value)}><option value="">根据转移表选择</option><option value="local">{draft.mode === 'remove' ? '变化项全部来自被移除节点' : '变化项全部转向新增节点'}</option><option value="spread">其他节点之间也发生了转移</option></select></label>
          <label>较少重映射能说明什么？<select value={draft.balance} onChange={(event) => answer('balance', event.target.value)}><option value="">选择你的解释</option><option value="same">说明各节点的 key 数也一定更均衡</option><option value="separate">均衡要单独看节点份额，不能由重映射比例推断</option></select></label>
        </div><label>你的复盘（保留原文，不自动判分）<textarea rows={3} value={draft.reflection} maxLength={4000} onChange={(event) => answer('reflection', event.target.value)} placeholder="我的预测哪里需要修正？这会怎样影响缓存集群扩容？" /></label><button className={styles.primary} disabled={!canRun || !current} onClick={() => session.run()}>检查解释并记录</button><details className={styles.exploreSettings}><summary>需要一点提示？</summary><p>环新增节点只会接管它前面的部分区间；移除节点只重新分配原来属于它的 key。取模会改变除数，其他节点之间也可能变化。</p><p>虚拟节点增加区间数量，但不保证每一个有限样本都更均衡。这里的“需要重映射”也不等于已经完成数据复制。</p></details></section>
      </div>
    </div>
    <section className={styles.panel} aria-label="三种方法的扩容比较"><span className={styles.eyebrow}>04 / 比较与迁移</span><h2>比较各自的扩容前后</h2><p>每行都使用自己的同方法基线：同一批 1,024 个 key，从 node-a…d 新增 node-e。不会把不同方法的终点直接相减。</p><div className={styles.tableScroll}><table><thead><tr><th>分配方法</th><th>重映射数 / 1,024</th><th>最大份额：前 → 后</th><th>解释</th></tr></thead><tbody>{methods.map((method) => { const latest = state.attempts.find((item) => item.draft.mode === 'add' && item.draft.input.method === method && item.evaluation.task); return <tr key={method}><th>{methodLabels[method]}{latest && method === 'vnodes' ? ` · V=${latest.draft.input.virtualNodes}` : ''}</th><td>{latest?.comparison?.remapped ?? '尚未运行'}</td><td>{latest?.baselineResult ? `${(latest.baselineResult.maxShare * 100).toFixed(1)}% → ${(latest.result.maxShare * 100).toFixed(1)}%` : '—'}</td><td>{latest?.evaluation.explanation ? '通过' : '待完成'}</td></tr> })}</tbody></table></div><button className={styles.secondary} disabled={!state.ready} onClick={() => start('remove', 'vnodes')}>进入新数据集的移除节点挑战 <ArrowRight size={14} /></button></section>
    <section className={styles.panel} data-testid="algorithm-history"><h2>尝试记录 <span className={styles.tag}>{state.attempts.length}</span></h2><p className={styles.note}>按时间保存输入、基线、操作、预测、结果和复盘。点击恢复可查看完整逐 key 证据；修改后需重新运行。下方列出最近 10 次。</p>{state.attempts.length ? state.attempts.slice(0, 10).map((item) => <details key={item.id} className={styles.historyItem}><summary>{modeLabels[item.draft.mode]} · {methodLabels[item.draft.input.method]} · {item.result.input.nodes.length} 节点 · {item.comparison ? `${item.comparison.remapped} keys 重映射` : '无对照'} · {item.evaluation.explanation ? '解释通过' : '已记录'}<small>{new Date(item.createdAt).toLocaleString('zh-CN')}</small></summary><p>Seed：{item.draft.input.datasetSeed} · {item.draft.input.keys.length} keys · 预测：{item.draft.prediction || '未填写'}</p><p>操作：{item.draft.operations.join(' → ')}</p><p>复盘：{item.draft.reflection || '未填写'}</p><button disabled={!state.ready} onClick={() => session.restoreAttempt(item)}>恢复这次实验</button></details>) : <p>完成第一次运行后，这里会保留你的证据。</p>}</section>
    <section className={styles.caseSection}><h2>把这个实验带回系统设计</h2><div className={styles.caseGrid}>{cases.map(([title, problem, boundary]) => <article className={styles.panel} key={title}><span className={styles.eyebrow}>应用背景 · 综合案例待实现</span><h3>{title}</h3><p>{problem}</p><small>{boundary}</small></article>)}</div></section>
    <footer className={styles.boundary}><strong>学习模型的边界</strong><p>一个 key 只有一个物理 owner，节点等权。重映射表示目标 owner 改变；没有执行数据复制、切流或副本放置，不报告迁移耗时、CPU、请求吞吐或生产容量。</p><p>MurmurHash3 x86_32 / UTF-8 / seed 0 · distribution-v1 · keys-v1。所有键数与重映射统计使用完整输入。参考：<a href="https://github.com/aappleby/smhasher/blob/master/src/MurmurHash3.cpp" target="_blank" rel="noreferrer">Austin Appleby 的公开参考实现</a>。本题与原三道练习、自由工作台分别保存。</p></footer>
  </main>
}
