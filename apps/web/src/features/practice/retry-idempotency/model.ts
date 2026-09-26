export const strategies = ['no-retry', 'retry', 'idempotent'] as const
export type Strategy = typeof strategies[number]
export const strategyLabels: Record<Strategy, string> = { 'no-retry': '不重试', retry: '普通重试', idempotent: '重试 + 原子幂等' }
export interface Payload { videoId: string; format: '720p' | '1080p' }
export interface RetryConfig {
  modelVersion: 'request-retry-v1'
  strategy: Strategy
  callerId: string
  key: string
  payload: Payload
  timeoutMs: number
  retryDelayMs: number
  maxAttempts: number
  retentionMs: number
}
export type Command =
  | { type: 'submit' }
  | { type: 'retry'; key: string; payload: Payload }
  | { type: 'deliver-request' | 'drop-request' | 'commit'; requestId: string }
  | { type: 'deliver-response' | 'drop-response'; responseId: string }
  | { type: 'advance'; ms: number }
  | { type: 'crash' | 'restart' }
export interface Request {
  id: string; number: number; callerId: string; key: string; payload: Payload; sentAt: number; deadline: number
  location: 'network' | 'server' | 'committed' | 'dropped' | 'lost-on-crash'
  wait: 'waiting' | 'timed-out' | 'responded'
}
export interface Response {
  id: string; requestId: string; outcome: 'created' | 'replayed' | 'conflict'
  taskId: string | null; sentAt: number; location: 'network' | 'delivered' | 'dropped'
}
export interface Task { id: string; callerId: string; payload: Payload; createdAt: number; requestId: string }
export interface DedupeRecord { scope: string; callerId: string; key: string; payload: Payload; taskId: string; committedAt: number; expiresAt: number }
export interface StableStore { tasks: Task[]; records: DedupeRecord[] }
export interface ProtocolEvent {
  index: number; at: number; kind: string; from: 'client' | 'network' | 'service' | 'store'; to: 'client' | 'network' | 'service' | 'store'
  requestId: string | null; detail: string
}
export interface ProtocolState {
  now: number; serverOnline: boolean; requests: Request[]; responses: Response[]; store: StableStore
  knownTaskIds: string[]; rejectedRequestIds: string[]; retryAt: number | null; events: ProtocolEvent[]
}
export const MAX_COMMANDS = 100
export const MAX_TIME_MS = 120000
export const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
export const defaultConfig = (): RetryConfig => ({ modelVersion: 'request-retry-v1', strategy: 'retry', callerId: 'client-a', key: 'submit-video-1', payload: { videoId: 'video-1', format: '720p' }, timeoutMs: 500, retryDelayMs: 100, maxAttempts: 3, retentionMs: 10000 })
const textId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,60}$/.test(value)
export function parsePayload(value: unknown): Payload {
  const payload = value as Payload | null
  if (!payload || !textId(payload.videoId) || !['720p', '1080p'].includes(payload.format)) throw new Error('视频参数无效。')
  return { videoId: payload.videoId, format: payload.format }
}
export function parseConfig(value: unknown): RetryConfig {
  const config = value as RetryConfig | null
  if (!config || config.modelVersion !== 'request-retry-v1') throw new Error('未知请求模型版本。')
  if (!strategies.includes(config.strategy) || !textId(config.callerId) || !textId(config.key)) throw new Error('策略、调用方或幂等键无效。')
  if (![100, 500, 1000].includes(config.timeoutMs) || ![0, 100, 500].includes(config.retryDelayMs) || ![1, 2, 3, 5].includes(config.maxAttempts) || ![200, 2000, 10000, 60000].includes(config.retentionMs)) throw new Error('实验参数超出范围。')
  return { modelVersion: config.modelVersion, strategy: config.strategy, callerId: config.callerId, key: config.key, payload: parsePayload(config.payload), timeoutMs: config.timeoutMs, retryDelayMs: config.retryDelayMs, maxAttempts: config.maxAttempts, retentionMs: config.retentionMs }
}
export function parseCommand(value: unknown): Command {
  if (!value || typeof value !== 'object') throw new Error('操作无效。')
  const command = value as Command
  switch (command.type) {
    case 'submit': case 'crash': case 'restart': return { type: command.type }
    case 'retry':
      if (!textId(command.key)) throw new Error('幂等键无效。')
      return { type: 'retry', key: command.key, payload: parsePayload(command.payload) }
    case 'deliver-request': case 'drop-request': case 'commit':
      if (!textId(command.requestId)) throw new Error('请求 ID 无效。')
      return { type: command.type, requestId: command.requestId }
    case 'deliver-response': case 'drop-response':
      if (!textId(command.responseId)) throw new Error('响应 ID 无效。')
      return { type: command.type, responseId: command.responseId }
    case 'advance':
      if (!Number.isInteger(command.ms) || command.ms < 1 || command.ms > MAX_TIME_MS) throw new Error('推进时间无效。')
      return { type: 'advance', ms: command.ms }
    default: throw new Error('未知操作。')
  }
}
export const initialState = (): ProtocolState => ({ now: 0, serverOnline: true, requests: [], responses: [], store: { tasks: [], records: [] }, knownTaskIds: [], rejectedRequestIds: [], retryAt: null, events: [] })
export const attemptLimit = (config: RetryConfig) => config.strategy === 'no-retry' ? 1 : config.maxAttempts
export const clientSettled = (state: ProtocolState) => state.knownTaskIds.length > 0 || state.rejectedRequestIds.length > 0
export function clientStatus(state: ProtocolState): 'idle' | 'waiting' | 'unknown' | 'success' | 'rejected' {
  if (state.knownTaskIds.length) return 'success'
  if (state.rejectedRequestIds.length) return 'rejected'
  if (!state.requests.length) return 'idle'
  return state.retryAt !== null || state.requests.some((request) => request.wait === 'waiting') ? 'waiting' : 'unknown'
}
export function nextTimer(state: ProtocolState): number | null {
  const times = state.requests.filter((request) => request.wait === 'waiting').map((request) => request.deadline)
  if (state.retryAt !== null) times.push(state.retryAt)
  return times.length ? Math.min(...times) : null
}
export const pendingCount = (state: ProtocolState) => state.requests.filter((request) => request.location === 'network' || request.location === 'server').length + state.responses.filter((response) => response.location === 'network').length
export const isSettled = (state: ProtocolState) => state.requests.length > 0 && pendingCount(state) === 0 && nextTimer(state) === null

/** One indivisible modeled database transition: check identity, create task,
 * and store its result together. It is not a simulation of a SQL engine. */
export function atomicCreate(store: StableStore, request: Pick<Request, 'id' | 'callerId' | 'key' | 'payload'>, now: number, idempotent: boolean, retentionMs: number) {
  const next = structuredClone(store)
  const payload = parsePayload(request.payload)
  const expired = next.records.filter((record) => record.expiresAt <= now)
  next.records = next.records.filter((record) => record.expiresAt > now)
  const scope = JSON.stringify([request.callerId, 'create-transcode', request.key])
  const existing = idempotent ? next.records.find((record) => record.scope === scope) : undefined
  if (existing) return { store: next, expired, outcome: same(existing.payload, payload) ? 'replayed' as const : 'conflict' as const, taskId: same(existing.payload, payload) ? existing.taskId : null }
  const taskId = `task-${next.tasks.length + 1}`
  next.tasks.push({ id: taskId, callerId: request.callerId, payload, createdAt: now, requestId: request.id })
  if (idempotent) next.records.push({ scope, callerId: request.callerId, key: request.key, payload, taskId, committedAt: now, expiresAt: now + retentionMs })
  return { store: next, expired, outcome: 'created' as const, taskId }
}

function event(state: ProtocolState, kind: string, from: ProtocolEvent['from'], to: ProtocolEvent['to'], detail: string, requestId: string | null = null) {
  state.events.push({ index: state.events.length + 1, at: state.now, kind, from, to, detail, requestId })
}
function send(state: ProtocolState, config: RetryConfig, key: string, payload: Payload, reason: string) {
  if (state.requests.length >= attemptLimit(config)) throw new Error('尝试预算已耗尽。')
  if (clientSettled(state)) throw new Error('客户端已收到终态结果，不能再为这次意图发送新尝试。')
  const number = state.requests.length + 1
  const request: Request = { id: `request-${number}`, number, callerId: config.callerId, key, payload: structuredClone(payload), sentAt: state.now, deadline: state.now + config.timeoutMs, location: 'network', wait: 'waiting' }
  state.requests.push(request)
  state.retryAt = null
  event(state, 'request-sent', 'client', 'network', `${reason}；${request.id} 已发送，等待截止时刻 ${request.deadline} ms。`, request.id)
}
function advance(state: ProtocolState, config: RetryConfig, ms: number) {
  const target = state.now + ms
  if (target > MAX_TIME_MS) throw new Error('已达到本实验的逻辑时间上限。')
  let next: number | null
  while ((next = nextTimer(state)) !== null && next <= target) {
    state.now = next
    // At a time boundary all due timeouts run before a due retry. Manual
    // deliveries then occur after advance returns, in explicit command order.
    for (const request of state.requests.filter((request) => request.wait === 'waiting' && request.deadline <= state.now)) {
      request.wait = 'timed-out'
      event(state, 'timeout', 'client', 'client', `${request.id} 等待超时：客户端不知道服务端是否已创建任务。超时没有撤回消息。`, request.id)
      if (request.number === state.requests.length && !clientSettled(state)) {
        if (state.requests.length < attemptLimit(config)) {
          state.retryAt = state.now + config.retryDelayMs
          event(state, 'retry-scheduled', 'client', 'client', `预算内重试将在 ${state.retryAt} ms 发送。`, request.id)
        } else event(state, 'budget-exhausted', 'client', 'client', '不再发送新尝试；结果保持未知，已有消息仍可能继续产生效果。', request.id)
      }
    }
    if (state.retryAt !== null && state.retryAt <= state.now) {
      state.retryAt = null
      if (!clientSettled(state)) send(state, config, config.key, config.payload, '计时器触发的重试')
    }
  }
  state.now = target
  event(state, 'clock-advanced', 'client', 'client', `逻辑时间推进到 ${target} ms。`)
}

function apply(state: ProtocolState, config: RetryConfig, command: Command) {
  switch (command.type) {
    case 'submit':
      if (state.requests.length) throw new Error('本次实验只有一个原始提交意图；请使用重试或开始新实验。')
      send(state, config, config.key, config.payload, '第一次提交')
      return
    case 'retry':
      if (!state.requests.length || config.strategy === 'no-retry') throw new Error('当前不能手动重试。')
      send(state, config, command.key, command.payload, '手动重试同一意图')
      return
    case 'advance': advance(state, config, command.ms); return
    case 'deliver-request': case 'drop-request': case 'commit': {
      const request = state.requests.find((item) => item.id === command.requestId)
      if (!request) throw new Error('请求不存在。')
      if (command.type === 'commit') {
        if (!state.serverOnline || request.location !== 'server') throw new Error('请求尚未递送到在线服务。')
        const transaction = atomicCreate(state.store, request, state.now, config.strategy === 'idempotent', config.retentionMs)
        state.store = transaction.store
        for (const record of transaction.expired) event(state, 'dedupe-expired', 'store', 'store', `去重记录 ${record.key} 已到期并清理；任务 ${record.taskId} 仍然存在。`, request.id)
        request.location = 'committed'
        event(state, `transaction-${transaction.outcome}`, 'service', 'store', transaction.outcome === 'created' ? `原子提交：创建 ${transaction.taskId}${config.strategy === 'idempotent' ? '，同时保存幂等键、参数与返回结果' : '；当前未启用去重'}。` : transaction.outcome === 'replayed' ? `同一作用域、相同键和参数：重放 ${transaction.taskId}，未新建任务，保留期不续期。` : '同键不同参数：拒绝冲突，未创建任务。', request.id)
        const response: Response = { id: `response-${request.number}`, requestId: request.id, outcome: transaction.outcome, taskId: transaction.taskId, sentAt: state.now, location: 'network' }
        state.responses.push(response)
        event(state, 'response-sent', 'service', 'network', `${response.id} 已发送，结果为 ${response.outcome}${response.taskId ? ` ${response.taskId}` : ''}。`, request.id)
      } else {
        if (request.location !== 'network') throw new Error('只有在网络中的请求可以递送或丢弃。')
        if (command.type === 'deliver-request') {
          if (!state.serverOnline) throw new Error('服务离线；可以保留或丢弃消息，重启后再递送。')
          request.location = 'server'
          event(state, 'request-delivered', 'network', 'service', `${request.id} 到达服务，尚未提交。`, request.id)
        } else {
          request.location = 'dropped'
          event(state, 'request-dropped', 'network', 'network', `${request.id} 在到达服务前丢失；客户端只会通过超时观察到没有结果。`, request.id)
        }
      }
      return
    }
    case 'deliver-response': case 'drop-response': {
      const response = state.responses.find((item) => item.id === command.responseId)
      if (!response || response.location !== 'network') throw new Error('响应不存在或已经离开网络。')
      const request = state.requests.find((item) => item.id === response.requestId)!
      if (command.type === 'drop-response') {
        response.location = 'dropped'
        event(state, 'response-dropped', 'network', 'network', `${response.id} 丢失；服务端已发生的效果没有回滚。`, request.id)
      } else {
        response.location = 'delivered'
        request.wait = 'responded'
        if (response.taskId && !state.knownTaskIds.includes(response.taskId)) state.knownTaskIds.push(response.taskId)
        if (response.outcome === 'conflict') state.rejectedRequestIds.push(request.id)
        state.retryAt = null
        event(state, 'response-delivered', 'network', 'client', `客户端收到 ${response.outcome}${response.taskId ? ` ${response.taskId}` : ''}；停止新的自动重试，旧在途消息仍需处理。`, request.id)
      }
      return
    }
    case 'crash':
      if (!state.serverOnline) throw new Error('服务已经离线。')
      state.serverOnline = false
      for (const request of state.requests.filter((request) => request.location === 'server')) request.location = 'lost-on-crash'
      event(state, 'server-crashed', 'service', 'service', '服务进程崩溃，未提交收件箱丢失；已提交任务与幂等记录保留，已经发出的网络消息不撤回。')
      return
    case 'restart':
      if (state.serverOnline) throw new Error('服务已经在线。')
      state.serverOnline = true
      event(state, 'server-restarted', 'store', 'service', '服务恢复，继续使用保留的任务表与幂等记录。')
      return
  }
}

export function runProtocol(value: RetryConfig, commands: readonly Command[]): ProtocolState {
  const config = parseConfig(value)
  if (!Array.isArray(commands) || commands.length > MAX_COMMANDS) throw new Error('操作记录超出本实验范围。')
  const state = initialState()
  Array.from(commands).forEach((raw, index) => {
    try { apply(state, config, parseCommand(raw)) } catch (cause) { throw new Error(`第 ${index + 1} 步：${cause instanceof Error ? cause.message : '无法执行。'}`) }
  })
  return state
}
