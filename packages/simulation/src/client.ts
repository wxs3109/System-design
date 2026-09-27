import type { ProjectFile, ProjectFileV2, Scenario, SimulationProgress, SimulationResult } from '@system-design/model'
import type { SimulationWorkerRequest, SimulationWorkerResponse } from './protocol'

export interface WorkerLike {
  onmessage: ((event: MessageEvent<SimulationWorkerResponse>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  postMessage(message: SimulationWorkerRequest): void
  terminate(): void
}

export type WorkerFactory = () => WorkerLike

const defaultWorkerFactory: WorkerFactory = () => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
const abortError = () => new DOMException('Simulation cancelled.', 'AbortError')

interface ActiveRun {
  id: string
  worker: WorkerLike
  reject: (error: Error) => void
  removeAbortListener?: () => void
  onProgress?: (progress: SimulationProgress) => void
  timeout?: ReturnType<typeof setTimeout>
}

export class SimulationWorkerClient {
  private active: ActiveRun | null = null
  private disposed = false

  constructor(private readonly createWorker: WorkerFactory = defaultWorkerFactory) {}

  get activeRunId() { return this.active?.id ?? null }

  run(scenario: Scenario | ProjectFileV2 | ProjectFile, options: { signal?: AbortSignal; runId?: string; onProgress?: (progress: SimulationProgress) => void; timeoutMs?: number } = {}): Promise<SimulationResult> {
    if (this.disposed) return Promise.reject(new Error('Simulation worker client is disposed.'))
    const timeoutMs = options.timeoutMs ?? 30000
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30000) return Promise.reject(new Error('Invalid simulation wall-clock budget.'))
    if (this.active) this.cancelActive()
    if (options.signal?.aborted) return Promise.reject(abortError())

    const id = options.runId ?? crypto.randomUUID()
    const worker = this.createWorker()
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        const current = this.active
        if (!current || current.id !== id || current.worker !== worker) return false
        current.removeAbortListener?.()
        clearTimeout(current.timeout)
        worker.onmessage = null
        worker.onerror = null
        worker.terminate()
        this.active = null
        return true
      }
      worker.onmessage = (event) => {
        const message = event.data
        if (message.id !== id || this.active?.id !== id || this.active.worker !== worker) return
        if (message.type === 'progress') {
          this.active.onProgress?.(message.progress)
          return
        }
        if (!cleanup()) return
        if (message.type === 'result') resolve({ ...message.result, runId: id })
        else {
          const error = new Error(message.error.message)
          error.name = message.error.name
          reject(error)
        }
      }
      worker.onerror = (event) => {
        if (!cleanup()) return
        reject(new Error(event.message || 'Simulation worker failed.'))
      }
      const onAbort = () => { if (this.active?.id === id) this.cancelActive() }
      const removeAbortListener = options.signal
        ? () => options.signal?.removeEventListener('abort', onAbort)
        : undefined
      options.signal?.addEventListener('abort', onAbort, { once: true })
      this.active = { id, worker, reject, ...(removeAbortListener ? { removeAbortListener } : {}), ...(options.onProgress ? { onProgress: options.onProgress } : {}) }
      this.active.timeout = setTimeout(() => {
        if (cleanup()) reject(new Error('Simulation exceeded its wall-clock budget. Input is preserved; reduce the workload and retry.'))
      }, timeoutMs)
      try {
        worker.postMessage({ type: 'run', id, scenario })
      } catch (cause) {
        cleanup()
        reject(cause instanceof Error ? cause : new Error('Failed to start simulation worker.'))
      }
    })
  }

  cancel(id: string) {
    if (this.active?.id === id) this.cancelActive()
  }

  cancelActive() {
    const active = this.active
    if (!active) return false
    active.removeAbortListener?.()
    clearTimeout(active.timeout)
    active.worker.onmessage = null
    active.worker.onerror = null
    active.worker.terminate()
    this.active = null
    active.reject(abortError())
    return true
  }

  dispose() {
    if (this.disposed) return
    const active = this.active
    if (active) {
      active.removeAbortListener?.()
      clearTimeout(active.timeout)
      active.worker.onmessage = null
      active.worker.onerror = null
      active.worker.terminate()
      this.active = null
      active.reject(new Error('Simulation worker disposed.'))
    }
    this.disposed = true
  }
}
