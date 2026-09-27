import Dexie, { type Table } from 'dexie'
import type { AttemptIdentity, ExperimentRepository, LabContract } from './contracts'
import { same } from './equality'
import { LabStorageError } from './errors'
export { LabStorageError } from './errors'

const queues = new Map<string, Promise<unknown>>()
export interface SavedSession { scope: string; version: 1; revision?: number; draft: unknown; activeAttemptId: string | null }
function storedRevision(session: SavedSession | undefined): number {
  if (session && session.version !== 1) throw new LabStorageError('load', '保存的会话版本未知，无法恢复；已有记录仍保留。')
  const revision = session?.revision ?? 0
  if (!Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER) throw new LabStorageError('load', '保存记录的修订号无效，已有记录仍保留。')
  return revision
}
export class AlgorithmDatabase extends Dexie {
  /** Legacy drafts are retained so older open clients cannot overwrite the new store. */
  sessions!: Table<SavedSession, string>
  drafts!: Table<SavedSession, string>
  attempts!: Table<{ id: string; scope: string; attempt: unknown }, string>
  constructor(name = 'system-design-algorithm-labs') {
    super(name)
    this.version(1).stores({ sessions: '&scope', attempts: '&id, scope' })
    this.version(2).stores({ sessions: '&scope', drafts: '&scope', attempts: '&id, scope' }).upgrade(async (transaction) => {
      const legacy = await transaction.table('sessions').toArray()
      if (legacy.length) await transaction.table('drafts').bulkPut(legacy)
    })
  }
}
export class LabRepository<D, A extends AttemptIdentity> implements ExperimentRepository<D, A> {
  private expectedRevision: number | undefined
  private loadFailed = false
  private legacySnapshot: string | undefined
  constructor(readonly database: AlgorithmDatabase, readonly scope: string, readonly contract: LabContract<D, A>) {}
  async load() {
    await queues.get(`${this.database.name}:${this.scope}`)?.catch(() => undefined)
    this.expectedRevision = undefined
    this.loadFailed = true
    const { current, legacy, rows } = await this.database.transaction('r', this.database.drafts, this.database.sessions, this.database.attempts, async () => {
      const current = await this.database.drafts.get(this.scope)
      return { current, legacy: current ? undefined : await this.database.sessions.get(this.scope), rows: await this.database.attempts.where('scope').equals(this.scope).toArray() }
    })
    const session = current ?? legacy
    storedRevision(session)
    const draft = session ? this.contract.parseDraft(session.draft) : null
    const attempts = rows.map((row) => row.attempt).filter(this.contract.verifyAttempt).sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))
    this.expectedRevision = storedRevision(current)
    this.legacySnapshot = current ? undefined : JSON.stringify(legacy ?? null)
    this.loadFailed = false
    return { draft, activeAttemptId: session?.activeAttemptId ?? null, attempts, rejected: rows.length - attempts.length }
  }
  save(draft: D, activeAttemptId: string | null, attempts: A[]) {
    const session: SavedSession = { scope: this.scope, version: 1, draft: structuredClone(this.contract.parseDraft(draft)), activeAttemptId }
    // Clone before the first await: callers may edit while IndexedDB is busy.
    const copies = structuredClone(attempts)
    const key = `${this.database.name}:${this.scope}`
    const pending = (queues.get(key) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      if (this.loadFailed) throw new LabStorageError('load', '尚未成功读取原记录，已阻止保存；请先重试读取。')
      const revision = await this.database.transaction('rw', this.database.drafts, this.database.sessions, this.database.attempts, async () => {
        const current = await this.database.drafts.get(this.scope)
        const legacy = current ? undefined : await this.database.sessions.get(this.scope)
        const currentRevision = storedRevision(current)
        if (this.expectedRevision === undefined && (current || legacy)) throw new LabStorageError('load', '已有会话尚未读取，不能用新草稿覆盖。')
        if (currentRevision !== (this.expectedRevision ?? 0)) throw new LabStorageError('conflict', '其他标签页已更新这道实验。本页操作仍保留在内存中，未覆盖已保存的记录。')
        if (!current && this.legacySnapshot !== undefined && this.legacySnapshot !== JSON.stringify(legacy ?? null)) throw new LabStorageError('conflict', '旧版标签页已更新这道实验，请先保留本页记录并重新读取。')
        for (const attempt of copies) {
          const existing = await this.database.attempts.get(attempt.id)
          if (existing) {
            if (existing.scope !== this.scope || !same(existing.attempt, attempt)) throw new Error('历史尝试不能被覆盖。')
          } else {
            if (!this.contract.verifyAttempt(attempt)) throw new Error('运行证据无效，无法保存。')
            await this.database.attempts.add({ id: attempt.id, scope: this.scope, attempt })
          }
        }
        await this.database.drafts.put({ ...session, revision: currentRevision + 1 })
        return currentRevision + 1
      })
      // Read this value when the next queued write executes, not when it is enqueued.
      this.expectedRevision = revision
      this.legacySnapshot = undefined
    })
    queues.set(key, pending)
    return pending
  }
}
