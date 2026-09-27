export type ExperimentKind = 'simulation' | 'algorithm' | 'protocol' | 'design' | 'product-design'
export interface ExperimentMetadata {
  id: string; title: string; summary: string; category: string; difficulty: string; estimatedMinutes: number
  kind: ExperimentKind; definitionVersion: number; flow: readonly string[]
}
export interface ExperimentCapabilities { execution: 'worker' | 'local'; step: boolean; topology: boolean; compare: boolean; restore: boolean }
export interface RegisteredExperiment<Renderer = unknown> {
  metadata: ExperimentMetadata
  capabilities: ExperimentCapabilities
  caseId?: string
  scope?: string
  loadRenderer: () => Promise<Renderer>
}
export function experimentRegistry<E extends RegisteredExperiment>(entries: readonly E[]) {
  const byId = new Map<string, E>()
  for (const entry of entries) {
    const m = entry.metadata
    if (!/^[a-z][a-z0-9-]*$/.test(m.id) || byId.has(m.id)) throw new Error(`Invalid or duplicate experiment ID: ${m.id}`)
    if (![m.title, m.summary, m.category, m.difficulty].every(s => typeof s === 'string' && s.trim()) || !Number.isSafeInteger(m.definitionVersion) || m.definitionVersion < 1 || !Number.isFinite(m.estimatedMinutes) || m.estimatedMinutes <= 0 || !Array.isArray(m.flow) || m.flow.some(v => typeof v !== 'string')) throw new Error(`Incomplete experiment metadata: ${m.id}`)
    if (!['simulation', 'algorithm', 'protocol', 'design', 'product-design'].includes(m.kind) || typeof entry.loadRenderer !== 'function' || !['worker', 'local'].includes(entry.capabilities.execution) || [entry.capabilities.step, entry.capabilities.topology, entry.capabilities.compare, entry.capabilities.restore].some(v => typeof v !== 'boolean')) throw new Error(`Invalid experiment capability/renderer: ${m.id}`)
    if (!!entry.caseId !== !!entry.scope) throw new Error(`Case registration requires both identity and scope: ${m.id}`)
    byId.set(m.id, entry)
  }
  return { entries: Object.freeze([...entries]), get: (id: string) => byId.get(id), forCase: (id: string) => entries.filter(entry => entry.caseId === id) }
}
