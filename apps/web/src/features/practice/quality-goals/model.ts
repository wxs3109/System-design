export const MAX_COMMANDS = 40
export type Domain = 'A' | 'B'
export interface Config {
  modelVersion: 'quality-goals-v1'
  replicas: 1 | 2
  placement: 'shared' | 'separate'
  acknowledgement: 'memory' | 'stable'
  dependency: 'required' | 'degrade'
}
export type Command = { type: 'read' | 'write' | 'read-confirmed' | 'crash-storage' | 'recover-storage' | 'fail-dependency' | 'recover-dependency' } | { type: 'fail-domain' | 'recover-domain'; domain: Domain }
export interface Request {
  id: string; at: number; operation: 'read' | 'write' | 'read-confirmed'
  instance: string | null; status: 'complete' | 'degraded' | 'unavailable' | 'data-missing'
  latencyMs: number; values: string[]
}
export interface State {
  modelVersion: 'quality-goals-v1'; now: number
  instances: { id: string; domain: Domain; online: boolean }[]
  storage: { online: boolean; memory: string[]; stable: string[] }
  dependencyOnline: boolean
  acknowledgements: { requestId: string; recordId: string }[]
  requests: Request[]
  events: { index: number; at: number; kind: Command['type']; subject: string }[]
}
export const defaultConfig = (): Config => ({ modelVersion: 'quality-goals-v1', replicas: 1, placement: 'shared', acknowledgement: 'memory', dependency: 'required' })
export function parseConfig(value: unknown): Config {
  const c = value as Config | null
  if (!c || c.modelVersion !== 'quality-goals-v1' || ![1, 2].includes(c.replicas) || !['shared', 'separate'].includes(c.placement) || !['memory', 'stable'].includes(c.acknowledgement) || !['required', 'degrade'].includes(c.dependency)) throw new Error('目标实验配置无效。')
  return { modelVersion: c.modelVersion, replicas: c.replicas, placement: c.placement, acknowledgement: c.acknowledgement, dependency: c.dependency }
}
export function parseCommand(value: unknown): Command {
  const c = value as Command | null
  if (!c || typeof c !== 'object') throw new Error('实验操作无效。')
  if (c.type === 'fail-domain' || c.type === 'recover-domain') {
    if (!['A', 'B'].includes(c.domain)) throw new Error('故障域无效。')
    return { type: c.type, domain: c.domain }
  }
  if (!['read', 'write', 'read-confirmed', 'crash-storage', 'recover-storage', 'fail-dependency', 'recover-dependency'].includes(c.type)) throw new Error('未知实验操作。')
  return { type: c.type }
}
export function missingAcknowledged(state: State): string[] {
  const recoverable = new Set([...state.storage.memory, ...state.storage.stable])
  return state.acknowledgements.filter(a => !recoverable.has(a.recordId)).map(a => a.recordId)
}
export function runModel(input: Config, operations: readonly Command[]): State {
  const config = parseConfig(input)
  if (!Array.isArray(operations) || operations.length > MAX_COMMANDS) throw new Error('超过 40 步操作预算。')
  const commands = Array.from(operations, parseCommand)
  const state: State = {
    modelVersion: config.modelVersion, now: 0,
    instances: Array.from({ length: config.replicas }, (_, i) => ({ id: `service-${i + 1}`, domain: i && config.placement === 'separate' ? 'B' : 'A', online: true })),
    storage: { online: true, memory: [], stable: [] }, dependencyOnline: true, acknowledgements: [], requests: [], events: [],
  }
  for (const command of commands) {
    let subject = ''
    if (command.type === 'fail-domain' || command.type === 'recover-domain') {
      for (const node of state.instances) if (node.domain === command.domain) node.online = command.type === 'recover-domain'
      subject = command.domain
    } else if (command.type === 'crash-storage') { state.storage.online = false; state.storage.memory = []; subject = 'storage' }
    else if (command.type === 'recover-storage') {
      if (!state.storage.online) { state.storage.online = true; state.storage.memory = [...state.storage.stable] }
      subject = 'storage'
    } else if (command.type === 'fail-dependency' || command.type === 'recover-dependency') { state.dependencyOnline = command.type === 'recover-dependency'; subject = 'optional-content' }
    else {
      const online = state.instances.filter(n => n.online)
      const instance = online[state.requests.length % (online.length || 1)]?.id ?? null
      const request: Request = { id: `request-${state.requests.length + 1}`, at: state.now, operation: command.type, instance, status: 'unavailable', latencyMs: 10, values: [] }
      if (instance && state.storage.online) {
        if (command.type === 'write') {
          const recordId = `record-${state.acknowledgements.length + 1}`
          state.storage.memory.push(recordId)
          if (config.acknowledgement === 'stable') state.storage.stable.push(recordId)
          state.acknowledgements.push({ requestId: request.id, recordId })
          request.status = 'complete'; request.latencyMs = config.acknowledgement === 'stable' ? 40 : 15; request.values = [recordId]
        } else if (command.type === 'read-confirmed') {
          request.values = [...state.storage.memory]
          request.status = state.acknowledgements.every(a => request.values.includes(a.recordId)) ? 'complete' : 'data-missing'
          request.latencyMs = 20
        } else if (state.dependencyOnline) { request.status = 'complete'; request.latencyMs = 80; request.values = ['core', 'extra'] }
        else if (config.dependency === 'degrade') { request.status = 'degraded'; request.latencyMs = 35; request.values = ['core'] }
        else request.latencyMs = 100
      } else if (instance) request.latencyMs = 100
      state.requests.push(request); state.now += request.latencyMs; subject = request.id
    }
    // Control actions cost one symbolic millisecond; request latency is recorded above.
    if (!['read', 'write', 'read-confirmed'].includes(command.type)) state.now++
    state.events.push({ index: state.events.length + 1, at: state.now, kind: command.type, subject })
  }
  return state
}
