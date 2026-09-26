import { useId, useState } from 'react'
import styles from '../retry-idempotency/retry-lab.module.css'
import type { TimelineEvent } from './events'

export function EventTimeline({ events, actors, labels, timeUnit = 'ms' }: { events: readonly TimelineEvent[]; actors: readonly { id: string; label: string }[]; labels: Readonly<Record<string, string>>; timeUnit?: 'ms' | 'step' }) {
  const unit = timeUnit === 'step' ? '步' : 'ms'
  const [selection, setSelection] = useState<number | null>(null)
  const marker = useId().replaceAll(':', '')
  const active = events.find((event) => event.index === selection) ?? events.at(-1)
  const position = active ? events.indexOf(active) : 0
  const shown = events.slice(Math.max(0, position - 8), position + 1)
  const x = new Map(actors.map((actor, index) => [actor.id, 90 + index * (600 / Math.max(1, actors.length - 1))]))
  const name = (id: string) => actors.find((actor) => actor.id === id)?.label ?? id
  return <section className={styles.panel} aria-label="协议事件时序"><div className={styles.heading}><h2>完整事件与时序</h2><span>每行一个真实状态转换；纵向距离不代表耗时</span></div>
    {active ? <><div className={styles.diagram}><svg viewBox={`0 0 800 ${70 + shown.length * 46}`} role="img" aria-label="协议时序图，下方事件表提供等价键盘操作"><defs><marker id={marker} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7" fill="var(--cyan-deep)" /></marker></defs>
      {actors.map((actor) => <g key={actor.id}><text x={x.get(actor.id)} y="25" textAnchor="middle" fill="var(--text)" fontSize="14">{actor.label}</text><line x1={x.get(actor.id)} x2={x.get(actor.id)} y1="40" y2={60 + shown.length * 46} stroke="var(--border-bright)" strokeDasharray="4 4" /></g>)}
      {shown.map((event, index) => { const y = 65 + index * 46; const from = x.get(event.from)!; const to = x.get(event.to)!; return <g key={event.index}><text x="8" y={y} fill="var(--muted)" fontSize="11">#{event.index}</text>{from === to ? <circle cx={from} cy={y} r="5" fill="var(--cyan-deep)" /> : <line x1={from} x2={to} y1={y} y2={y} stroke="var(--cyan-deep)" strokeWidth="2" markerEnd={`url(#${marker})`} />}<text x={(from + to) / 2} y={y - 10} textAnchor="middle" fill="var(--text)" fontSize="11">{event.at} {unit} · {labels[event.kind] ?? event.kind}</text></g> })}
    </svg></div><div className={styles.eventDetail} aria-live="polite"><strong>#{active.index} · {active.at} {unit} · {labels[active.kind] ?? active.kind}</strong><p>{active.detail}</p></div><div className={`${styles.tableScroll} ${styles.eventTable}`}><table aria-label="完整消息事件表"><thead><tr><th>事件</th><th>时刻</th><th>方向</th><th>对象</th></tr></thead><tbody>{events.map((event) => <tr key={event.index} data-selected={event.index === active.index}><td><button onClick={() => setSelection(event.index)}>#{event.index} {labels[event.kind] ?? event.kind}</button></td><td>{event.at} {unit}</td><td>{name(event.from)} → {name(event.to)}</td><td>{event.subject ?? '—'}</td></tr>)}</tbody></table></div></> : <div className={styles.empty}>开始操作后，这里会记录每次提交、投递、确认、故障与恢复。</div>}
  </section>
}
