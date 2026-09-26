import type { TimelineEvent } from '../protocol/events'
export type Operation = 'reserve' | 'transcode' | 'publish' | 'cleanup' | 'release'
export const operationLabels: Record<Operation, string> = { reserve: '预留配额', transcode: '生成转码产物', publish: '发布视频', cleanup: '清理产物', release: '释放配额' }
export interface Config { modelVersion: 'saga-v1'; recovery: 'stop' | 'saga'; idempotent: boolean; timeoutMs: number; maxAttempts: number }
export interface Packet { id: string; operation: Operation; operationId: string; epoch: number; round: number; deadline: number; expired: boolean; status: 'network' | 'processed' | 'dropped'; response: 'none' | 'network' | 'delivered' | 'recorded' | 'dropped' | 'ignored'; outcome: 'ok' | 'rejected' | 'unavailable' | null; replayed: boolean }
export interface State {
  now: number; online: boolean; epoch: number; phase: 'idle' | 'forward' | 'compensating' | 'complete' | 'compensated' | 'failed' | 'attention'; resumePhase: 'forward' | 'compensating'; round: number
  journal: Partial<Record<Operation, 'ok' | 'rejected'>>; packets: Packet[]; effects: { operation: Operation; packetId: string }[]; dedupe: Partial<Record<Operation, 'ok' | 'rejected'>>; blocked: Operation[]
  resource: { reserved: number; released: number; artifacts: number; published: boolean; transcodeWork: number }; events: TimelineEvent[]
}
export type Command = { type: 'start' | 'send' | 'crash' | 'restart' | 'resume-review' } | { type: 'advance'; ms: number } | { type: 'deliver-request' | 'drop-request' | 'deliver-response' | 'drop-response' | 'checkpoint'; packetId: string } | { type: 'block' | 'repair'; operation: Operation }
export const defaultConfig = (): Config => ({ modelVersion: 'saga-v1', recovery: 'stop', idempotent: true, timeoutMs: 500, maxAttempts: 3 })
export const MAX_COMMANDS = 150
export const MAX_TIME = 10000
export const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
export function parseConfig(value: unknown): Config { const c = value as Config | null; if (!c || c.modelVersion !== 'saga-v1' || !['stop', 'saga'].includes(c.recovery) || typeof c.idempotent !== 'boolean' || ![100, 500, 1000].includes(c.timeoutMs) || ![2, 3, 5].includes(c.maxAttempts)) throw new Error('Saga 配置或模型版本无效。'); return { modelVersion: c.modelVersion, recovery: c.recovery, idempotent: c.idempotent, timeoutMs: c.timeoutMs, maxAttempts: c.maxAttempts } }
export function parseCommand(value: unknown): Command {
  const c = value as Command | null
  if (!c || typeof c !== 'object') throw new Error('Saga 操作无效。')
  if (c.type === 'advance') { if (!Number.isInteger(c.ms) || c.ms < 1 || c.ms > MAX_TIME) throw new Error('推进时间无效。'); return { type: c.type, ms: c.ms } }
  if (['deliver-request', 'drop-request', 'deliver-response', 'drop-response', 'checkpoint'].includes(c.type)) { if (!('packetId' in c) || typeof c.packetId !== 'string' || !/^call-\d+$/.test(c.packetId)) throw new Error('调用 ID 无效。'); return { type: c.type, packetId: c.packetId } as Command }
  if (c.type === 'block' || c.type === 'repair') { if (!Object.hasOwn(operationLabels, c.operation)) throw new Error('业务步骤无效。'); return { type: c.type, operation: c.operation } }
  if (!['start', 'send', 'crash', 'restart', 'resume-review'].includes(c.type)) throw new Error('未知 Saga 操作。')
  return { type: c.type } as Command
}
const initial = (): State => ({ now: 0, online: true, epoch: 1, phase: 'idle', resumePhase: 'forward', round: 0, journal: {}, packets: [], effects: [], dedupe: {}, blocked: [], resource: { reserved: 0, released: 0, artifacts: 0, published: false, transcodeWork: 0 }, events: [] })
function event(s: State, kind: string, from: string, to: string, detail: string, subject: string | null = null) { s.events.push({ index: s.events.length + 1, at: s.now, kind, from, to, detail, subject }) }
export function nextOperation(s: State): Operation | null {
  const phase = s.phase === 'attention' ? s.resumePhase : s.phase
  if (phase === 'forward') return (['reserve', 'transcode', 'publish'] as const).find((op) => s.journal[op] !== 'ok') ?? null
  if (phase === 'compensating') { if (s.journal.transcode === 'ok' && s.journal.cleanup !== 'ok') return 'cleanup'; if (s.journal.reserve === 'ok' && s.journal.release !== 'ok') return 'release' }
  return null
}
function settle(s: State) { if (s.phase === 'forward' && nextOperation(s) === null) { s.phase = 'complete'; event(s, 'completed', 'coordinator', 'journal', '正向步骤都已记录成功，发布流程完成。') } else if (s.phase === 'compensating' && nextOperation(s) === null) { s.phase = 'compensated'; event(s, 'compensated', 'coordinator', 'journal', '所需补偿都已记录成功；这不是视频发布成功，已发生的转码工作不会撤回。') } }
const attemptsInRound = (s: State, op: Operation) => s.packets.filter((p) => p.operation === op && p.round === s.round).length
function attention(s: State, reason: string) { if (s.phase !== 'forward' && s.phase !== 'compensating') return; s.resumePhase = s.phase; s.phase = 'attention'; event(s, 'attention', 'coordinator', 'journal', `${reason}；保留恢复位置，进入需人工处理状态。`, nextOperation(s)) }
export function canSend(s: State, c: Config): boolean {
  const op = nextOperation(s)
  if (!s.online || !op || !['forward', 'compensating'].includes(s.phase) || attemptsInRound(s, op) >= c.maxAttempts || s.packets.length >= 30) return false
  const last = s.packets.filter((p) => p.operation === op && p.round === s.round).at(-1)
  return !last || last.epoch !== s.epoch || (last.response !== 'delivered' && (last.expired || last.outcome === 'unavailable' && last.response === 'recorded'))
}
function apply(s: State, c: Config, command: Command) {
  if (command.type === 'advance') {
    if (s.now + command.ms > MAX_TIME) throw new Error('超过 Saga 时间预算。')
    const target = s.now + command.ms
    for (const p of s.packets.filter((p) => !p.expired && p.deadline <= target).sort((a, b) => a.deadline - b.deadline)) {
      s.now = p.deadline; p.expired = true
      if (p.response !== 'delivered' && p.response !== 'ignored' && p.response !== 'recorded') {
        event(s, 'timeout', 'coordinator', 'coordinator', `${p.id} 未获得已记录的结果；超时不撤销服务端效果或在途调用。`, p.id)
        if (s.online && nextOperation(s) === p.operation && s.packets.filter((packet) => packet.operation === p.operation).at(-1)?.id === p.id && attemptsInRound(s, p.operation) >= c.maxAttempts) attention(s, '本轮调用预算耗尽')
      }
    }
    s.now = target; event(s, 'clock', 'coordinator', 'coordinator', `推进到 ${target} ms。`); return
  }
  if (command.type === 'block' || command.type === 'repair') {
    if (command.type === 'block') { if (!s.blocked.includes(command.operation)) s.blocked.push(command.operation) } else s.blocked = s.blocked.filter((op) => op !== command.operation)
    event(s, command.type, 'services', 'services', `${operationLabels[command.operation]}：${command.type === 'block' ? command.operation === 'cleanup' || command.operation === 'release' ? '后续新调用暂时不可用' : '后续新调用业务拒绝' : '后续新调用恢复可用'}；已返回结果不改变。`, command.operation); return
  }
  if (command.type === 'crash') { if (!s.online) throw new Error('协调者已经崩溃。'); s.online = false; for (const p of s.packets) if (p.response === 'delivered') p.response = 'ignored'; event(s, 'crashed', 'coordinator', 'coordinator', '协调者失去内存中的响应；持久流程、服务端效果与在途消息保留。'); return }
  if (command.type === 'restart') { if (s.online) throw new Error('协调者仍在运行。'); s.online = true; s.epoch++; event(s, 'restarted', 'journal', 'coordinator', `根据持久进度恢复，进程世代 ${s.epoch}；旧响应不能当作新进程已收到。`); const op = nextOperation(s); if (op && attemptsInRound(s, op) >= c.maxAttempts) attention(s, '恢复时发现本轮预算已耗尽'); return }
  if ('packetId' in command) {
    const p = s.packets.find((p) => p.id === command.packetId)
    if (!p) throw new Error('调用记录不存在。')
    if (command.type === 'drop-request') { if (p.status !== 'network') throw new Error('调用不在网络中。'); p.status = 'dropped'; event(s, 'request-dropped', 'coordinator', 'services', '调用未到达服务端。', p.id); return }
    if (command.type === 'deliver-request') {
      if (p.status !== 'network') throw new Error('调用不在网络中。')
      p.status = 'processed'; p.response = 'network'
      if (c.idempotent && s.dedupe[p.operation]) { p.outcome = s.dedupe[p.operation]!; p.replayed = true; event(s, 'dedupe', 'services', 'services', `${p.operationId} 重放原结果，不再执行业务效果。`, p.id) }
      else {
        const op = p.operation
        p.outcome = s.blocked.includes(op) ? op === 'cleanup' || op === 'release' ? 'unavailable' : 'rejected' : op === 'reserve' && s.resource.reserved - s.resource.released >= 1 || op === 'transcode' && s.resource.reserved - s.resource.released <= 0 || op === 'publish' && s.resource.artifacts <= 0 ? 'rejected' : 'ok'
        if (p.outcome === 'ok') {
          if (op === 'reserve') s.resource.reserved++
          if (op === 'transcode') { s.resource.artifacts++; s.resource.transcodeWork++ }
          if (op === 'publish') s.resource.published = true
          if (op === 'cleanup') s.resource.artifacts = 0
          if (op === 'release') s.resource.released++
          s.effects.push({ operation: op, packetId: p.id })
        }
        if (c.idempotent && p.outcome !== 'unavailable') s.dedupe[op] = p.outcome
        event(s, p.outcome === 'ok' ? 'effect' : 'operation-failed', 'services', 'services', `${operationLabels[op]} ${p.outcome === 'ok' ? '效果已提交' : p.outcome === 'rejected' ? '业务拒绝' : '暂时不可用'}；协调者尚未记录结果。${op === 'release' && p.outcome === 'ok' ? '释放是增加可用配额的业务操作，重复释放会过量返还。' : ''}`, p.id)
      }
      event(s, 'response-sent', 'services', 'coordinator', `${p.id} 响应 ${p.outcome} 已发送。`, p.id); return
    }
    if (command.type === 'drop-response' || command.type === 'deliver-response') {
      if (p.response !== 'network') throw new Error('响应不在网络中。')
      if (command.type === 'drop-response') { p.response = 'dropped'; event(s, 'response-dropped', 'services', 'coordinator', '响应丢失，业务效果仍然保留。', p.id); return }
      if (!s.online || p.epoch !== s.epoch || p.operation !== nextOperation(s) || s.phase === 'attention') { p.response = 'ignored'; event(s, 'response-ignored', 'services', 'coordinator', '响应属于旧进程、旧步骤或当前正在等待人工处理；不推进持久进度。', p.id); return }
      p.response = 'delivered'; event(s, 'response-received', 'services', 'coordinator', `${p.id} 结果只在当前进程内存中，还需记录到恢复日志。`, p.id); return
    }
    if (command.type === 'checkpoint') {
      if (!s.online || p.epoch !== s.epoch || p.response !== 'delivered' || p.operation !== nextOperation(s) || !['forward', 'compensating'].includes(s.phase)) throw new Error('需要当前步骤在本进程收到的响应才能保存进度。')
      p.response = 'recorded'
      if (p.outcome === 'unavailable') { event(s, 'retry-pending', 'coordinator', 'journal', '记录本次暂时失败，补偿仍未完成。', p.id); if (attemptsInRound(s, p.operation) >= c.maxAttempts) attention(s, '补偿尝试预算耗尽'); return }
      s.journal[p.operation] = p.outcome!
      event(s, 'checkpoint', 'coordinator', 'journal', `持久记录 ${operationLabels[p.operation]}：${p.outcome}。`, p.id)
      if (p.outcome === 'rejected') {
        s.phase = c.recovery === 'saga' ? 'compensating' : 'failed'
        event(s, s.phase === 'compensating' ? 'compensation-started' : 'stopped', 'coordinator', 'journal', s.phase === 'compensating' ? '按已确认的正向步骤逆序补偿；各步骤仍是独立本地事务。' : '遇到失败就停止；已成功的步骤仍然存在。')
      }
      settle(s); return
    }
  }
  if (!s.online) throw new Error('协调者已离线，请先重启。')
  if (command.type === 'start') { if (s.phase !== 'idle') throw new Error('同一实验只包含一个流程。'); s.phase = 'forward'; event(s, 'started', 'coordinator', 'journal', '持久创建 video-1 流程。每个步骤的操作 ID 为 video-1 / 步骤。'); return }
  if (command.type === 'resume-review') { if (s.phase !== 'attention') throw new Error('流程没有等待人工处理。'); s.phase = s.resumePhase; s.round++; event(s, 'review-resumed', 'journal', 'coordinator', '人工核查后开启新的有限尝试预算，业务状态尚未自动修复。', nextOperation(s)); return }
  if (command.type === 'send') {
    if (!canSend(s, c)) throw new Error('当前不能重试：先处理响应、等待超时，或核查待处理流程。')
    const op = nextOperation(s)!
    const p: Packet = { id: `call-${s.packets.length + 1}`, operation: op, operationId: `video-1/${op}`, epoch: s.epoch, round: s.round, deadline: s.now + c.timeoutMs, expired: false, status: 'network', response: 'none', outcome: null, replayed: false }
    s.packets.push(p); event(s, 'request-sent', 'coordinator', 'services', `发送 ${p.operationId}，本轮第 ${attemptsInRound(s, op)} 次；重试沿用相同逻辑 ID。`, p.id); return
  }
  throw new Error('未知 Saga 操作。')
}
export function runModel(value: Config, commands: readonly Command[]): State { const c = parseConfig(value); if (!Array.isArray(commands) || commands.length > MAX_COMMANDS) throw new Error('Saga 命令预算超限。'); const s = initial(); Array.from(commands).forEach((raw, index) => { try { apply(s, c, parseCommand(raw)) } catch (e) { throw new Error(`第 ${index + 1} 步：${e instanceof Error ? e.message : '操作无效。'}`) } }); return s }
