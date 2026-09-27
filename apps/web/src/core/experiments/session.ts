import type { AttemptIdentity, ExperimentRepository } from './contracts'
import { LabStorageError } from './errors'
import { ExecutionCoordinator } from './execution'
import { checkBackupSize, type BackupPreview } from './history'

interface Editable<D> { draft: D; activeAttemptId: string | null }
export interface LabSessionState<D, A> extends Editable<D> {
  attempts: A[]
  ready: boolean
  running: boolean
  executionError: string
  storage: 'loading' | 'saving' | 'saved' | 'error'
  error: string
  errorKind: 'load' | 'save' | 'conflict' | null
  rejected: number
  retained: unknown[]
  historyTotal: number
  undoCount: number
  redoCount: number
}
/** Execution owns its input revision; storage results own their save revision.
 * Same-turn automatic edits share a write; explicit saves flush immediately.
 */
export class LabSession<D, A extends AttemptIdentity & { draft: D }> {
  private state: LabSessionState<D, A>
  private listeners = new Set<() => void>()
  private past: Editable<D>[] = []
  private future: Editable<D>[] = []
  private revision = 0
  private persistedAttempts = new Set<string>()
  private loading: Promise<void> | null = null
  private scheduledSave: object | null = null
  private readonly execution = new ExecutionCoordinator()
  constructor(readonly repository: ExperimentRepository<D, A>) {
    this.state = { draft: repository.contract.initial(), activeAttemptId: null, attempts: [], ready: false, running: false, executionError: '', storage: 'loading', error: '', errorKind: null, rejected: 0, retained: [], historyTotal: 0, undoCount: 0, redoCount: 0 }
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  getSnapshot = () => this.state
  private publish(patch: Partial<LabSessionState<D, A>>) {
    this.state = { ...this.state, ...patch, undoCount: this.past.length, redoCount: this.future.length }
    this.listeners.forEach((listener) => listener())
  }
  load() { return this.read(false) }
  /** Explicit user recovery action: replace local unsaved edits with the stored revision. */
  reload() { return this.read(true) }
  private read(force: boolean) {
    if (this.loading) return this.loading
    if (this.state.ready && !force) return Promise.resolve()
    this.scheduledSave = null
    const revision = ++this.revision
    this.execution.cancel()
    this.publish({ ready: false, running: false, executionError: '', storage: 'loading', error: '', errorKind: null })
    this.loading = this.repository.load().then((saved) => {
      if (revision !== this.revision) return
      this.persistedAttempts = new Set(saved.attempts.map((attempt) => attempt.id))
      this.past = []; this.future = []
      this.publish({ draft: saved.draft ?? this.repository.contract.initial(), activeAttemptId: saved.activeAttemptId, attempts: saved.attempts, rejected: saved.rejected, retained: saved.retained ?? [], historyTotal: saved.historyTotal ?? saved.attempts.length, ready: true, storage: 'saved', error: '', errorKind: null })
    }).catch((error: unknown) => {
      if (revision === this.revision) this.publish({ ready: false, storage: 'error', errorKind: 'load', error: error instanceof Error ? error.message : '无法恢复本地实验。' })
    }).finally(() => { this.loading = null })
    return this.loading
  }
  edit(draft: D) {
    if (!this.state.ready) return
    const parsed = this.repository.contract.parseDraft(draft)
    this.execution.cancel()
    this.past = [...this.past.slice(-99), { draft: this.state.draft, activeAttemptId: this.state.activeAttemptId }]
    this.future = []
    this.publish({ draft: parsed, running: false, executionError: '' })
    this.scheduleSave()
  }
  undo() {
    if (!this.state.ready) return
    const previous = this.past.pop()
    if (!previous) return
    this.execution.cancel()
    this.future.push({ draft: this.state.draft, activeAttemptId: this.state.activeAttemptId })
    this.publish({ ...previous, running: false, executionError: '' })
    this.scheduleSave()
  }
  redo() {
    if (!this.state.ready) return
    const next = this.future.pop()
    if (!next) return
    this.execution.cancel()
    this.past.push({ draft: this.state.draft, activeAttemptId: this.state.activeAttemptId })
    this.publish({ ...next, running: false, executionError: '' })
    this.scheduleSave()
  }
  run() {
    if (!this.state.ready) return
    const lease = this.execution.begin()
    this.publish({ executionError: '' })
    try {
      if (this.state.attempts.filter(a => !this.persistedAttempts.has(a.id)).length >= 20) throw new Error('已有 20 条未保存结果，请先重试保存或导出恢复文件，再继续运行。')
      const attempt = this.repository.contract.runAttempt(structuredClone(this.state.draft))
      if (!lease.isCurrent()) return
      this.publish({ attempts: [attempt, ...this.state.attempts], activeAttemptId: attempt.id, running: false })
      this.scheduleSave()
    } catch (cause) { this.publish({ executionError: cause instanceof Error ? cause.message : '实验计算失败。' }); throw cause }
    finally { lease.finish() }
  }
  /** Async/worker adapters share the same ownership rule; stale completions cannot replace a newer draft. */
  async runAsync(execute: (draft: D, signal: AbortSignal) => Promise<A>) {
    if (!this.state.ready) return
    const draft = structuredClone(this.state.draft)
    const key = JSON.stringify(draft)
    const lease = this.execution.begin(() => this.state.ready && JSON.stringify(this.state.draft) === key)
    this.publish({ running: true, executionError: '' })
    try {
      if (this.state.attempts.filter(a => !this.persistedAttempts.has(a.id)).length >= 20) throw new Error('已有 20 条未保存结果，请先重试保存或导出恢复文件，再继续运行。')
      const attempt = await execute(draft, lease.signal)
      if (!lease.isCurrent()) return
      if (JSON.stringify(attempt.draft) !== key || !(this.repository.contract.verifyAttemptAsync ? await this.repository.contract.verifyAttemptAsync(attempt, lease.signal) : this.repository.contract.verifyAttempt(attempt))) throw new Error('执行适配器返回的证据与输入不匹配。')
      if (!lease.isCurrent()) return
      const savedAttempt = structuredClone(attempt)
      this.publish({ attempts: [savedAttempt, ...this.state.attempts], activeAttemptId: savedAttempt.id })
      await this.save()
      return structuredClone(savedAttempt)
    } catch (cause) { if (lease.isCurrent()) { this.publish({ executionError: cause instanceof Error ? cause.message : '实验计算失败。' }); throw cause } }
    finally { if (lease.owns()) this.publish({ running: false }); lease.finish() }
  }
  cancel() { this.execution.cancel(); this.publish({ running: false }) }
  restoreAttempt(attempt: A) {
    if (!this.state.ready) return
    this.edit(attempt.draft)
    this.publish({ activeAttemptId: attempt.id })
  }
  private scheduleSave() {
    if (this.scheduledSave) return
    const task = {}; this.scheduledSave = task
    ++this.revision
    this.publish({ storage: 'saving', error: '', errorKind: null })
    // A run followed by several synchronous edits must not clone the same large
    // evidence for every intermediate state. Explicit save/reload supersedes this task.
    void Promise.resolve().then(() => { if (this.scheduledSave === task) return this.save() })
  }
  async save() {
    this.scheduledSave = null
    if (!this.state.ready) return
    const revision = ++this.revision
    this.publish({ storage: 'saving', error: '', errorKind: null })
    // Editing a reflection should not clone/rewrite every historical result.
    const pending = this.state.attempts.filter((attempt) => !this.persistedAttempts.has(attempt.id))
    try {
      await this.repository.save(this.state.draft, this.state.activeAttemptId, pending)
      const added = pending.filter(attempt => !this.persistedAttempts.has(attempt.id)).length
      pending.forEach((attempt) => this.persistedAttempts.add(attempt.id))
      this.publish({ attempts: this.state.attempts.filter((a, index) => index < 20 || a.id === this.state.activeAttemptId || !this.persistedAttempts.has(a.id)), historyTotal: this.state.historyTotal + added, ...(revision === this.revision ? { storage: 'saved' as const, errorKind: null } : {}) })
    } catch (error) {
      if (revision === this.revision) {
        const errorKind = error instanceof LabStorageError ? error.kind : 'save'
        this.publish({ storage: 'error', errorKind, ready: errorKind === 'save', error: error instanceof Error ? error.message : '本地保存失败。' })
      }
    }
  }
  recoverySnapshot() {
    return structuredClone({ format: 'system-design-lab-recovery', version: 1, scope: this.repository.scope, capturedAt: new Date().toISOString(), draft: this.state.draft, activeAttemptId: this.state.activeAttemptId, attempts: this.state.attempts, retained: this.state.retained, persistedSource: this.repository.recoveryData?.() ?? null, unsavedAttemptIds: this.state.attempts.filter((a) => !this.persistedAttempts.has(a.id)).map((a) => a.id) })
  }
  historyPage(page: number, archived: boolean) { if (!this.repository.historyPage) throw new Error('此存储不支持历史分页。'); return this.repository.historyPage(page, archived) }
  async inspectHistory(id: string) {
    if (!this.state.ready || !this.repository.inspectHistory) throw new Error('请先恢复当前实验。')
    const revision = this.revision
    const attempt = await this.repository.inspectHistory(id)
    if (!this.state.ready || revision !== this.revision) throw new Error('当前草稿已改变，请重新选择要恢复的历史。')
    // Keep a bounded working set; unloaded records remain in the database.
    this.persistedAttempts.add(id)
    this.publish({ attempts: [attempt, ...this.state.attempts.filter(a => a.id !== id)].slice(0, 20) })
    this.restoreAttempt(attempt); await this.save()
  }
  async archiveHistory(id: string, archived: boolean) {
    await this.save(); if (!this.state.ready || this.state.storage === 'error') throw new Error('请先解决保存问题。')
    await this.repository.archiveHistory?.(id, archived)
    this.publish({ attempts: this.state.attempts.filter(a => a.id !== id), historyTotal: (await this.historyPage(0, false)).total })
  }
  async deleteHistory(id: string) {
    await this.save(); if (!this.state.ready || this.state.storage === 'error') throw new Error('请先解决保存问题。')
    await this.repository.deleteHistory?.(id)
    this.publish({ attempts: this.state.attempts.filter(a => a.id !== id) })
  }
  async exportRecovery() {
    const records = await this.repository.exportRecords?.() ?? []
    const byId = new Map(records.map(record => [(record as { id: string }).id, record]))
    for (const attempt of this.state.attempts) if (!byId.has(attempt.id)) byId.set(attempt.id, { id: attempt.id, scope: this.repository.scope, storageVersion: 2, versions: this.repository.contract.versions, attempt })
    const backup = { ...this.recoverySnapshot(), version: 2, draftVersion: this.repository.contract.draftVersion ?? 1, versions: this.repository.contract.versions, records: [...byId.values()] }
    checkBackupSize(backup); return structuredClone(backup)
  }
  async exportHistory(id: string) {
    if (!this.repository.exportRecords) throw new Error('此存储不支持历史导出。')
    const records = await this.repository.exportRecords([id])
    const backup = { format: 'system-design-lab-recovery', version: 2, scope: this.repository.scope, draftVersion: this.repository.contract.draftVersion ?? 1, versions: this.repository.contract.versions, draft: this.state.draft, activeAttemptId: null, records }
    checkBackupSize(backup); return backup
  }
  previewRecovery(value: unknown) { if (!this.repository.previewRecovery) throw new Error('此存储不支持备份导入。'); return this.repository.previewRecovery(value) }
  async importRecovery(preview: BackupPreview) {
    if (!this.state.ready || !this.repository.importRecovery) throw new Error('请先成功读取本地实验，再导入备份。')
    this.cancel(); this.scheduledSave = null; ++this.revision
    const draft = this.state.draft
    this.publish({ ready: false })
    try { await this.repository.importRecovery(preview, draft); await this.reload() }
    catch (cause) { this.publish({ ready: true }); throw cause }
  }
}
