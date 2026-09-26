import type { TimelineEvent } from '../protocol/events'

export type RetryPolicy = 'none' | 'immediate' | 'backoff' | 'jitter'
export type Profile = 'steady' | 'burst' | 'short-deadline'
export const retryLabels: Record<RetryPolicy, string> = { none: '不重试', immediate: '超时或拒绝后立即重试', backoff: '指数退避', jitter: '指数退避加确定性抖动' }
export const profileLabels: Record<Profile, string> = { steady: '12 个请求，每 100 ms 到达一个', burst: '12 个请求同时到达', 'short-deadline': '12 个请求同时到达，截止期 800 ms' }
export interface Config { modelVersion: 'overload-v1'; profile: Profile; retry: RetryPolicy; maxAttempts: number; queueLimit: number; senderLimit: number; discardExpired: boolean; slots: number; seed: number }
export interface Root { id: string; origin: 'workload' | 'manual'; arrival: number; deadline: number; phase: 'scheduled' | 'waiting' | 'active' | 'success' | 'expired' | 'cancelled'; offered: boolean; retryAt: number | null; successAt: number | null; firstWorkAt: number | null }
export interface Attempt { id: string; rootId: string; number: number; sentAt: number; timeoutAt: number; timeoutObserved: boolean; status: 'queued' | 'running' | 'completed' | 'rejected' | 'expired'; startedAt: number | null; finishAt: number | null; duration: number | null }
export interface Sample { at: number; queue: number; running: number; waiting: number; attempts: number; successes: number }
export interface State { now: number; started: boolean; stopped: boolean; serviceMs: number; roots: Root[]; attempts: Attempt[]; queue: string[]; events: TimelineEvent[]; samples: Sample[]; peakQueue: number }
export type Command = { type: 'start' | 'stop-traffic' | 'submit' | 'slow' | 'recover' } | { type: 'advance'; ms: number }
export const MAX_COMMANDS = 100
export const MAX_TIME = 10000
export const defaultConfig = (): Config => ({ modelVersion: 'overload-v1', profile: 'steady', retry: 'immediate', maxAttempts: 5, queueLimit: 60, senderLimit: 0, discardExpired: false, slots: 1, seed: 17 })
export const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
export function parseConfig(value: unknown): Config {
  const c = value as Config | null
  if (!c || c.modelVersion !== 'overload-v1' || !Object.hasOwn(profileLabels, c.profile) || !Object.hasOwn(retryLabels, c.retry) || ![1, 2, 3, 5].includes(c.maxAttempts) || ![0, 2, 8, 60].includes(c.queueLimit) || ![0, 1, 2, 4].includes(c.senderLimit) || typeof c.discardExpired !== 'boolean' || ![1, 2].includes(c.slots) || !Number.isInteger(c.seed) || c.seed < 0 || c.seed > 9999) throw new Error('过载模型配置或版本无效。')
  return { modelVersion: c.modelVersion, profile: c.profile, retry: c.retry, maxAttempts: c.maxAttempts, queueLimit: c.queueLimit, senderLimit: c.senderLimit, discardExpired: c.discardExpired, slots: c.slots, seed: c.seed }
}
export function parseCommand(value: unknown): Command {
  const c = value as Command | null
  if (!c || typeof c !== 'object') throw new Error('过载操作无效。')
  if (c.type === 'advance') { if (!Number.isInteger(c.ms) || c.ms < 1 || c.ms > MAX_TIME) throw new Error('推进时间无效。'); return { type: c.type, ms: c.ms } }
  if (!['start', 'stop-traffic', 'submit', 'slow', 'recover'].includes(c.type)) throw new Error('未知过载操作。')
  return { type: c.type }
}
export const profileArrivals = (profile: Profile) => Array.from({ length: 12 }, (_, index) => profile === 'steady' ? index * 100 : 0)
const deadlineDuration = (profile: Profile) => profile === 'short-deadline' ? 800 : 3000
function event(s: State, kind: string, from: string, to: string, detail: string, subject: string | null = null) { s.events.push({ index: s.events.length + 1, at: s.now, kind, from, to, detail, subject }) }
function sample(s: State) { s.peakQueue = Math.max(s.peakQueue, s.queue.length); s.samples.push({ at: s.now, queue: s.queue.length, running: s.attempts.filter((a) => a.status === 'running').length, waiting: s.roots.filter((r) => r.phase === 'waiting').length, attempts: s.attempts.length, successes: s.roots.filter((r) => r.phase === 'success').length }) }
function rootFor(s: State, a: Attempt) { return s.roots.find((r) => r.id === a.rootId)! }
function retryDelay(c: Config, root: Root, attempt: number): number {
  if (c.retry === 'immediate') return 0
  const base = Math.min(1600, 400 * 2 ** (attempt - 1))
  // Separate deterministic hash: policy changes never move arrivals or service faults.
  let hash = c.seed >>> 0
  for (const char of `${root.id}:${attempt}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0
  return base + (c.retry === 'jitter' ? hash % 201 : 0)
}
function retry(s: State, c: Config, r: Root) {
  if (r.phase !== 'active') return
  const count = s.attempts.filter((a) => a.rootId === r.id).length
  if (c.retry === 'none' || count >= c.maxAttempts) {
    event(s, 'retry-budget', 'client', 'client', '不再发送新尝试；仍可能收到已有工作的迟到结果，直到总截止期。', r.id)
    return
  }
  const at = s.now + retryDelay(c, r, count)
  if (at >= r.deadline) return
  r.retryAt = at
  event(s, 'retry-scheduled', 'client', 'client', `安排第 ${count + 1} 次尝试于 ${at} ms；原尝试不会因此停止。`, r.id)
}
function startWork(s: State, a: Attempt) {
  a.status = 'running'; a.startedAt = s.now; a.duration = s.serviceMs; a.finishAt = s.now + s.serviceMs
  event(s, 'work-started', 'queue', 'server', `${a.id} 开始处理，耗时 ${a.duration} ms；随后恢复速度不改变这项已开始的工作。`, a.rootId)
}
function pump(s: State, c: Config) {
  while (s.queue.length && s.attempts.filter((a) => a.status === 'running').length < c.slots) {
    const id = s.queue.shift()!
    const a = s.attempts.find((a) => a.id === id)!
    const r = rootFor(s, a)
    if (c.discardExpired && s.now >= r.deadline) {
      a.status = 'expired'
      event(s, 'stale-discarded', 'queue', 'queue', `${a.id} 已超过原始请求的截止期，出队时丢弃，不启动新工作。已经运行的工作继续。`, r.id)
    } else startWork(s, a)
  }
}
function send(s: State, c: Config, r: Root) {
  const number = s.attempts.filter((a) => a.rootId === r.id).length + 1
  const limit = c.retry === 'none' ? 1 : c.maxAttempts
  if (number > limit || s.attempts.length >= 100) throw new Error('尝试预算超限。')
  r.retryAt = null
  const a: Attempt = { id: `attempt-${s.attempts.length + 1}`, rootId: r.id, number, sentAt: s.now, timeoutAt: s.now + 200, timeoutObserved: false, status: 'queued', startedAt: null, finishAt: null, duration: null }
  s.attempts.push(a)
  event(s, 'attempt-sent', 'client', 'queue', `${r.id} 第 ${number} 次尝试 ${a.id}；原始到达时刻和总截止期保持不变。`, r.id)
  if (!s.queue.length && s.attempts.filter((a) => a.status === 'running').length < c.slots) startWork(s, a)
  else if (s.queue.length < c.queueLimit) { s.queue.push(a.id); s.peakQueue = Math.max(s.peakQueue, s.queue.length); event(s, 'enqueued', 'queue', 'queue', `${a.id} 等待处理，当前队列 ${s.queue.length}。`, r.id) }
  else { a.status = 'rejected'; event(s, 'rejected', 'queue', 'client', `${a.id} 因队列已满立即拒绝；拒绝不算业务成功。`, r.id); retry(s, c, r) }
}
export function nextTimer(s: State): number | null {
  const values: number[] = []
  for (const r of s.roots) {
    if (r.phase === 'scheduled') values.push(r.arrival)
    if (r.phase === 'waiting' || r.phase === 'active') values.push(r.deadline)
    if (r.phase === 'active' && r.retryAt !== null) values.push(r.retryAt)
  }
  for (const a of s.attempts) {
    if (a.status === 'running') values.push(a.finishAt!)
    if ((a.status === 'queued' || a.status === 'running') && !a.timeoutObserved && rootFor(s, a).phase === 'active') values.push(a.timeoutAt)
  }
  return values.length ? Math.min(...values) : null
}
function tick(s: State, c: Config) {
  // Boundary order: completed responses first, then total deadlines, attempt timeouts,
  // offered arrivals and sends. Starting queued work rechecks absolute freshness.
  for (const a of s.attempts.filter((a) => a.status === 'running' && a.finishAt! <= s.now)) {
    a.status = 'completed'
    const r = rootFor(s, a)
    r.firstWorkAt ??= s.now
    event(s, 'work-completed', 'server', 'client', `${a.id} 实际完成，消耗 ${a.duration} ms。${s.now > r.deadline ? '客户端总截止期已过，不能计为及时成功。' : '响应在模型中立即返回。'}`, r.id)
    if (r.phase === 'active' && s.now <= r.deadline) { r.phase = 'success'; r.successAt = s.now; r.retryAt = null; event(s, 'client-success', 'client', 'client', '客户端获得成功，取消未来重试；已排队和运行的尝试仍然存在。', r.id) }
  }
  for (const r of s.roots) if ((r.phase === 'waiting' || r.phase === 'active') && r.deadline <= s.now) { r.phase = 'expired'; r.retryAt = null; event(s, 'deadline', 'client', 'client', `${r.id} 超过从原始到达计算的截止期；停止新尝试，不撤回已接纳工作。`, r.id) }
  for (const a of s.attempts) if ((a.status === 'queued' || a.status === 'running') && !a.timeoutObserved && a.timeoutAt <= s.now && rootFor(s, a).phase === 'active') {
    a.timeoutObserved = true; event(s, 'timeout', 'client', 'client', `${a.id} 等待 200 ms 后超时，服务端工作仍为 ${a.status}。`, a.rootId); retry(s, c, rootFor(s, a))
  }
  for (const r of s.roots) if (r.phase === 'scheduled' && r.arrival <= s.now) { r.phase = 'waiting'; r.offered = true; event(s, 'offered', 'source', 'client', `${r.id} 原始请求到达；即使等待客户端发送额度，也从现在计算总截止期。`, r.id) }
  pump(s, c)
  for (const r of s.roots) if (r.phase === 'active' && r.retryAt !== null && r.retryAt <= s.now) send(s, c, r)
  for (const r of s.roots) if (r.phase === 'waiting' && (!c.senderLimit || s.roots.filter((r) => r.phase === 'active').length < c.senderLimit)) { r.phase = 'active'; event(s, 'client-admitted', 'client', 'client', '获得客户端发送额度；额度按未获知结果的原始请求计，不是服务端执行槽。', r.id); send(s, c, r) }
  sample(s)
}
function advanceTo(s: State, c: Config, target: number) {
  let timer: number | null; let steps = 0
  while ((timer = nextTimer(s)) !== null && timer <= target) {
    if (timer < s.now || ++steps > 2000) throw new Error('计时器未取得进展，无法作为实验结果。')
    s.now = timer; tick(s, c)
  }
  s.now = target; sample(s)
}
function addRoot(s: State, c: Config, arrival: number, origin: Root['origin']) {
  if (s.roots.length >= 20) throw new Error('最多 20 个原始请求。')
  s.roots.push({ id: `root-${s.roots.length + 1}`, origin, arrival, deadline: arrival + deadlineDuration(c.profile), phase: 'scheduled', offered: false, retryAt: null, successAt: null, firstWorkAt: null })
}
function apply(s: State, c: Config, command: Command) {
  switch (command.type) {
    case 'start':
      if (s.started) throw new Error('本次实验已经启动过负载。')
      if (s.roots.length + 12 > 20) throw new Error('没有足够的原始请求预算启动完整负载。')
      s.started = true
      for (const offset of profileArrivals(c.profile)) addRoot(s, c, s.now + offset, 'workload')
      event(s, 'traffic-started', 'source', 'source', '安排 12 个固定原始请求；策略不会改变它们的到达时刻与总截止期。')
      advanceTo(s, c, s.now); return
    case 'stop-traffic':
      if (!s.started || s.stopped) throw new Error('当前没有可停止的新流量。')
      s.stopped = true
      for (const r of s.roots) if (r.phase === 'scheduled' && r.origin === 'workload') r.phase = 'cancelled'
      event(s, 'traffic-stopped', 'source', 'source', '停止尚未到达的新请求；已到达请求的重试与服务端排空继续。减少需求不能计为挑战通过。'); sample(s); return
    case 'submit': addRoot(s, c, s.now, 'manual'); advanceTo(s, c, s.now); return
    case 'slow': s.serviceMs = 500; event(s, 'slow', 'server', 'server', '之后开始的处理耗时 500 ms；正在运行的工作不变。'); sample(s); return
    case 'recover': s.serviceMs = 100; event(s, 'recovered', 'server', 'server', '之后开始的处理恢复为 100 ms；正在运行的慢工作不会瞬间完成。'); sample(s); return
    case 'advance':
      if (s.now + command.ms > MAX_TIME) throw new Error('超过 10,000 ms 实验时间范围。')
      advanceTo(s, c, s.now + command.ms); event(s, 'clock', 'client', 'client', `推进到 ${s.now} ms。`); return
  }
}
export function runModel(value: Config, commands: readonly Command[]): State {
  const c = parseConfig(value)
  if (!Array.isArray(commands) || commands.length > MAX_COMMANDS) throw new Error('过载命令预算超限。')
  const s: State = { now: 0, started: false, stopped: false, serviceMs: 100, roots: [], attempts: [], queue: [], events: [], samples: [], peakQueue: 0 }
  Array.from(commands).forEach((raw, index) => { try { apply(s, c, parseCommand(raw)) } catch (e) { throw new Error(`第 ${index + 1} 步：${e instanceof Error ? e.message : '操作无效。'}`) } })
  return s
}
export function metrics(s: State) {
  const completed = s.attempts.filter((a) => a.status === 'completed')
  return {
    offered: s.roots.filter((r) => r.offered).length, waiting: s.roots.filter((r) => r.phase === 'waiting').length,
    successes: s.roots.filter((r) => r.phase === 'success').length, deadlines: s.roots.filter((r) => r.phase === 'expired').length,
    attempts: s.attempts.length, retries: s.attempts.filter((a) => a.number > 1).length, rejected: s.attempts.filter((a) => a.status === 'rejected').length,
    expired: s.attempts.filter((a) => a.status === 'expired').length, queued: s.queue.length, running: s.attempts.filter((a) => a.status === 'running').length,
    completed: completed.length, repeated: completed.length - new Set(completed.map((a) => a.rootId)).size,
    timeouts: s.attempts.filter((a) => a.timeoutObserved).length,
    busyMs: s.attempts.reduce((total, a) => total + (a.startedAt === null ? 0 : Math.max(0, Math.min(s.now, a.finishAt!) - a.startedAt)), 0),
    peakQueue: s.peakQueue,
  }
}
