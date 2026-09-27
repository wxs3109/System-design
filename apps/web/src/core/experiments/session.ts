import type { AttemptIdentity, ExperimentRepository } from './contracts'
import { LabStorageError } from './errors'
import { ExecutionCoordinator } from './execution'

interface Editable<D> { draft: D; activeAttemptId: string | null }
export interface LabSessionState<D, A> extends Editable<D> {
  attempts: A[]
  ready: boolean
  running: boolean
  storage: 'loading' | 'saving' | 'saved' | 'error'
  error: string
  errorKind: 'load' | 'save' | 'conflict' | null
  rejected: number
  retained: unknown[]
  undoCount: number
  redoCount: number
}
/** Synchronous bounded execution has no in-flight computation that can replace newer input.
 * Storage is asynchronous and serialized; only the latest revision updates save status.
 */
export class LabSession<D, A extends AttemptIdentity & { draft: D }> {
  private state: LabSessionState<D, A>
  private listeners = new Set<() => void>()
  private past: Editable<D>[] = []
  private future: Editable<D>[] = []
  private revision = 0
  private persistedAttempts = new Set<string>()
  private loading: Promise<void> | null = null
  private readonly execution = new ExecutionCoordinator()
  constructor(readonly repository: ExperimentRepository<D, A>) {
    this.state = { draft: repository.contract.initial(), activeAttemptId: null, attempts: [], ready: false, running: false, storage: 'loading', error: '', errorKind: null, rejected: 0, retained: [], undoCount: 0, redoCount: 0 }
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
    const revision = ++this.revision
    this.execution.cancel()
    this.publish({ ready: false, running: false, storage: 'loading', error: '', errorKind: null })
    this.loading = this.repository.load().then((saved) => {
      if (revision !== this.revision) return
      this.persistedAttempts = new Set(saved.attempts.map((attempt) => attempt.id))
      this.past = []; this.future = []
      this.publish({ draft: saved.draft ?? this.repository.contract.initial(), activeAttemptId: saved.activeAttemptId, attempts: saved.attempts, rejected: saved.rejected, retained: saved.retained ?? [], ready: true, storage: 'saved', error: '', errorKind: null })
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
    this.publish({ draft: parsed, running: false })
    void this.save()
  }
  undo() {
    if (!this.state.ready) return
    const previous = this.past.pop()
    if (!previous) return
    this.execution.cancel()
    this.future.push({ draft: this.state.draft, activeAttemptId: this.state.activeAttemptId })
    this.publish({ ...previous, running: false })
    void this.save()
  }
  redo() {
    if (!this.state.ready) return
    const next = this.future.pop()
    if (!next) return
    this.execution.cancel()
    this.past.push({ draft: this.state.draft, activeAttemptId: this.state.activeAttemptId })
    this.publish({ ...next, running: false })
    void this.save()
  }
  run() {
    if (!this.state.ready) return
    const lease = this.execution.begin()
    try {
      const attempt = this.repository.contract.runAttempt(structuredClone(this.state.draft))
      if (!lease.isCurrent()) return
      this.publish({ attempts: [attempt, ...this.state.attempts], activeAttemptId: attempt.id, running: false })
      void this.save()
    } finally { lease.finish() }
  }
  /** Async/worker adapters share the same ownership rule; stale completions cannot replace a newer draft. */
  async runAsync(execute: (draft: D, signal: AbortSignal) => Promise<A>) {
    if (!this.state.ready) return
    const draft = structuredClone(this.state.draft)
    const key = JSON.stringify(draft)
    const lease = this.execution.begin(() => this.state.ready && JSON.stringify(this.state.draft) === key)
    this.publish({ running: true })
    try {
      const attempt = await execute(draft, lease.signal)
      if (!lease.isCurrent()) return
      if (JSON.stringify(attempt.draft) !== key || !this.repository.contract.verifyAttempt(attempt)) throw new Error('执行适配器返回的证据与输入不匹配。')
      const savedAttempt = structuredClone(attempt)
      this.publish({ attempts: [savedAttempt, ...this.state.attempts], activeAttemptId: savedAttempt.id })
      await this.save()
      return structuredClone(savedAttempt)
    } catch (cause) { if (lease.isCurrent()) throw cause }
    finally { if (lease.owns()) this.publish({ running: false }); lease.finish() }
  }
  cancel() { this.execution.cancel(); this.publish({ running: false }) }
  restoreAttempt(attempt: A) {
    if (!this.state.ready) return
    this.edit(attempt.draft)
    this.publish({ activeAttemptId: attempt.id })
    void this.save()
  }
  async save() {
    if (!this.state.ready) return
    const revision = ++this.revision
    this.publish({ storage: 'saving', error: '', errorKind: null })
    // Editing a reflection should not clone/rewrite every historical result.
    const pending = this.state.attempts.filter((attempt) => !this.persistedAttempts.has(attempt.id))
    try {
      await this.repository.save(this.state.draft, this.state.activeAttemptId, pending)
      pending.forEach((attempt) => this.persistedAttempts.add(attempt.id))
      if (revision === this.revision) this.publish({ storage: 'saved', errorKind: null })
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
}
