import type { Scenario, SimulationResult } from '@system-design/model'
import type { SimulationWorkerRequest, SimulationWorkerResponse } from './protocol'

interface PendingRun {
  resolve: (result: SimulationResult) => void
  reject: (error: Error) => void
}

export class SimulationWorkerClient {
  private readonly worker: Worker
  private readonly pending = new Map<string, PendingRun>()

  constructor(worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })) {
    this.worker = worker
    this.worker.onmessage = this.onMessage
    this.worker.onerror = this.onWorkerError
  }

  run(scenario: Scenario): Promise<SimulationResult> {
    const id = crypto.randomUUID()
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      const message: SimulationWorkerRequest = { type: 'run', id, scenario }
      this.worker.postMessage(message)
    })
  }

  cancel(id: string) {
    const message: SimulationWorkerRequest = { type: 'cancel', id }
    this.worker.postMessage(message)
    const pending = this.pending.get(id)
    if (pending) {
      pending.reject(new DOMException('Simulation cancelled.', 'AbortError'))
      this.pending.delete(id)
    }
  }

  dispose() {
    this.worker.onmessage = null
    this.worker.onerror = null
    this.worker.terminate()
    for (const pending of this.pending.values()) pending.reject(new Error('Simulation worker disposed.'))
    this.pending.clear()
  }

  private onMessage = (event: MessageEvent<SimulationWorkerResponse>) => {
    const message = event.data
    const pending = this.pending.get(message.id)
    if (!pending) return
    this.pending.delete(message.id)
    if (message.type === 'result') pending.resolve(message.result)
    else pending.reject(new Error(message.error))
  }

  private onWorkerError = (event: ErrorEvent) => {
    for (const pending of this.pending.values()) pending.reject(new Error(event.message || 'Simulation worker failed.'))
    this.pending.clear()
  }
}
