import Dexie, { type Table } from 'dexie'
import type { AttemptIdentity, ExperimentRepository, LabContract } from './contracts'
import { same } from './equality'
import { LabStorageError } from './errors'
import { migrateDraft } from './draft-codec'
import { sameVersions, validVersions, type ExperimentVersions } from './versions'
import { HISTORY_PAGE_SIZE, checkBackupSize, recoveryObject, type BackupPreview } from './history'
export { LabStorageError } from './errors'

const queues = new Map<string, Promise<unknown>>()
interface DraftBackup { draftVersion: number; versions: ExperimentVersions | null; draft: unknown; revision: number }
export interface SavedSession { scope: string; version: 1 | 2; revision?: number; draftVersion?: number; versions?: ExperimentVersions; draftBackups?: DraftBackup[]; draft: unknown; activeAttemptId: string | null }
interface SavedAttempt { id: string; scope: string; storageVersion?: 2; versions?: ExperimentVersions; attempt: unknown; createdAt?: number; archived?: number }
function indexFields(row: SavedAttempt) {
  const time = (row.attempt as Partial<AttemptIdentity> | null)?.createdAt
  return { createdAt: typeof time === 'number' && Number.isFinite(time) ? time : 0, archived: row.archived === 1 ? 1 : 0 }
}
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
    this.version(3).stores({ attempts: '&id, scope, [scope+archived+createdAt+id]' }).upgrade(async transaction => {
      await transaction.table('attempts').toCollection().modify(row => { Object.assign(row, indexFields(row)) })
    })
    this.attempts.hook('creating', (_key, row) => { Object.assign(row, indexFields(row)) })
    this.attempts.hook('updating', (changes, _key, row) => indexFields({ ...row, ...changes }))
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
  private historyQuery(archived: boolean) {
    return this.database.attempts.where('[scope+archived+createdAt+id]').between([this.scope, archived ? 1 : 0, -Infinity, ''], [this.scope, archived ? 1 : 0, Infinity, []]).reverse()
  }
  private unindexed() { return this.database.attempts.where('scope').equals(this.scope).filter(row => !Number.isFinite(row.createdAt) || (row.archived !== 0 && row.archived !== 1)) }
  private async missingIndexCount() { return Math.max(0, await this.database.attempts.where('scope').equals(this.scope).count() - await this.historyQuery(false).count() - await this.historyQuery(true).count()) }
  async historyPage(page = 0, archived = false) {
    if (!Number.isSafeInteger(page) || page < 0) throw new Error('历史页码无效。')
    // Index keys contain the summary; opening a page never reads or replays result payloads.
    const indexed = await this.historyQuery(archived).count()
    const missing = archived ? 0 : await this.missingIndexCount()
    const keys = await this.historyQuery(archived).offset(page * HISTORY_PAGE_SIZE).limit(HISTORY_PAGE_SIZE).keys()
    const entries = keys.map(key => { const parts = key as unknown as [string, number, number, string]; return { id: parts[3], createdAt: parts[2], archived } })
    if (missing && entries.length < HISTORY_PAGE_SIZE) {
      const fallback = await this.unindexed().offset(Math.max(0, page * HISTORY_PAGE_SIZE - indexed)).limit(HISTORY_PAGE_SIZE - entries.length).toArray()
      entries.push(...fallback.map(row => ({ id: row.id, createdAt: indexFields(row).createdAt, archived: false })))
    }
    return { page, total: indexed + missing, entries }
  }
  private supported(row: SavedAttempt): row is SavedAttempt & { attempt: A } {
    try { return row.scope === this.scope && (row.attempt as AttemptIdentity)?.id === row.id && (row.storageVersion === undefined || row.storageVersion === 2)
      && (row.versions === undefined || validVersions(row.versions))
      && (!this.contract.versions || (row.versions ? sameVersions(row.versions, this.contract.versions) : this.contract.versions.definition === 1 && this.contract.versions.assessment === 1))
      && this.contract.verifyAttempt(row.attempt) } catch { return false }
  }
  async load() {
    await queues.get(`${this.database.name}:${this.scope}`)?.catch(() => undefined)
    this.expectedRevision = undefined
    this.loadFailed = true
    const { current, legacy, rows, historyTotal } = await this.database.transaction('r', this.database.drafts, this.database.sessions, this.database.attempts, async () => {
      const current = await this.database.drafts.get(this.scope)
      const legacy = current ? undefined : await this.database.sessions.get(this.scope)
      const rows = await this.historyQuery(false).limit(HISTORY_PAGE_SIZE).toArray()
      const missing = await this.missingIndexCount()
      if (missing) rows.push(...await this.unindexed().limit(HISTORY_PAGE_SIZE).toArray())
      const active = (current ?? legacy)?.activeAttemptId
      if (active && !rows.some(row => row.id === active)) { const row = await this.database.attempts.get(active); if (row?.scope === this.scope) rows.push(row) }
      return { current, legacy, rows, historyTotal: await this.historyQuery(false).count() + missing }
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
        if (this.supported(row)) attempts.push(row.attempt)
        else retained.push(structuredClone(row))
      } catch { retained.push(structuredClone(row)) }
    }
    attempts.sort((a,b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))
    this.expectedRevision = storedRevision(current)
    this.legacySnapshot = current ? undefined : JSON.stringify(legacy ?? null)
    this.loadFailed = false
    return { draft, activeAttemptId: session?.activeAttemptId ?? null, attempts, rejected: retained.length, retained, historyTotal }
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
  async inspectHistory(id: string): Promise<A> {
    const row = await this.database.attempts.get(id)
    if (!row || !this.supported(row)) throw new Error('这条历史无法通过当前版本核验，原记录已保留，可导出备份。')
    return structuredClone(row.attempt)
  }
  private changeHistory(change: (current: SavedSession | undefined) => Promise<void>) {
    const key = `${this.database.name}:${this.scope}`
    const pending = (queues.get(key) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      const next = await this.database.transaction('rw', this.database.drafts, this.database.sessions, this.database.attempts, async () => {
        const current = await this.database.drafts.get(this.scope)
        const legacy = current ? undefined : await this.database.sessions.get(this.scope)
        if (this.loadFailed || this.expectedRevision === undefined) throw new LabStorageError('load', '成功读取记录后才能管理或导入历史。')
        if (storedRevision(current) !== this.expectedRevision || (!current && this.legacySnapshot !== JSON.stringify(legacy ?? null))) throw new LabStorageError('conflict', '其他标签页已更新实验，请先重新读取。')
        await change(current ?? legacy)
        const updated = await this.database.drafts.get(this.scope)
        const revision = this.expectedRevision + 1
        if (updated) await this.database.drafts.put({ ...updated, revision })
        return updated ? revision : this.expectedRevision
      })
      this.expectedRevision = next
    })
    queues.set(key, pending); return pending
  }
  archiveHistory(id: string, archived: boolean) {
    return this.changeHistory(async current => {
      const row = await this.database.attempts.get(id)
      if (!row || row.scope !== this.scope) throw new Error('历史记录不存在于本实验。')
      if (current?.activeAttemptId === id) throw new Error('当前正在使用的记录不能归档，请先核验另一份实验。')
      await this.database.attempts.update(id, { archived: archived ? 1 : 0 })
    })
  }
  deleteHistory(id: string) {
    return this.changeHistory(async current => {
      const row = await this.database.attempts.get(id)
      if (!row || row.scope !== this.scope || row.archived !== 1 || current?.activeAttemptId === id) throw new Error('只能永久删除本实验中已归档且未在使用的记录。')
      await this.database.attempts.delete(id)
    })
  }
  async exportRecords() { await queues.get(`${this.database.name}:${this.scope}`)?.catch(() => undefined); return this.database.attempts.where('scope').equals(this.scope).toArray() }
  async previewRecovery(value: unknown): Promise<BackupPreview> {
    checkBackupSize(value)
    const data = recoveryObject(value)
    if (data.format !== 'system-design-lab-recovery' || ![1, 2].includes(data.version as number) || data.scope !== this.scope) throw new Error('备份格式、版本或实验范围不匹配。')
    if (data.versions && (!validVersions(data.versions) || this.contract.versions && !sameVersions(data.versions, this.contract.versions))) throw new Error('备份的模型或评分版本不匹配；请使用兼容版本恢复。')
    if (!data.versions && this.contract.versions && (this.contract.versions.definition !== 1 || this.contract.versions.assessment !== 1)) throw new Error('旧备份没有当前版本需要的兼容信息。')
    const draft = this.contract.parseDraft(migrateDraft(data.draft, (data.draftVersion ?? 1) as number, this.contract.draftVersion ?? 1, this.contract.draftMigrations))
    let source = data.records
    if (data.version === 1) {
      const persisted = data.persistedSource as { loaded?: { attempts?: unknown[] } } | undefined
      source = [...(persisted?.loaded?.attempts ?? []), ...(Array.isArray(data.retained) ? data.retained : []), ...(Array.isArray(data.attempts) ? data.attempts.map(attempt => ({ id: (attempt as AttemptIdentity).id, scope: this.scope, attempt })) : [])]
    }
    if (!Array.isArray(source) || source.length > 10000) throw new Error('备份历史数量或格式无效。')
    const rows = new Map<string, SavedAttempt>(); let retained = 0
    for (const candidate of source) {
      const row = recoveryObject(candidate) as unknown as SavedAttempt
      if (typeof row.id !== 'string' || !row.id || row.scope !== this.scope || !Object.hasOwn(row, 'attempt')) throw new Error('备份包含无效或跨实验记录。')
      const previous = rows.get(row.id)
      if (previous && !same(previous.attempt, row.attempt)) throw new Error('备份内存在同名但内容不同的历史。')
      if (previous) continue
      if (!this.supported(row)) retained++
      rows.set(row.id, structuredClone(row))
      if (rows.size % 5 === 0) await new Promise(resolve => setTimeout(resolve, 0))
    }
    const active = data.activeAttemptId
    if (active !== null && (typeof active !== 'string' || !rows.has(active))) throw new Error('备份当前结果指向的记录缺失。')
    const backups = data.draftBackups ?? (data.persistedSource as { draftBackups?: unknown } | undefined)?.draftBackups ?? []
    if (!Array.isArray(backups) || backups.length > 10000 || backups.some(item => { const b = recoveryObject(item); return !Number.isSafeInteger(b.draftVersion) || (b.draftVersion as number) < 1 || !Number.isSafeInteger(b.revision) || !Object.hasOwn(b, 'draft') || b.versions !== null && !validVersions(b.versions) })) throw new Error('原稿备份元数据无效。')
    return { records: rows.size, retained, draft, data: { draft, activeAttemptId: active, rows: [...rows.values()], backups: structuredClone(backups) } }
  }
  async importRecovery(preview: BackupPreview, currentDraft: D) {
    // Revalidate at the public write boundary, even when the UI already showed a preview.
    const payload = recoveryObject(preview.data)
    const checked = await this.previewRecovery({ format: 'system-design-lab-recovery', version: 2, scope: this.scope, versions: this.contract.versions, draftVersion: this.contract.draftVersion ?? 1, draft: payload.draft, activeAttemptId: payload.activeAttemptId, records: payload.rows, draftBackups: payload.backups })
    const input = checked.data as { draft: D; activeAttemptId: string | null; rows: SavedAttempt[]; backups: DraftBackup[] }
    const preservedDraft = structuredClone(this.contract.parseDraft(currentDraft))
    await this.changeHistory(async current => {
      for (const row of input.rows) {
        const existing = await this.database.attempts.get(row.id)
        if (existing && (existing.scope !== this.scope || !same(existing.attempt, row.attempt) || !same(existing.versions, row.versions) || existing.storageVersion !== row.storageVersion)) throw new Error('同名历史内容或来源版本不同，已拒绝整个导入，原记录未变。')
        if (!existing) await this.database.attempts.add(row)
      }
      const draftBackups = [...this.draftBackups, ...input.backups, { draftVersion: this.contract.draftVersion ?? 1, versions: this.contract.versions ?? null, draft: preservedDraft, revision: current?.revision ?? 0 }]
      if (current && !same(current.draft, preservedDraft)) draftBackups.push({ draftVersion: current.draftVersion ?? 1, versions: current.versions ?? null, draft: structuredClone(current.draft), revision: current.revision ?? 0 })
      await this.database.drafts.put({ scope: this.scope, version: 2, revision: current?.revision ?? 0, draftVersion: this.contract.draftVersion ?? 1, ...(this.contract.versions ? { versions: this.contract.versions } : {}), draft: input.draft, activeAttemptId: input.activeAttemptId, draftBackups })
    })
    await this.load()
  }
}
