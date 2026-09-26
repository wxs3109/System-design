import { useMemo, useState } from 'react'
import { compare, methodLabels, type DistributionResult } from './model'
import styles from './hashing-lab.module.css'

const palette = ['#67e8f9', '#a5b4fc', '#fbbf24', '#f9a8d4', '#86efac', '#fb923c', '#c4b5fd', '#2dd4bf', '#f87171', '#94a3b8', '#bef264', '#e879f9']
const percent = (value: number) => `${(value * 100).toFixed(1)}%`
export const hex = (hash: number) => `0x${hash.toString(16).padStart(8, '0')}`

export function DistributionView({ result, baseline, label, onUseKey }: { result: DistributionResult; baseline: DistributionResult | null; label: string; onUseKey: (key: string) => void }) {
  const [selectedKey, setSelectedKey] = useState('')
  const [selectedNode, setSelectedNode] = useState('')
  const [query, setQuery] = useState('')
  const [onlyChanged, setOnlyChanged] = useState(false)
  const [transferFilter, setTransferFilter] = useState('')
  const [page, setPage] = useState(0)
  const [zoom, setZoom] = useState(1)
  const comparison = useMemo(() => baseline ? compare(baseline, result) : null, [baseline, result])
  const owners = useMemo(() => new Map(baseline?.assignments.map((item) => [item.key, item.owner])), [baseline])
  const selected = result.assignments.find((item) => item.key === selectedKey) ?? result.assignments[0]!
  const nodeColor = (nodeId: string) => palette[result.input.nodes.indexOf(nodeId) % palette.length] ?? '#94a3b8'
  const filtered = result.assignments.filter((item) => (!query || item.key.includes(query)) && (!selectedNode || item.owner === selectedNode) && (!onlyChanged || (comparison && owners.get(item.key) !== item.owner)) && (!transferFilter || JSON.stringify([owners.get(item.key), item.owner]) === transferFilter))
  const activePage = Math.min(page, Math.max(0, Math.ceil(filtered.length / 20) - 1))
  const rows = filtered.slice(activePage * 20, activePage * 20 + 20)
  const sample = result.assignments.filter((_, index) => index % Math.ceil(result.assignments.length / 64) === 0)
  const point = (hash: number, radius: number) => { const theta = hash / 2 ** 32 * 2 * Math.PI - Math.PI / 2; return { x: 180 + radius * Math.cos(theta), y: 180 + radius * Math.sin(theta) } }
  return <section className={styles.panel} aria-label="分布与逐 key 证据">
    <div className={styles.sectionHeading}><div><span className={styles.eyebrow}>{label}</span><h2>{methodLabels[result.input.method]} · {result.input.nodes.length} 个节点</h2></div><span className={styles.tag}>{result.input.keys.length.toLocaleString()} keys</span></div>
    <div className={styles.metrics}>
      <div><small>最大节点份额</small><strong>{percent(result.maxShare)}</strong>{baseline ? <small>基线 {percent(baseline.maxShare)}</small> : null}</div>
      <div><small>最大 / 平均键数</small><strong>{result.maxToMean.toFixed(2)}×</strong>{baseline ? <small>基线 {baseline.maxToMean.toFixed(2)}×</small> : null}</div>
      <div><small>需要重映射</small><strong data-testid="remapped-count">{comparison ? comparison.remapped.toLocaleString() : '—'}</strong><small>{comparison ? `${percent(comparison.fraction)} / 全部 ${result.input.keys.length} keys` : '固定同一数据集的基线后比较'}</small></div>
    </div>
    {baseline ? <p className={styles.note}>基线：{methodLabels[baseline.input.method]} · {baseline.input.nodes.join(', ')}。{comparison ? ({ membership: '仅成员变化。', algorithm: '仅分配方法变化。', virtualNodes: '仅 token 数变化。', combined: '多个条件同时变化，不按单一原因解释。', unchanged: '与基线相同。' }[comparison.kind]) : '数据集或版本不同，不提供重映射对照。'}</p> : null}
    <div className={styles.diagramGrid}>
      <div className={styles.diagram}>
        {result.input.method === 'modulo' ? <div className={styles.slots}><p>hash(key) mod {result.input.nodes.length}</p>{result.input.nodes.map((nodeId, index) => <button key={nodeId} aria-pressed={selectedNode === nodeId} onClick={() => { setSelectedNode(selectedNode === nodeId ? '' : nodeId); setPage(0) }}><b>槽 {index}</b><span style={{ borderColor: nodeColor(nodeId) }}>{nodeId}</span></button>)}<small>成员按固定 ID 排序；移除中间成员会重建槽位。</small></div> : <>
          <div className={styles.ringViewport}><svg viewBox={`${180 - 180 / zoom} ${180 - 180 / zoom} ${360 / zoom} ${360 / zoom}`} role="img" aria-label="哈希环：顺时针查找首个 token，键盘操作可使用下方表格">
            <circle cx="180" cy="180" r="125" fill="none" stroke="var(--border-bright)" strokeWidth="2" />
            {sample.map((item) => { const p = point(item.hash, 106); return <circle key={item.key} cx={p.x} cy={p.y} r="2" fill="var(--muted)" opacity=".5" /> })}
            {result.tokens.map((token) => { const a = point(token.hash, 120); const b = point(token.hash, 131); return <line key={`${token.nodeId}:${token.index}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={nodeColor(token.nodeId)} strokeWidth={selectedNode === token.nodeId ? 3 : 1.5} opacity={selectedNode && selectedNode !== token.nodeId ? .2 : .85} /> })}
            {selected.token ? <line x1={point(selected.hash, 106).x} y1={point(selected.hash, 106).y} x2={point(selected.token.hash, 125).x} y2={point(selected.token.hash, 125).y} stroke="var(--text)" strokeDasharray="4 3" /> : null}
            <circle cx={point(selected.hash, 106).x} cy={point(selected.hash, 106).y} r="5" fill="var(--text)" />
            <text x="180" y="176" textAnchor="middle" fill="var(--text)" fontSize="17">{result.tokens.length} tokens</text><text x="180" y="199" textAnchor="middle" fill="var(--muted)" fontSize="12">顺时针 → 第一个 ≥ key hash</text>
            <text x="180" y="34" textAnchor="middle" fill="var(--muted)" fontSize="11">0 / 2³² · 回绕</text>
          </svg></div><label className={styles.zoom}>视图缩放 <input aria-label="哈希环缩放" type="range" min="1" max="1.6" step="0.1" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label>
          <p className={styles.note}>环内小点抽样 {sample.length} 个 key；大圆点表示选中的 key。token 全量显示，统计始终覆盖全部 key。</p>
        </>}
      </div>
      <div className={styles.nodeCounts}><h3>每个物理节点的 key 数</h3><p className={styles.note}>最少 {result.min} · 平均 {result.mean.toFixed(1)} · 键数不代表 CPU 或请求量</p>{result.counts.map((item) => <button key={item.nodeId} aria-pressed={selectedNode === item.nodeId} onClick={() => { setSelectedNode(selectedNode === item.nodeId ? '' : item.nodeId); setPage(0) }}><span><b>{item.nodeId}</b><strong>{item.count} <small>({percent(item.count / result.input.keys.length)})</small></strong></span><span className={styles.bar}><i style={{ width: percent(item.count / result.input.keys.length), background: nodeColor(item.nodeId) }} /></span></button>)}</div>
    </div>
    <div className={styles.keyDetail} aria-live="polite"><strong>{selected.key}</strong><span>hash {hex(selected.hash)}</span><span>{comparison ? `${owners.get(selected.key)} → ` : ''}{selected.owner}</span><span>{selected.token ? `token #${selected.token.index} · ${hex(selected.token.hash)}` : `槽 ${selected.hash % result.input.nodes.length}`}</span>{comparison && owners.get(selected.key) !== selected.owner ? <button onClick={() => onUseKey(selected.key)}>用这个 key 作答</button> : null}</div>
    {comparison ? <details className={styles.transfers}><summary>转移表 · 包含未变化项，共 {result.input.keys.length} keys</summary><div className={styles.tableScroll}><table><thead><tr><th>旧 owner</th><th>新 owner</th><th>key 数</th><th>查看</th></tr></thead><tbody>{comparison.transfers.map((item) => <tr key={`${item.from}:${item.to}`}><td>{item.from}</td><td>{item.to}</td><td>{item.count}{item.from === item.to ? ' · 未变化' : ' · 变化'}</td><td><button onClick={() => { setTransferFilter(JSON.stringify([item.from, item.to])); setOnlyChanged(false); setSelectedNode(''); setQuery(''); setPage(0) }}>查看这些 key</button></td></tr>)}</tbody></table></div></details> : null}
    <div className={styles.filters}><label>查找 key<input value={query} onChange={(event) => { setQuery(event.target.value); setPage(0) }} placeholder="输入 key 或编号" /></label><label className={styles.checkbox}><input type="checkbox" checked={onlyChanged} disabled={!comparison} onChange={(event) => { setOnlyChanged(event.target.checked); setPage(0) }} />只看归属变化</label><button onClick={() => { setQuery(''); setSelectedNode(''); setOnlyChanged(false); setTransferFilter(''); setPage(0) }}>清除筛选</button></div>
    <div className={styles.tableScroll}><table aria-label="完整 key 归属表（分页）"><thead><tr><th>key</th><th>hash</th><th>旧 → 新 owner</th><th>状态</th></tr></thead><tbody>{rows.map((item) => <tr key={item.key} data-selected={selected.key === item.key}><td><button onClick={() => setSelectedKey(item.key)}>{item.key}</button></td><td>{hex(item.hash)}</td><td>{comparison ? `${owners.get(item.key)} → ` : ''}{item.owner}</td><td>{comparison ? owners.get(item.key) === item.owner ? '未变化' : '变化' : '当前归属'}</td></tr>)}</tbody></table></div>
    <div className={styles.pagination}><span>{filtered.length} 条 · 第 {activePage + 1} / {Math.max(1, Math.ceil(filtered.length / 20))} 页</span><button disabled={activePage === 0} onClick={() => setPage(activePage - 1)}>上一页</button><button disabled={(activePage + 1) * 20 >= filtered.length} onClick={() => setPage(activePage + 1)}>下一页</button></div>
  </section>
}
