import { useMemo, useState } from 'react'
import { DistributionView } from '../distribution/distribution-view'
import { methodLabels } from '../distribution/model'
import { topKeys, type HotInput, type HotResult, type HotComparison } from './model'
import styles from '../distribution/hashing-lab.module.css'
import hot from './hot-key.module.css'

export const percent = (value: number) => `${(value * 100).toFixed(1)}%`
const kindLabels: Record<HotComparison['kind'], string> = { cache: '缓存策略对照 · 同一请求序列', distribution: '分配策略对照 · 同一请求序列', workload: '负载变化 · 同一组底层采样值', combined: '多个条件变化 · 不作单一原因解释', unchanged: '与基线相同', incompatible: '实验条件不同 · 不作效果归因' }
const outcomeLabels = { bypass: '绕过缓存', hit: '命中', miss: '未命中' }

export function HotEvidence({ input, result, before, comparison, onUseKey }: { input: HotInput; result: HotResult; before: HotResult | null; comparison: HotComparison | null; onUseKey: (key: string) => void }) {
  const [keyQuery, setKeyQuery] = useState('')
  const [keyPage, setKeyPage] = useState(0)
  const [requestKey, setRequestKey] = useState('')
  const [outcome, setOutcome] = useState('all')
  const [requestPage, setRequestPage] = useState(0)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const sortedKeys = useMemo(() => topKeys(result), [result])
  const keyRows = sortedKeys.filter((key) => key.key.includes(keyQuery))
  const keysPage = Math.min(keyPage, Math.max(0, Math.ceil(keyRows.length / 15) - 1))
  const events = result.events.filter((event) => (!requestKey || event.key === requestKey) && (outcome === 'all' || event.outcome === outcome))
  const eventsPage = Math.min(requestPage, Math.max(0, Math.ceil(events.length / 15) - 1))
  const selected = events.find((event) => event.index === selectedIndex) ?? events[0] ?? result.events[0]!
  const sample = input.workload.requests[selected.index]!
  const totals = result.totals
  return <>
    <section className={styles.panel} aria-label="热点与缓存运行证据">
      <div className={styles.sectionHeading}><div><span className={styles.eyebrow}>完整读取序列 · {totals.reads.toLocaleString()} 次</span><h2>数据分布与访问压力</h2></div><span className={styles.tag}>{methodLabels[input.distribution.method]}</span></div>
      <div className={`${styles.metrics} ${hot.metrics}`}>
        <div><small>指定 key 的实际请求份额</small><strong data-testid="hot-observed-share">{percent(result.observedHotShare)}</strong><small>目标：{input.workload.pattern === 'uniform' ? `每 key 约 ${percent(1 / input.distribution.keys.length)}` : percent(input.workload.probability)}</small></div>
        <div><small>缓存前最大 owner 请求份额</small><strong>{percent(result.maxRequestShare)}</strong><small>分母：全部 {totals.reads} 次读取</small></div>
        <div><small>后端读取</small><strong data-testid="hot-backend-count">{totals.backendReads.toLocaleString()}</strong><small>基线 {before?.totals.backendReads.toLocaleString() ?? '—'}</small></div>
        <div><small>缓存命中率</small><strong data-testid="hot-hit-rate">{result.hitRate === null ? '不适用' : percent(result.hitRate)}</strong><small>{result.hitRate === null ? '没有执行缓存 lookup' : `${totals.hits} hits / ${totals.lookups} lookups`}</small></div>
      </div>
      <p className={styles.note}>指定 key：{input.workload.hotKey}。逻辑时间 0–{totals.reads - 1} ms，仅用于请求顺序和 TTL；不是吞吐或延迟测量。</p>
      {comparison ? <div className={hot.comparison} data-testid="hot-comparison"><strong>{kindLabels[comparison.kind]}</strong><p>{comparison.sameRequests ? `请求 ID、key、时刻和采样值保持一致。后端读取差：${comparison.backendSaved}（基线减本次）。` : comparison.sameSamples ? '改变了请求选择的 key，不能把后端访问差直接归因于缓存或分片。' : 'Seed、采样器或请求总体不同，请固定新的基线后再比较。'}</p></div> : <p className={styles.note}>尚未固定基线；这是一次独立运行。</p>}
      <div className={hot.legend}><span>① key 数 / 全部 key</span><span>② 缓存前读取需求 / 全部读取</span><span>③ 实际后端读取 / 全部读取</span></div>
      <div className={hot.nodeGrid}>{result.nodes.map((node) => <article key={node.nodeId}><h3>{node.nodeId}</h3>{[
        { name: '① key', value: node.keys, total: input.distribution.keys.length },
        { name: '② 缓存前', value: node.requests, total: totals.reads },
        { name: '③ 后端', value: node.backendReads, total: totals.reads },
      ].map((metric, index) => <div className={hot.nodeMetric} key={metric.name}><span>{metric.name}<b>{metric.value.toLocaleString()} · {percent(metric.value / metric.total)}</b></span><div className={hot.bar}><i data-kind={index} style={{ width: percent(metric.value / metric.total) }} /></div></div>)}</article>)}</div>
      <p className={styles.note}>② 按 key 的 owner 归属统计缓存前的读取需求，并不表示这些请求都访问了节点。缓存命中会提前返回；③ 才是实际到达 owner 的后端读取。缓存不改变分片归属。</p>
      {before ? <div className={styles.tableScroll}><table aria-label="基线与本次指标"><thead><tr><th>指标</th><th>基线</th><th>本次</th></tr></thead><tbody>
        <tr><th>最大节点 key 份额</th><td>{percent(before.distribution.maxShare)}</td><td>{percent(result.distribution.maxShare)}</td></tr>
        <tr><th>缓存前最大 owner 请求份额</th><td>{percent(before.maxRequestShare)}</td><td>{percent(result.maxRequestShare)}</td></tr>
        <tr><th>后端读取次数</th><td>{before.totals.backendReads}</td><td>{totals.backendReads}</td></tr>
        <tr><th>命中率</th><td>{before.hitRate === null ? '不适用' : percent(before.hitRate)}</td><td>{result.hitRate === null ? '不适用' : percent(result.hitRate)}</td></tr>
      </tbody></table></div> : null}
    </section>
    <section className={styles.panel}><h2>逐 key 热度</h2><p className={styles.note}>覆盖全部 key，按实际读取次数排序，包含零访问项。选择一项可追查它的完整请求序列。</p>
      <label>查找 key<input aria-label="热度表查找 key" value={keyQuery} onChange={(event) => { setKeyQuery(event.target.value); setKeyPage(0) }} /></label>
      <div className={styles.tableScroll}><table aria-label="逐 key 热度表"><thead><tr><th>key</th><th>Owner</th><th>请求数</th><th>后端读取</th><th>追查</th></tr></thead><tbody>{keyRows.slice(keysPage * 15, keysPage * 15 + 15).map((key) => <tr key={key.key}><td><button onClick={() => onUseKey(key.key)} aria-label={`用 ${key.key} 作答`}>{key.key}</button></td><td>{key.owner}</td><td>{key.requests}</td><td>{key.backendReads}</td><td><button onClick={() => { setRequestKey(key.key); setRequestPage(0); setOutcome('all'); setSelectedIndex(result.events.findIndex((event) => event.key === key.key)) }}>查看请求</button></td></tr>)}</tbody></table></div>
      <Pager label={`${keyRows.length} keys`} page={keysPage} count={keyRows.length} setPage={setKeyPage} />
    </section>
    <section className={styles.panel}><h2>逐请求缓存证据</h2><p>每次运行从空缓存开始。读请求顺序执行，未命中在同一逻辑时刻成功回源并填充；不模拟并发等待或获取延迟。</p>
      <div className={hot.counters} aria-label="缓存完整计数">{Object.entries({ reads: totals.reads, bypasses: totals.bypasses, lookups: totals.lookups, hits: totals.hits, misses: totals.misses, backendReads: totals.backendReads, expiries: totals.expiries, fills: totals.fills, evictions: totals.evictions }).map(([name, value]) => <div key={name}><small>{name}</small><strong>{value.toLocaleString()}</strong></div>)}</div>
      <p className={styles.note}>{totals.reads} reads = {totals.bypasses} bypasses + {totals.lookups} lookups；{totals.lookups} lookups = {totals.hits} hits + {totals.misses} misses；{totals.backendReads} backendReads = {totals.bypasses} bypasses + {totals.misses} misses。</p>
      <div className={styles.filters}><label>请求 key 筛选<input aria-label="请求 key 筛选" value={requestKey} onChange={(event) => { setRequestKey(event.target.value); setRequestPage(0) }} placeholder="完整 key；留空查看全部" /></label><label>结果筛选<select aria-label="请求结果筛选" value={outcome} onChange={(event) => { setOutcome(event.target.value); setRequestPage(0) }}><option value="all">全部</option><option value="bypass">绕过缓存</option><option value="hit">命中</option><option value="miss">未命中</option></select></label></div>
      <div className={styles.tableScroll}><table aria-label="逐请求证据表"><thead><tr><th>请求</th><th>逻辑 ms</th><th>key → owner</th><th>结果</th><th>后端读取</th></tr></thead><tbody>{events.slice(eventsPage * 15, eventsPage * 15 + 15).map((event) => <tr key={event.id} data-selected={event.index === selected.index}><td><button onClick={() => setSelectedIndex(event.index)}>{event.id}</button></td><td>{event.atMs}</td><td>{event.key} → {event.owner}</td><td>{outcomeLabels[event.outcome]}</td><td>{event.backendRead ? '1' : '0'}</td></tr>)}</tbody></table></div>
      <Pager label={`${events.length} 次读取`} page={eventsPage} count={events.length} setPage={setRequestPage} />
      {events.length ? <div className={hot.eventDetail} aria-live="polite"><h3>{selected.id} · {outcomeLabels[selected.outcome]}</h3><p>{selected.key} → {selected.owner} · {selected.atMs} 逻辑 ms</p><p>先清理过期：{selected.expired.join(', ') || '无'}；容量淘汰：{selected.evicted ?? '无'}。</p><p>填充：{selected.filled ? '是，同一时刻成功填充' : '无'}；expiresAt：{selected.expiresAt ?? '不适用'}；后端读取：{selected.backendRead ? 1 : 0}。</p><details><summary>查看这一请求的采样值</summary><p>gate={sample.gate} / 2³²；choice={sample.choice} / 2³²。{input.workload.pattern === 'uniform' ? '均匀访问用 choice 选择全部 key。' : `gate < ${input.workload.probability} × 2³² 时选择指定 hot key，否则 choice 选择其他 key。`}</p></details></div> : <p className={styles.note}>这个筛选条件下没有请求。</p>}
      <details className={styles.exploreSettings}><summary>结束时的缓存条目 · {result.cacheEntries.length} 项</summary><p>按 LRU 从旧到新排列；快照取最后一次请求时刻，不推进未来时间。命中不续期，expiresAt ≤ 当前时刻即过期。</p><div className={styles.tableScroll}><table><thead><tr><th>key</th><th>expiresAt（逻辑 ms）</th></tr></thead><tbody>{result.cacheEntries.map((entry) => <tr key={entry.key}><td>{entry.key}</td><td>{entry.expiresAt}</td></tr>)}</tbody></table></div></details>
    </section>
    <details className={styles.panel}><summary>查看完整键分配与哈希环</summary><DistributionView result={result.distribution} baseline={before?.distribution ?? null} label="本次读取使用的键分配" onUseKey={onUseKey} /></details>
  </>
}
function Pager({ label, page, count, setPage }: { label: string; page: number; count: number; setPage: (value: number) => void }) {
  return <div className={styles.pagination}><span>{label} · 第 {page + 1} / {Math.max(1, Math.ceil(count / 15))} 页</span><button disabled={!page} onClick={() => setPage(page - 1)}>上一页</button><button disabled={(page + 1) * 15 >= count} onClick={() => setPage(page + 1)}>下一页</button></div>
}
