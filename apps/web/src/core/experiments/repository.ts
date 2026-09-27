import Dexie, { type Table } from 'dexie'
import type { AttemptIdentity, ExperimentRepository, LabContract } from './contracts'
import { same } from './equality'
import { LabStorageError } from './errors'
import { migrateDraft } from './draft-codec'
import { sameVersions, validVersions, type ExperimentVersions } from './versions'
export { LabStorageError } from './errors'

const queues = new Map<string, Promise<unknown>>()
interface DraftBackup { draftVersion: number; versions: ExperimentVersions | null; draft: unknown; revision: number }
export interface SavedSession { scope: string; version: 1 | 2; revision?: number; draftVersion?: number; versions?: ExperimentVersions; draftBackups?: DraftBackup[]; draft: unknown; activeAttemptId: string | null }
interface SavedAttempt { id: string; scope: string; storageVersion?: 2; versions?: ExperimentVersions; attempt: unknown }
function storedRevision(session: SavedSession | undefined): number {
  if (session && session.version !== 1 && session.version !== 2) throw new LabStorageError('load', '保存的会话版本未知，无法恢复；已有记录仍保留。')
  const revision = session?.revision ?? 0
  if (!Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER) throw new LabStorageError('load', '保存记录的修订号无效，已有记录仍保留。')
  return revision
}
export class AlgorithmDatabase extends Dexie {
  /** Legacy drafts are retained so older open clients cannot overwrite the new store. */
  sessions!: Table<SavedSession, string>
  drafts!: Table<SavedSession, string>
  attempts!: Table<SavedAttempt, string>
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
  private sourceSnapshot: unknown = null
  private draftBackups: DraftBackup[] = []
  private pendingBackup: DraftBackup | null = null
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
    // IndexedDB already detached these values. Clone only when exporting recovery data.
    this.sourceSnapshot = { session: session ?? null, attempts: rows }
    storedRevision(session)
    if (session && (session.activeAttemptId !== null && session.activeAttemptId !== undefined && typeof session.activeAttemptId !== 'string' || session.versions !== undefined && !validVersions(session.versions))) throw new LabStorageError('load', '记录身份或版本信息无效，原记录已保留。')
    const sourceVersion = session?.draftVersion ?? 1; const targetVersion = this.contract.draftVersion ?? 1
    if (session?.versions && this.contract.versions && (session.versions.model !== this.contract.versions.model || session.versions.definition !== this.contract.versions.definition) && sourceVersion === targetVersion) throw new LabStorageError('load', '模型或题目版本已改变，需要显式草稿迁移；原记录已保留。')
    const draft = session ? this.contract.parseDraft(migrateDraft(session.draft, sourceVersion, targetVersion, this.contract.draftMigrations)) : null
    if (session?.draftBackups !== undefined && !Array.isArray(session.draftBackups)) throw new LabStorageError('load', '迁移备份格式无效，原记录已保留。')
    this.draftBackups = structuredClone(session?.draftBackups ?? [])
    this.pendingBackup = session && (session.version === 1 || sourceVersion !== targetVersion) ? { draftVersion: sourceVersion, versions: session.versions ?? null, draft: structuredClone(session.draft), revision: session.revision ?? 0 } : null
    const attempts: A[] = []; const retained: unknown[] = []
    for (const row of rows) {
      try {
        const supported = (row.storageVersion === undefined || row.storageVersion === 2)
          && (row.versions === undefined || validVersions(row.versions))
          && (!this.contract.versions || (row.versions ? sameVersions(row.versions, this.contract.versions) : this.contract.versions.definition === 1 && this.contract.versions.assessment === 1))
        if (supported && this.contract.verifyAttempt(row.attempt)) attempts.push(row.attempt)
        else retained.push(structuredClone(row))
      } catch { retained.push(structuredClone(row)) }
    }
    attempts.sort((a,b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))
    this.expectedRevision = storedRevision(current)
    this.legacySnapshot = current ? undefined : JSON.stringify(legacy ?? null)
    this.loadFailed = false
    return { draft, activeAttemptId: session?.activeAttemptId ?? null, attempts, rejected: retained.length, retained }
  }
  save(draft: D, activeAttemptId: string | null, attempts: A[]) {
    const session: SavedSession = { scope: this.scope, version: 2, draftVersion: this.contract.draftVersion ?? 1, ...(this.contract.versions ? { versions: { ...this.contract.versions } } : {}), draft: structuredClone(this.contract.parseDraft(draft)), activeAttemptId }
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
            await this.database.attempts.add({ id: attempt.id, scope: this.scope, storageVersion: 2, ...(this.contract.versions ? { versions: { ...this.contract.versions } } : {}), attempt })
          }
        }
        const draftBackups = [...this.draftBackups, ...(this.pendingBackup ? [this.pendingBackup] : [])]
        await this.database.drafts.put({ ...session, draftBackups, revision: currentRevision + 1 })
        return currentRevision + 1
      })
      // Read this value when the next queued write executes, not when it is enqueued.
      this.expectedRevision = revision
      if (this.pendingBackup) { this.draftBackups.push(this.pendingBackup); this.pendingBackup = null }
      this.legacySnapshot = undefined
    })
    queues.set(key, pending)
    return pending
  }
  recoveryData() { return structuredClone({ loaded: this.sourceSnapshot, draftBackups: this.draftBackups }) }
}
