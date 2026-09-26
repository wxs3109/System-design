import type { TimelineEvent } from '../protocol/events'
export type WorkerId = 'A' | 'B'
export interface Config { modelVersion: 'coordination-v1'; intervalMs: number; timeoutMs: number; leaseMs: number; fencing: boolean }
export interface Lease { owner: WorkerId; token: number; expiresAt: number }
export interface Worker { id: WorkerId; status: 'running' | 'paused' | 'crashed'; connected: boolean; epoch: number; sequence: number; nextHeartbeatAt: number; localLease: Lease | null }
export interface Observation { worker: WorkerId; status: 'unknown' | 'healthy' | 'suspected'; epoch: number; sequence: number; lastReceivedAt: number | null; timeoutAt: number | null }
export interface Heartbeat { id: string; worker: WorkerId; epoch: number; sequence: number; sentAt: number; status: 'network' | 'delivered' | 'dropped' | 'ignored' }
export interface Write { id: string; worker: WorkerId; token: number; value: string; sentAt: number; status: 'network' | 'accepted' | 'rejected' | 'dropped' }
export interface State { now: number; workers: Worker[]; observations: Observation[]; heartbeats: Heartbeat[]; writes: Write[]; lease: Lease | null; nextToken: number; resource: { value: string; highestToken: number }; events: TimelineEvent[]; budgetHit: boolean }
export type Command = { type: 'advance'; ms: number } | { type: 'send-heartbeat' | 'pause' | 'resume' | 'crash' | 'restart' | 'partition' | 'reconnect' | 'acquire' | 'renew'; worker: WorkerId } | { type: 'deliver-heartbeat' | 'drop-heartbeat'; heartbeatId: string } | { type: 'prepare-write'; worker: WorkerId; value: string } | { type: 'deliver-write' | 'drop-write'; writeId: string }
export const defaultConfig = (): Config => ({ modelVersion: 'coordination-v1', intervalMs: 500, timeoutMs: 1000, leaseMs: 1500, fencing: false })
export const MAX_TIME = 10000
export const MAX_COMMANDS = 100
export const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
export function parseConfig(value: unknown): Config {
  const c = value as Config | null
  if (!c || c.modelVersion !== 'coordination-v1' || ![100, 500].includes(c.intervalMs) || ![300, 1000, 2000].includes(c.timeoutMs) || ![500, 1500, 5000].includes(c.leaseMs) || typeof c.fencing !== 'boolean') throw new Error('协调模型版本或参数无效。')
  return { modelVersion: c.modelVersion, intervalMs: c.intervalMs, timeoutMs: c.timeoutMs, leaseMs: c.leaseMs, fencing: c.fencing }
}
export function parseCommand(value: unknown): Command {
  if (!value || typeof value !== 'object') throw new Error('协调操作无效。')
  const c = value as Command
  if (c.type === 'advance') { if (!Number.isInteger(c.ms) || c.ms < 1 || c.ms > MAX_TIME) throw new Error('推进时间无效。'); return { type: c.type, ms: c.ms } }
  if (c.type === 'deliver-heartbeat' || c.type === 'drop-heartbeat') { if (!/^heartbeat-\d+$/.test(c.heartbeatId)) throw new Error('心跳 ID 无效。'); return { type: c.type, heartbeatId: c.heartbeatId } }
  if (c.type === 'deliver-write' || c.type === 'drop-write') { if (!/^write-\d+$/.test(c.writeId)) throw new Error('写入 ID 无效。'); return { type: c.type, writeId: c.writeId } }
  if (!('worker' in c) || !['A', 'B'].includes(c.worker)) throw new Error('Worker ID 无效。')
  if (c.type === 'prepare-write') { if (typeof c.value !== 'string' || !/^[a-zA-Z0-9_-]{1,40}$/.test(c.value)) throw new Error('结果值需为 1–40 个字母、数字、下划线或短横线。'); return { type: c.type, worker: c.worker, value: c.value } }
  if (!['send-heartbeat', 'pause', 'resume', 'crash', 'restart', 'partition', 'reconnect', 'acquire', 'renew'].includes(c.type)) throw new Error('未知协调操作。')
  return { type: c.type, worker: c.worker }
}
function initial(c: Config): State {
  return { now: 0, workers: (['A', 'B'] as const).map((id) => ({ id, status: 'running', connected: true, epoch: 1, sequence: 0, nextHeartbeatAt: c.intervalMs, localLease: null })), observations: (['A', 'B'] as const).map((worker) => ({ worker, status: 'unknown', epoch: 0, sequence: 0, lastReceivedAt: null, timeoutAt: c.timeoutMs })), heartbeats: [], writes: [], lease: null, nextToken: 0, resource: { value: 'initial', highestToken: 0 }, events: [], budgetHit: false }
}
function event(s: State, kind: string, from: string, to: string, detail: string, subject: string | null = null) { s.events.push({ index: s.events.length + 1, at: s.now, kind, from, to, subject, detail }) }
function heartbeat(s: State, worker: Worker) {
  if (worker.status !== 'running') throw new Error('只有正在运行的 Worker 能发送新心跳。')
  if (s.heartbeats.length >= 200) { if (!s.budgetHit) event(s, 'budget', 'observer', 'observer', '已达到心跳样本预算；后续缺失不可作为真实故障的实验结论。'); s.budgetHit = true; return }
  const message: Heartbeat = { id: `heartbeat-${s.heartbeats.length + 1}`, worker: worker.id, epoch: worker.epoch, sequence: ++worker.sequence, sentAt: s.now, status: worker.connected ? 'network' : 'dropped' }
  s.heartbeats.push(message)
  event(s, worker.connected ? 'heartbeat-sent' : 'heartbeat-partitioned', worker.id, 'observer', worker.connected ? `${message.id} 已发送，观察者尚未收到。` : `${message.id} 因网络分区丢失；Worker 仍在运行。`, message.id)
}
export function nextTimer(s: State): number | null { const values = [...s.workers.map((w) => w.nextHeartbeatAt), ...s.observations.flatMap((o) => o.timeoutAt === null ? [] : [o.timeoutAt]), ...(s.lease && s.lease.expiresAt > s.now ? [s.lease.expiresAt] : [])]; return values.length ? Math.min(...values) : null }
function apply(s: State, c: Config, command: Command) {
  if (command.type === 'advance') {
    const target = s.now + command.ms
    if (target > MAX_TIME) throw new Error('超过协调实验时间范围。')
    let timer: number | null
    while ((timer = nextTimer(s)) !== null && timer <= target) {
      s.now = timer
      if (s.lease?.expiresAt === s.now) event(s, 'lease-expired', 'authority', 'authority', `token ${s.lease.token} 的租约到期；旧进程和已发送写入没有被强制终止。`, s.lease.owner)
      for (const observation of s.observations) if (observation.timeoutAt !== null && observation.timeoutAt <= s.now) {
        observation.status = 'suspected'; observation.timeoutAt = null
        event(s, 'suspect', 'observer', 'observer', `观察者怀疑 ${observation.worker} 失联；判断仅来自已收到心跳和本地超时，不证明进程死亡。`, observation.worker)
      }
      for (const worker of s.workers) if (worker.nextHeartbeatAt <= s.now) { worker.nextHeartbeatAt = s.now + c.intervalMs; if (worker.status === 'running') heartbeat(s, worker) }
    }
    s.now = target; event(s, 'clock', 'observer', 'observer', `推进到 ${target} ms；到期判断先于随后手动递送的消息。`); return
  }
  if (command.type === 'deliver-heartbeat' || command.type === 'drop-heartbeat') {
    const message = s.heartbeats.find((message) => message.id === command.heartbeatId)
    if (!message || message.status !== 'network') throw new Error('心跳不在网络中。')
    if (command.type === 'drop-heartbeat') { message.status = 'dropped'; event(s, 'heartbeat-dropped', message.worker, 'observer', '心跳在网络中丢失。', message.id); return }
    const worker = s.workers.find((w) => w.id === message.worker)!
    if (!worker.connected) throw new Error('链路仍分区，无法递送。')
    const observation = s.observations.find((o) => o.worker === message.worker)!
    if (message.epoch < observation.epoch || message.epoch === observation.epoch && message.sequence <= observation.sequence) { message.status = 'ignored'; event(s, 'heartbeat-stale', message.worker, 'observer', '较旧进程世代或序号的心跳被忽略，不刷新超时。', message.id); return }
    message.status = 'delivered'; observation.status = 'healthy'; observation.epoch = message.epoch; observation.sequence = message.sequence; observation.lastReceivedAt = s.now; observation.timeoutAt = s.now + c.timeoutMs
    event(s, 'heartbeat-received', message.worker, 'observer', `收到 ${message.id}；最近接收时刻为 ${s.now} ms。这只能证明它曾发出该消息。`, message.id); return
  }
  if (command.type === 'deliver-write' || command.type === 'drop-write') {
    const write = s.writes.find((write) => write.id === command.writeId)
    if (!write || write.status !== 'network') throw new Error('写入不在网络中。')
    if (command.type === 'drop-write') { write.status = 'dropped'; event(s, 'write-dropped', write.worker, 'resource', '写入消息被丢弃。', write.id); return }
    if (!s.workers.find((worker) => worker.id === write.worker)!.connected) throw new Error('写入链路仍分区。')
    const stale = write.token < s.resource.highestToken
    if (c.fencing && stale) { write.status = 'rejected'; event(s, 'write-rejected', write.worker, 'resource', `拒绝旧 token ${write.token}，资源已接受过 token ${s.resource.highestToken}；值保持 ${s.resource.value}。`, write.id) }
    else { write.status = 'accepted'; s.resource.highestToken = Math.max(s.resource.highestToken, write.token); s.resource.value = write.value; event(s, stale ? 'stale-write-accepted' : 'write-accepted', write.worker, 'resource', `${stale ? '旧世代写入仍被接纳，覆盖了较新结果' : '接受写入'}：${write.value}，token ${write.token}。`, write.id) }
    return
  }
  if (!('worker' in command)) throw new Error('未知协调操作。')
  const worker = s.workers.find((worker) => worker.id === command.worker)!
  switch (command.type) {
    case 'send-heartbeat': heartbeat(s, worker); return
    case 'pause': if (worker.status !== 'running') throw new Error('Worker 不在运行状态。'); worker.status = 'paused'; event(s, 'paused', worker.id, worker.id, '进程暂停，内存与已准备的写入保留。', worker.id); return
    case 'resume': if (worker.status !== 'paused') throw new Error('Worker 未暂停。'); worker.status = 'running'; worker.nextHeartbeatAt = s.now + c.intervalMs; event(s, 'resumed', worker.id, worker.id, '进程恢复，旧本地租约信息仍在内存中。', worker.id); return
    case 'crash': if (worker.status === 'crashed') throw new Error('Worker 已崩溃。'); worker.status = 'crashed'; worker.localLease = null; event(s, 'crashed', worker.id, worker.id, '进程崩溃，清空本地租约；已经发出的消息不撤回。', worker.id); return
    case 'restart': if (worker.status !== 'crashed') throw new Error('Worker 尚未崩溃。'); worker.status = 'running'; worker.epoch++; worker.sequence = 0; worker.nextHeartbeatAt = s.now + c.intervalMs; event(s, 'restarted', worker.id, worker.id, `重启为进程世代 ${worker.epoch}，需要重新获得持有权。`, worker.id); return
    case 'partition': worker.connected = false; event(s, 'partition', worker.id, 'observer', '链路分区。不能由此推断进程停止。', worker.id); return
    case 'reconnect': worker.connected = true; event(s, 'reconnect', worker.id, 'observer', '链路恢复；之后可递送仍在网络中的消息。', worker.id); return
    case 'acquire': case 'renew': {
      if (worker.status !== 'running' || !worker.connected) throw new Error('运行中的 Worker 需要连通授予者才能申请或续租。')
      if (command.type === 'renew') {
        if (!s.lease || s.lease.owner !== worker.id || worker.localLease?.token !== s.lease.token || s.lease.expiresAt <= s.now) throw new Error('不能续租已过期或已被替换的持有权。')
        s.lease.expiresAt = s.now + c.leaseMs; worker.localLease = { ...s.lease }
        event(s, 'renewed', 'authority', worker.id, `续租 token ${s.lease.token} 至 ${s.lease.expiresAt} ms。`, worker.id)
      } else if (s.lease && s.lease.expiresAt > s.now) event(s, 'lease-denied', 'authority', worker.id, `租约仍由 ${s.lease.owner} 持有至 ${s.lease.expiresAt} ms，本次申请拒绝。`, worker.id)
      else { s.lease = { owner: worker.id, token: ++s.nextToken, expiresAt: s.now + c.leaseMs }; worker.localLease = { ...s.lease }; event(s, 'lease-granted', 'authority', worker.id, `授予 ${worker.id} token ${s.lease.token}，有效至 ${s.lease.expiresAt} ms。`, worker.id) }
      return
    }
    case 'prepare-write':
      if (worker.status !== 'running' || !worker.connected || !worker.localLease) throw new Error('准备写入需要运行、连通且已获得租约的 Worker。')
      if (worker.localLease.expiresAt <= s.now) { event(s, 'local-expired', worker.id, worker.id, '本地检查发现租约过期，未发送新写入；先前已发送的消息仍可能到达。', worker.id); return }
      if (s.writes.length >= 20) throw new Error('已达到写入消息预算。')
      const write: Write = { id: `write-${s.writes.length + 1}`, worker: worker.id, token: worker.localLease.token, value: command.value, sentAt: s.now, status: 'network' }
      s.writes.push(write); event(s, 'write-prepared', worker.id, 'resource', `本地检查通过并发送 ${write.id}，携带 token ${write.token}；实际资源写入尚未发生。`, write.id); return
  }
}
export function runModel(value: Config, commands: readonly Command[]): State {
  const config = parseConfig(value)
  if (!Array.isArray(commands) || commands.length > MAX_COMMANDS) throw new Error('协调实验操作预算超限。')
  const state = initial(config)
  Array.from(commands).forEach((raw, index) => { try { apply(state, config, parseCommand(raw)) } catch (cause) { throw new Error(`第 ${index + 1} 步：${cause instanceof Error ? cause.message : '操作无效。'}`) } })
  return state
}
