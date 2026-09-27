import { relationalDataModelSchema } from '@system-design/model'
import { parseChoiceConfig } from '../../../core/experiments/choice-input'
export const MAX_COMMANDS = 30
export interface Config { modelVersion: 'data-access-v1'; path: 'scan' | 'primary' | 'ordered'; maintenance: 'inline' | 'deferred'; layout: 'embedded' | 'split' }
export interface Row { id: string; owner: string; time: number; value: number }
export type Query = { type: 'point'; id: string } | { type: 'range'; owner: string }
export type Command = Query | { type: 'move'; id: string; owner: string; time: number } | { type: 'refresh' }
export interface QueryResult { command: Query; source: Row[]; rows: Row[]; rowsExamined: number; indexProbes: number; bytesRead: number }
export interface State { modelVersion: 'data-access-v1'; rows: Record<string, Row>; index: { id: string; owner: string; time: number }[]; queries: QueryResult[]; indexWrites: number; indexRemovals: number; events: { index: number; at: number; kind: Command['type']; subject: string }[] }
export const defaultConfig = (): Config => ({ modelVersion: 'data-access-v1', path: 'scan', maintenance: 'inline', layout: 'embedded' })
export const parseConfig = (v: unknown) => parseChoiceConfig<Config>(v, { modelVersion: ['data-access-v1'], path: ['scan','primary','ordered'], maintenance: ['inline','deferred'], layout: ['embedded','split'] })
export const initialRows = (): Row[] => Array.from({ length: 16 }, (_, i) => ({ id: `r${String(i+1).padStart(2,'0')}`, owner: `u${(i+1)%4}`, time: i+1, value: (i+1)*10 }))
export function parseCommand(value: unknown): Command {
  const c = value as Command | null
  if (!c || typeof c !== 'object') throw new Error('访问操作无效。')
  if (c.type === 'refresh') return { type: c.type }
  if (c.type === 'point' || c.type === 'move') {
    if (!/^r(0[1-9]|1[0-6])$/.test(c.id)) throw new Error('记录 ID 无效。')
    if (c.type === 'point') return { type: c.type, id: c.id }
  }
  if (c.type === 'range' || c.type === 'move') {
    if (!/^u[0-3]$/.test(c.owner)) throw new Error('用户键无效。')
    if (c.type === 'range') return { type: c.type, owner: c.owner }
    if (!Number.isSafeInteger(c.time) || c.time < 0 || c.time > 99) throw new Error('时间键无效。')
    return { type: c.type, id: c.id, owner: c.owner, time: c.time }
  }
  throw new Error('未知访问操作。')
}
const compare = (a: { owner: string; time: number; id: string }, b: { owner: string; time: number; id: string }) => (a.owner < b.owner ? -1 : a.owner > b.owner ? 1 : a.time - b.time || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
export function dataContract(config: Config) {
  return relationalDataModelSchema.parse({ id: 'access-records', version: 1, name: 'Access path records', ownerNodeId: 'store', kind: 'relational', tables: [{ id: 'records', name: 'records', columns: ['id','owner','time','value'].map(id => ({ id, name: id, type: id === 'id' || id === 'owner' ? { kind: 'string' } : { kind: 'integer', bits: 32 }, nullable: false })), primaryKey: { id: 'pk-records', name: 'records_pk', columnIds: ['id'] }, uniqueKeys: [], foreignKeys: [], indexes: config.path === 'ordered' ? [{ id: 'owner-time', name: 'owner_time', columnIds: ['owner','time','id'], kind: 'btree', unique: false, includedColumnIds: [] }] : [], estimatedRows: 16, estimatedRowBytes: config.layout === 'embedded' ? 320 : 64 }] })
}
export function runModel(input: Config, operations: readonly Command[]): State {
  const config = parseConfig(input)
  if (!Array.isArray(operations) || operations.length > MAX_COMMANDS) throw new Error('超过 30 步操作预算。')
  const s: State = { modelVersion: config.modelVersion, rows: Object.fromEntries(initialRows().map(r => [r.id,r])), index: [], queries: [], indexWrites: 0, indexRemovals: 0, events: [] }
  const rebuild = () => { s.indexRemovals += s.index.length; s.index = Object.values(s.rows).map(({id,owner,time}) => ({id,owner,time})).sort(compare); s.indexWrites += s.index.length }
  if (config.path === 'ordered') rebuild()
  for (const c of operations.map(parseCommand)) {
    if (c.type === 'move') {
      s.rows[c.id] = { ...s.rows[c.id]!, owner: c.owner, time: c.time }
      if (config.path === 'ordered' && config.maintenance === 'inline') { s.index = s.index.filter(e => e.id !== c.id); s.indexRemovals++; s.index.push({ id: c.id, owner: c.owner, time: c.time }); s.index.sort(compare); s.indexWrites++ }
    } else if (c.type === 'refresh') { if (config.path === 'ordered') rebuild() }
    else {
      const q: QueryResult = { command: c, source: structuredClone(Object.values(s.rows)), rows: [], rowsExamined: 0, indexProbes: 0, bytesRead: 0 }
      const fetch = (id: string) => {
        const row = s.rows[id]!; q.rowsExamined++
        q.bytesRead += new TextEncoder().encode(JSON.stringify(config.layout === 'embedded' ? { ...row, payload: 'x'.repeat(256) } : row)).byteLength
        if (c.type === 'point' ? row.id === c.id : row.owner === c.owner) q.rows.push({ ...row })
      }
      if (c.type === 'point' && config.path !== 'scan') { q.indexProbes++; fetch(c.id) }
      else if (c.type === 'range' && config.path === 'ordered') {
        let lo = 0; let hi = s.index.length
        while (lo < hi) { const mid = (lo + hi) >>> 1; q.indexProbes++; if (s.index[mid]!.owner < c.owner) lo = mid + 1; else hi = mid }
        for (let i = lo; i < s.index.length; i++) { q.indexProbes++; const e = s.index[i]!; if (e.owner !== c.owner) break; fetch(e.id) }
      } else for (const id of Object.keys(s.rows)) fetch(id)
      q.rows.sort(compare); s.queries.push(q)
    }
    s.events.push({ index: s.events.length+1, at: s.events.length, kind: c.type, subject: 'id' in c ? c.id : 'owner' in c ? c.owner : 'secondary-index' })
  }
  return s
}
