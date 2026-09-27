export const MAX_COMMANDS = 8
export const WINDOW_MS = 5000
export const choices = { users: [8640, 17280, 86400], requestsPerDay: [10, 20], peakFactor: [1, 5, 10], readPercent: [50, 90], responseBytes: [100000, 1000000], retentionDays: [7, 30], copies: [1, 3], computeSlots: [1, 2, 4], storageSlots: [1, 2, 4], bandwidthMbps: [8, 80, 800] } as const
export type Config = { modelVersion: 'resource-budget-v1' } & { -readonly [K in keyof typeof choices]: number }
export type Command = { type: 'derive' | 'sample' }
export type Resource = 'compute' | 'storage' | 'network'
export interface Estimate { dailyRequests: number; averageRps: number; peakRps: number; responseBytesPerSecond: number; responseMbps: number; dailyWrites: number; logicalBytes: number; copiedBytes: number; ceilings: Record<Resource, number> }
export interface Stage { resource: Resource; queuedAt: number; startedAt: number; finishedAt: number; slot: number }
export interface Request { id: number; arrival: number; read: boolean; responseBytes: number; stages: Stage[]; finishedAt: number }
export interface State { modelVersion: 'resource-budget-v1'; estimate: Estimate | null; requests: Request[]; latencyP95Ms: number | null; completedInWindow: number; averageInFlight: number; maxWait: Record<Resource, number>; events: { index: number; at: number; kind: Command['type']; subject: string }[] }
export const defaultConfig = (): Config => ({ modelVersion: 'resource-budget-v1', users: 8640, requestsPerDay: 10, peakFactor: 10, readPercent: 90, responseBytes: 1000000, retentionDays: 30, copies: 3, computeSlots: 1, storageSlots: 1, bandwidthMbps: 8 })
export function parseConfig(value: unknown): Config {
  return parseChoiceConfig<Config>(value, { modelVersion: ['resource-budget-v1'], ...choices })
}
export function parseCommand(value: unknown): Command { const c = value as Command; if (!c || !['derive', 'sample'].includes(c.type)) throw new Error('未知容量操作。'); return { type: c.type } }
export function derive(c: Config): Estimate {
  const dailyRequests = c.users * c.requestsPerDay; const averageRps = dailyRequests / 86400; const peakRps = averageRps * c.peakFactor
  const meanResponse = c.responseBytes * c.readPercent / 100 + 1000 * (100 - c.readPercent) / 100
  const dailyWrites = dailyRequests * (100 - c.readPercent) / 100
  const logicalBytes = dailyWrites * 1000 * c.retentionDays
  return { dailyRequests, averageRps, peakRps, responseBytesPerSecond: peakRps * meanResponse, responseMbps: peakRps * meanResponse * 8 / 1000000, dailyWrites, logicalBytes, copiedBytes: logicalBytes * c.copies, ceilings: { compute: c.computeSlots * 1000 / 50, storage: c.storageSlots * 1000 / 100, network: c.bandwidthMbps * 1000000 / 8 / meanResponse } }
}
export function runModel(value: Config, input: readonly Command[]): State {
  const c = parseConfig(value)
  if (!Array.isArray(input) || input.length > MAX_COMMANDS) throw new Error('超过 8 步操作预算。')
  const commands = input.map(parseCommand); const estimate = derive(c)
  const state: State = { modelVersion: c.modelVersion, estimate: null, requests: [], latencyP95Ms: null, completedInWindow: 0, averageInFlight: 0, maxWait: { compute: 0, storage: 0, network: 0 }, events: [] }
  for (const command of commands) {
    if (command.type === 'derive') state.estimate = estimate
    else {
      const pools: Record<Resource, number[]> = { compute: Array(c.computeSlots).fill(0), storage: Array(c.storageSlots).fill(0), network: [0] }
      const book = (resource: Resource, arrival: number, duration: number): Stage => {
        const available = pools[resource]; const slot = available.indexOf(Math.min(...available)); const startedAt = Math.max(arrival, available[slot]!)
        const finishedAt = startedAt + duration; available[slot] = finishedAt
        return { resource, queuedAt: arrival, startedAt, finishedAt, slot }
      }
      const count = Math.round(estimate.peakRps * WINDOW_MS / 1000)
      if (count > 1000) throw new Error('本模型只处理 1000 个以内的请求。')
      state.requests = Array.from({ length: count }, (_, id) => {
        const arrival = id / estimate.peakRps * 1000; const read = id % 10 < c.readPercent / 10; const responseBytes = read ? c.responseBytes : 1000
        const compute = book('compute', arrival, 50); const storage = book('storage', compute.finishedAt, 100)
        const network = book('network', storage.finishedAt, responseBytes * 8 / (c.bandwidthMbps * 1000000) * 1000)
        return { id: id + 1, arrival, read, responseBytes, stages: [compute, storage, network], finishedAt: network.finishedAt }
      })
      const latencies = state.requests.map(r => r.finishedAt - r.arrival).sort((a, b) => a - b)
      state.latencyP95Ms = latencies[Math.ceil(latencies.length * .95) - 1] ?? null
      state.completedInWindow = state.requests.filter(r => r.finishedAt <= WINDOW_MS).length
      state.averageInFlight = state.requests.reduce((sum, r) => sum + Math.max(0, Math.min(WINDOW_MS, r.finishedAt) - r.arrival), 0) / WINDOW_MS
      for (const resource of ['compute', 'storage', 'network'] as const) state.maxWait[resource] = Math.max(0, ...state.requests.flatMap(r => r.stages.filter(s => s.resource === resource).map(s => s.startedAt - s.queuedAt)))
    }
    state.events.push({ index: state.events.length + 1, at: state.events.length, kind: command.type, subject: command.type === 'derive' ? 'declared-demand' : String(state.requests.length) })
  }
  return state
}
import { parseChoiceConfig } from '../../../core/experiments/choice-input'
