import { useState } from 'react'
import { makeInput, methodLabels, methods } from '../distribution/model'
import { generateWorkload, type HotInput, type Workload } from './model'
import { type HotDraft, stageLabels } from './lesson'
import styles from '../distribution/hashing-lab.module.css'
import hot from './hot-key.module.css'

export const workOptions = (work: Workload) => ({ seed: work.seed, count: work.count, pattern: work.pattern, probability: work.probability, hotKey: work.hotKey })
export const stageNotes = {
  hotspot: '固定 1,024 个 key 与 10,000 次读取，将均匀访问改成热点访问。底层采样值保持相同，观察请求是否集中。',
  shards: '固定 80% 目标热点与完整读取序列。从每节点 8 个 token 开始，增加 token 或新增 node-e，观察同一 hot key 的请求归属。',
  cache: '固定 80% 目标热点、相同 key 分配与完整读取序列，启用共享只读缓存，比较实际后端访问。',
  explore: '自行选择数据集、热点、节点与缓存策略。先固定基线，再只改变一个条件；也可运行均匀大工作集反例。',
}

export function HotControls({ draft, ready, edit }: { draft: HotDraft; ready: boolean; edit: (next: HotDraft) => void }) {
  const [datasetSeed, setDatasetSeed] = useState(draft.input.distribution.datasetSeed)
  const [workSeed, setWorkSeed] = useState(draft.input.workload.seed)
  const [keyCount, setKeyCount] = useState(draft.input.distribution.keys.length)
  const [requestCount, setRequestCount] = useState(draft.input.workload.count)
  const [error, setError] = useState('')
  const { input, stage } = draft
  const exploring = stage === 'explore'
  const update = (value: HotInput, operation: string) => edit({ ...draft, input: value, operations: [...draft.operations, operation] })
  const regenerate = (patch: Partial<ReturnType<typeof workOptions>>) => update({ ...input, workload: generateWorkload(input.distribution, { ...workOptions(input.workload), ...patch }) }, `负载：${JSON.stringify(patch)}`)
  const changeDistribution = (patch: Partial<HotInput['distribution']>, operation: string) => update({ ...input, distribution: { ...input.distribution, ...patch } }, operation)
  const applyDataset = (counterexample = false) => {
    try {
      const distribution = { ...makeInput(counterexample ? 'large-working-set' : datasetSeed, counterexample ? 4096 : keyCount), method: input.distribution.method, virtualNodes: input.distribution.virtualNodes, nodes: input.distribution.nodes }
      const workload = generateWorkload(distribution, { seed: counterexample ? 'uniform-reads' : workSeed, count: counterexample ? 10000 : requestCount, pattern: counterexample ? 'uniform' : input.workload.pattern, probability: input.workload.probability, hotKey: distribution.keys[0]! })
      update({ ...input, distribution, workload, cache: counterexample ? { enabled: true, capacity: 16, ttlMs: 60000 } : input.cache }, counterexample ? '均匀大工作集：4096 keys、16 条缓存' : '生成新数据集与读取序列')
      setDatasetSeed(distribution.datasetSeed)
      setWorkSeed(workload.seed)
      setKeyCount(distribution.keys.length)
      setRequestCount(workload.count)
      setError('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '数据集参数无效。') }
  }
  return <>
    <section className={styles.panel}><span className={styles.eyebrow}>01 / 条件与预测</span><h2>{stageLabels[stage]}</h2><p>{stageNotes[stage]}</p>
      <div className={styles.facts}><span>完整 key 集 <b>{input.distribution.keys.length}</b></span><span>读取次数 <b>{input.workload.count.toLocaleString()}</b></span><span>负载 seed <b>{input.workload.seed}</b></span></div>
      <label>你的预测<select aria-label="热点实验预测" value={draft.prediction} disabled={!ready} onChange={(event) => edit({ ...draft, prediction: event.target.value })}><option value="">先预测（允许出错）</option><option value="concentrated">请求仍可能集中到一个 owner</option><option value="balanced">请求将跟 key 数一样均匀</option><option value="cache-reduces">缓存会减少后端读取</option><option value="uncertain">还不确定，先观察</option></select></label>
      <p className={styles.note}>预测不计对错。逻辑时间每次递增 1 ms，只用于顺序和 TTL。</p>
    </section>
    <section className={styles.panel}><span className={styles.eyebrow}>02 / 调整实验</span><h2>调整本次实验</h2><fieldset className={hot.fieldSet} disabled={!ready || (!exploring && !draft.prediction)}>
      <label>访问分布<select aria-label="访问分布" value={input.workload.pattern} disabled={!exploring && stage !== 'hotspot'} onChange={(event) => regenerate({ pattern: event.target.value as Workload['pattern'] })}><option value="uniform">均匀访问</option><option value="hotspot">热点访问</option></select></label>
      <label>指定 hot key<select aria-label="指定 hot key" value={input.workload.hotKey} disabled={!exploring} onChange={(event) => regenerate({ hotKey: event.target.value })}>{input.distribution.keys.map((key) => <option key={key} value={key}>{key}</option>)}</select></label>
      <label>热点目标概率<select aria-label="热点目标概率" value={input.workload.probability} disabled={input.workload.pattern !== 'hotspot' || (!exploring && stage !== 'hotspot')} onChange={(event) => regenerate({ probability: Number(event.target.value) })}>{[.2, .8, .95].map((p) => <option key={p} value={p}>{p * 100}%</option>)}</select></label>
      <p className={styles.note}>改热点会改变负载，复用同一采样值；改分片或缓存保留完整请求序列。</p>
      <label>分配方法<select aria-label="热点分配方法" value={input.distribution.method} disabled={!exploring} onChange={(event) => changeDistribution({ method: event.target.value as HotInput['distribution']['method'], virtualNodes: event.target.value === 'vnodes' ? 32 : 1 }, `分配方法：${event.target.value}`)}>{methods.map((method) => <option key={method} value={method}>{methodLabels[method]}</option>)}</select></label>
      {input.distribution.method === 'vnodes' ? <label>每节点 token 数<select aria-label="热点每节点 token 数" value={input.distribution.virtualNodes} disabled={!exploring && stage !== 'shards'} onChange={(event) => changeDistribution({ virtualNodes: Number(event.target.value) }, `每节点 token：${event.target.value}`)}>{[8, 32, 128].map((v) => <option key={v}>{v}</option>)}</select></label> : null}
      <ul className={styles.members} aria-label="热点实验节点">{input.distribution.nodes.map((id) => <li key={id}><span>{id}</span><button aria-label={`移除热点节点 ${id}`} disabled={!exploring || input.distribution.nodes.length === 1} onClick={() => changeDistribution({ nodes: input.distribution.nodes.filter((node) => node !== id) }, `移除 ${id}`)}>移除</button></li>)}</ul>
      <button className={styles.secondary} disabled={input.distribution.nodes.length >= 12 || (!exploring && (stage !== 'shards' || input.distribution.nodes.includes('node-e')))} onClick={() => {
        let index = 1
        while ([...input.distribution.nodes, ...draft.operations].some((text) => text.includes(`node-${String(index).padStart(2, '0')}`))) index++
        const id = exploring ? `node-${String(index).padStart(2, '0')}` : 'node-e'
        changeDistribution({ nodes: [...input.distribution.nodes, id] }, `新增 ${id}`)
      }}>添加热点节点</button>
      <label>读取缓存<select aria-label="读取缓存" value={input.cache.enabled ? 'on' : 'off'} disabled={!exploring && stage !== 'cache'} onChange={(event) => update({ ...input, cache: { ...input.cache, enabled: event.target.value === 'on' } }, `缓存：${event.target.value}`)}><option value="off">无缓存</option><option value="on">共享只读 LRU 缓存</option></select></label>
      <label>缓存条目容量<select aria-label="缓存条目容量" value={input.cache.capacity} disabled={!input.cache.enabled || (!exploring && stage !== 'cache')} onChange={(event) => update({ ...input, cache: { ...input.cache, capacity: Number(event.target.value) } }, `容量：${event.target.value}`)}>{[16, 64, 256].map((value) => <option key={value}>{value}</option>)}</select></label>
      <label>TTL（逻辑 ms）<select aria-label="缓存 TTL" value={input.cache.ttlMs} disabled={!input.cache.enabled || (!exploring && stage !== 'cache')} onChange={(event) => update({ ...input, cache: { ...input.cache, ttlMs: Number(event.target.value) } }, `TTL：${event.target.value}`)}>{[100, 1000, 60000].map((value) => <option key={value}>{value}</option>)}</select></label>
      <p className={styles.note}>空缓存启动；命中不续期，先清理所有已过期项，再查找 key。未命中成功回源并在同一时刻填充。</p>
      {exploring ? <><button className={styles.secondary} onClick={() => edit({ ...draft, baseline: structuredClone(input), operations: [...draft.operations, '固定当前基线'] })}>固定热点实验基线</button><details className={styles.exploreSettings}><summary>新的数据集或负载 seed</summary>
        <label>数据集 seed<input aria-label="热点数据集 seed" maxLength={80} value={datasetSeed} onChange={(event) => setDatasetSeed(event.target.value)} /></label>
        <label>负载 seed<input aria-label="读取负载 seed" maxLength={80} value={workSeed} onChange={(event) => setWorkSeed(event.target.value)} /></label>
        <label>Key 数量<select aria-label="热点 key 数量" value={keyCount} onChange={(event) => setKeyCount(Number(event.target.value))}>{[256, 1024, 4096].map((value) => <option key={value}>{value}</option>)}</select></label>
        <label>请求次数<select aria-label="热点请求次数" value={requestCount} onChange={(event) => setRequestCount(Number(event.target.value))}>{[1000, 10000, 20000].map((value) => <option key={value}>{value}</option>)}</select></label>
        <button onClick={() => applyDataset()}>生成新的热点实验数据</button><p className={styles.note}>新 seed 或总体会使旧对照不兼容；旧基线保留作参考。</p>
      </details><button className={styles.secondary} onClick={() => applyDataset(true)}>试试均匀大工作集反例</button></> : null}
    </fieldset>{error ? <p role="alert" className={styles.error}>{error}</p> : null}</section>
  </>
}
