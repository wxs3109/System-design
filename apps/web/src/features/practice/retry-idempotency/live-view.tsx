import { useState } from 'react'
import { attemptLimit, clientSettled, clientStatus, MAX_TIME_MS, nextTimer, pendingCount, type Command, type Payload, type ProtocolEvent, type ProtocolState, type RetryConfig } from './model'
import styles from './retry-lab.module.css'

export const clientLabels = { idle: '尚未提交', waiting: '正在等待', unknown: '结果未知', success: '已收到任务结果', rejected: '收到参数冲突' } as const
const locations = { network: '在网络中', server: '等待服务端处理', committed: '已处理', dropped: '已丢弃', 'lost-on-crash': '未提交内容随崩溃丢失' }
const outcomes = { created: '新建任务', replayed: '重放已有结果', conflict: '参数冲突' }
export const eventLabels: Record<string, string> = { 'request-sent': '发送请求', 'request-delivered': '请求到达', 'request-dropped': '请求丢失', 'transaction-created': '原子创建', 'transaction-replayed': '幂等重放', 'transaction-conflict': '拒绝冲突', 'response-sent': '发送响应', 'response-delivered': '响应到达', 'response-dropped': '响应丢失', timeout: '等待超时', 'retry-scheduled': '安排重试', 'budget-exhausted': '预算耗尽', 'clock-advanced': '推进时间', 'server-crashed': '服务崩溃', 'server-restarted': '服务恢复', 'dedupe-expired': '去重到期' }

export function LiveView({ config, state, act, disabled }: { config: RetryConfig; state: ProtocolState; act: (command: Command) => void; disabled: boolean }) {
  const [customKey, setCustomKey] = useState(config.key)
  const [format, setFormat] = useState<Payload['format']>(config.payload.format)
  const [advanceMs, setAdvanceMs] = useState(500)
  const next = nextTimer(state)
  const canRetry = state.requests.length > 0 && state.requests.length < attemptLimit(config) && !clientSettled(state) && config.strategy !== 'no-retry'
  return <>
    <div id="protocol-state" className={styles.metrics} aria-label="当前协议状态">
      <div><small>逻辑时间</small><strong data-testid="retry-clock">{state.now} <span>ms</span></strong></div>
      <div><small>发送尝试</small><strong data-testid="retry-request-count">{state.requests.length} <span>/ {attemptLimit(config)}</span></strong></div>
      <div><small>服务端实际创建</small><strong data-testid="retry-task-count">{state.store.tasks.length} <span>个任务</span></strong></div>
      <div><small>客户端获知结果</small><strong data-testid="retry-known-count">{state.knownTaskIds.length} <span>个任务</span></strong></div>
    </div>
    <div className={styles.actors}>
      <section className={styles.actor} aria-label="客户端状态"><span className={styles.actorNumber}>01 / CLIENT</span><h2>客户端</h2><strong className={styles.status} data-testid="retry-client-status">{clientLabels[clientStatus(state)]}</strong>
        <p>已收到：{state.knownTaskIds.join('、') || '没有任务编号'}。客户端不能直接查看服务端任务表。</p>
        {state.requests.some((request) => request.wait === 'timed-out') && !clientSettled(state) ? <p className={styles.unknown}>已有尝试超时，业务结果仍未知；等待或发送重试不代表原请求没有执行。</p> : null}
        <button className={styles.primary} disabled={disabled || state.requests.length > 0} onClick={() => act({ type: 'submit' })}>提交请求</button>
        <button disabled={disabled || !canRetry} onClick={() => act({ type: 'retry', key: config.key, payload: config.payload })}>立即重试（同键同参数）</button>
        <p className={styles.note}>{state.retryAt === null ? '当前没有待发送的自动重试。' : `自动重试计划：${state.retryAt} ms。`}</p>
        <button disabled={disabled || next === null || next > MAX_TIME_MS} onClick={() => { if (next !== null) act({ type: 'advance', ms: Math.max(1, next - state.now) }) }}>推进下一计时器{next !== null ? `（到 ${next} ms）` : ''}</button>
        <div className={styles.advance}><select aria-label="推进逻辑时间" value={advanceMs} onChange={(event) => setAdvanceMs(Number(event.target.value))}>{[100, 500, 2000, 10000].map((ms) => <option key={ms} value={ms}>{ms} ms</option>)}</select><button disabled={disabled || state.now + advanceMs > MAX_TIME_MS} onClick={() => act({ type: 'advance', ms: advanceMs })}>推进时间</button></div>
        <details className={styles.advanced}><summary>边界实验：换键或改参数</summary><label>本次手动重试的键<input aria-label="自定义重试键" maxLength={60} value={customKey} onChange={(event) => setCustomKey(event.target.value)} /></label><label>本次视频参数<select aria-label="自定义重试格式" value={format} onChange={(event) => setFormat(event.target.value as Payload['format'])}><option value="720p">720p</option><option value="1080p">1080p</option></select></label><button disabled={disabled || !canRetry} onClick={() => act({ type: 'retry', key: customKey, payload: { ...config.payload, format } })}>用自定义参数重试</button><p className={styles.note}>只改变这一次手动请求。自动重试继续沿用初始键和参数。可先丢响应，再测试同键不同参数的冲突。</p></details>
      </section>
      <section className={styles.actor} aria-label="网络中的消息"><span className={styles.actorNumber}>02 / NETWORK</span><h2>递送，或制造丢失</h2><p>消息不会自动递送。保留在这里就是延迟；超时不会撤回它。</p>
        {state.requests.filter((request) => request.location === 'network').map((request) => <div className={styles.message} key={request.id} data-testid={request.id}><strong>{request.id} → 服务</strong><span>{request.key} · {request.payload.videoId} / {request.payload.format}</span><small>{request.wait === 'timed-out' ? '客户端已超时，这条请求仍可到达' : `等待截止 ${request.deadline} ms`}</small><div><button disabled={disabled || !state.serverOnline} onClick={() => act({ type: 'deliver-request', requestId: request.id })}>递送 {request.id}</button><button disabled={disabled} onClick={() => act({ type: 'drop-request', requestId: request.id })}>丢弃 {request.id}</button></div></div>)}
        {state.responses.filter((response) => response.location === 'network').map((response) => <div className={`${styles.message} ${styles.response}`} key={response.id} data-testid={response.id}><strong>{response.id} → 客户端</strong><span>{outcomes[response.outcome]} {response.taskId ?? ''}</span><small>尚未递送，客户端还不知道这个结果</small><div><button disabled={disabled} onClick={() => act({ type: 'deliver-response', responseId: response.id })}>递送 {response.id}</button><button disabled={disabled} onClick={() => act({ type: 'drop-response', responseId: response.id })}>丢弃 {response.id}</button></div></div>)}
        {!state.requests.some((request) => request.location === 'network') && !state.responses.some((response) => response.location === 'network') ? <div className={styles.empty}>网络中没有消息。提交、重试或处理请求后，会产生新消息。</div> : null}
      </section>
      <section className={styles.actor} aria-label="服务端操作"><span className={styles.actorNumber}>03 / SERVICE</span><h2>服务端</h2><strong className={styles.status}>{state.serverOnline ? '在线' : '进程已崩溃'}</strong><p>{config.strategy === 'idempotent' ? '用一个原子步骤完成判重、创建和结果记录。同键同参数返回已有任务。' : '当前未启用幂等记录。每次处理独立创建一个任务。'}</p>
        {state.requests.filter((request) => request.location === 'server').map((request) => <div className={styles.message} key={request.id}><strong>{request.id} · 已收到，未提交</strong><span>{request.key} · {request.payload.format}</span><button disabled={disabled || !state.serverOnline} onClick={() => act({ type: 'commit', requestId: request.id })}>处理 {request.id}</button></div>)}
        <div className={styles.faultActions}><button disabled={disabled || !state.serverOnline} onClick={() => act({ type: 'crash' })}>服务崩溃</button><button disabled={disabled || state.serverOnline} onClick={() => act({ type: 'restart' })}>重启服务</button></div><p className={styles.note}>崩溃清空未提交收件箱；本模型保留已提交任务和去重记录。原子步骤内部不插入崩溃。</p>
      </section>
    </div>
    <section className={styles.panel} aria-label="服务端稳定状态"><div className={styles.heading}><h2>服务端稳定状态</h2><span>全局教学视角 · 客户端不能据此决定重试</span></div><div className={styles.ledgers}>
      <div><h3>任务表 · {state.store.tasks.length} 条实际效果</h3><div className={styles.tableScroll}><table aria-label="实际任务表"><thead><tr><th>任务</th><th>创建请求</th><th>参数</th><th>提交时刻</th></tr></thead><tbody>{state.store.tasks.map((task) => <tr key={task.id}><td>{task.id}</td><td>{task.requestId}</td><td>{task.payload.videoId} / {task.payload.format}</td><td>{task.createdAt} ms</td></tr>)}</tbody></table></div>{!state.store.tasks.length ? <p className={styles.note}>尚未创建任务。</p> : null}</div>
      <div><h3>幂等记录 · {state.store.records.length} 条</h3><div className={styles.tableScroll}><table aria-label="幂等记录表"><thead><tr><th>键 / 调用方</th><th>返回任务</th><th>参数</th><th>有效期</th></tr></thead><tbody>{state.store.records.map((record) => <tr key={record.scope}><td>{record.key}<small>{record.callerId} · create-transcode</small></td><td>{record.taskId}</td><td>{record.payload.format}</td><td>{record.expiresAt} ms<small>{record.expiresAt <= state.now ? '已过期，下一次提交时清理' : '有效；重放不续期'}</small></td></tr>)}</tbody></table></div>{!state.store.records.length ? <p className={styles.note}>{config.strategy === 'idempotent' ? '第一次原子创建后产生记录。' : '普通策略不保存幂等记录。'}</p> : null}</div>
    </div><p className={styles.note}>待处理的请求/响应：{pendingCount(state)}。{next !== null ? `下一计时器 ${next} ms。` : '没有待触发的计时器。'} 原始提交是一项逻辑意图；发送尝试、创建效果、客户端获知的结果分别计数。</p></section>
    <details className={styles.panel}><summary>所有请求及其状态</summary><div className={styles.tableScroll}><table><thead><tr><th>请求</th><th>位置</th><th>客户端等待</th><th>发送 / 截止时刻</th></tr></thead><tbody>{state.requests.map((request) => <tr key={request.id}><td>{request.id}</td><td>{locations[request.location]}</td><td>{request.wait}</td><td>{request.sentAt} / {request.deadline} ms</td></tr>)}</tbody></table></div></details>
  </>
}

export function Timeline({ events }: { events: ProtocolEvent[] }) {
  const [selected, setSelected] = useState<number | null>(null)
  const active = events.find((event) => event.index === selected) ?? events.at(-1)
  const activePosition = active ? events.indexOf(active) : 0
  const visible = events.slice(Math.max(0, activePosition - 8), activePosition + 1)
  const x = { client: 90, network: 290, service: 490, store: 690 }
  const names = { client: '客户端', network: '网络', service: '服务端', store: '稳定存储' }
  return <section className={styles.panel} aria-label="请求时序与完整事件"><div className={styles.heading}><h2>逐步发生了什么</h2><span>每行一个实际事件，纵向距离不代表耗时</span></div>
    {events.length ? <><div className={styles.diagram}><svg viewBox={`0 0 800 ${70 + visible.length * 46}`} role="img" aria-label="请求与响应的事件时序图，可在下方表格逐条选择">
      <defs><marker id="retry-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7" fill="var(--cyan-deep)" /></marker></defs>
      {(Object.keys(x) as (keyof typeof x)[]).map((actor) => <g key={actor}><text x={x[actor]} y="24" textAnchor="middle" fill="var(--text)" fontSize="14">{names[actor]}</text><line x1={x[actor]} x2={x[actor]} y1="40" y2={60 + visible.length * 46} stroke="var(--border-bright)" strokeDasharray="4 4" /></g>)}
      {visible.map((event, index) => { const y = 65 + index * 46; return <g key={event.index}><text x="8" y={y} fill="var(--muted)" fontSize="11">#{event.index}</text>{event.from === event.to ? <circle cx={x[event.from]} cy={y} r="5" fill="var(--cyan-deep)" /> : <line x1={x[event.from]} y1={y} x2={x[event.to]} y2={y} stroke="var(--cyan-deep)" strokeWidth="2" markerEnd="url(#retry-arrow)" />}<text x={(x[event.from] + x[event.to]) / 2} y={y - 10} textAnchor="middle" fill="var(--text)" fontSize="11">{event.at} ms · {eventLabels[event.kind] ?? event.kind}</text></g> })}
    </svg></div><div className={styles.eventDetail} aria-live="polite"><strong>#{active!.index} · {active!.at} ms · {eventLabels[active!.kind]}</strong><p>{active!.detail}</p></div>
      <div className={`${styles.tableScroll} ${styles.eventTable}`}><table aria-label="完整协议事件表"><thead><tr><th>事件</th><th>时刻</th><th>方向</th><th>请求</th></tr></thead><tbody>{events.map((event) => <tr key={event.index} data-selected={event.index === active?.index}><td><button onClick={() => setSelected(event.index)}>#{event.index} {eventLabels[event.kind]}</button></td><td>{event.at} ms</td><td>{names[event.from]} → {names[event.to]}</td><td>{event.requestId ?? '—'}</td></tr>)}</tbody></table></div></> : <div className={styles.empty}>点击“提交请求”开始。每次递送、丢弃、处理或推进时间都会产生实际状态变化和事件。</div>}
  </section>
}
