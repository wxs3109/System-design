import { describe, expect, it } from 'vitest'
import { createEmptyScenario, type SimulationResult } from '@system-design/model'
import { SimulationWorkerClient, type WorkerLike } from './client'
import type { SimulationWorkerRequest, SimulationWorkerResponse } from './protocol'

class FakeWorker implements WorkerLike {
  onmessage: ((event: MessageEvent<SimulationWorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  messages: SimulationWorkerRequest[] = []
  terminated = false
  postMessage(message: SimulationWorkerRequest) { this.messages.push(message) }
  terminate() { this.terminated = true }
  send(message: SimulationWorkerResponse) { this.onmessage?.({ data: message } as MessageEvent<SimulationWorkerResponse>) }
  fail(message: string) { this.onerror?.({ message } as ErrorEvent) }
}

const result = (): SimulationResult => ({
  runId: 'worker-placeholder', scenarioId: 'test', seed: 'seed', simulatedDurationMs: 1, wallClockDurationMs: 1,
  summary: { generatedRequests: 0, completedRequests: 0, failedRequests: 0, throughputPerSecond: 0, errorRate: 0, latencyP50Ms: 0, latencyP95Ms: 0, latencyP99Ms: 0 },
  nodes: [], operations: [], actions: [], timeSeries: [], traces: [], events: [], spans: [], warnings: [],
})

describe('SimulationWorkerClient', () => {
  it('terminates on cancel, ignores stale messages and runs again', async () => {
    const workers: FakeWorker[] = []
    const client = new SimulationWorkerClient(() => { const worker = new FakeWorker(); workers.push(worker); return worker })
    const first = client.run(createEmptyScenario(), { runId: 'run-1' })
    const staleHandler = workers[0]!.onmessage
    expect(client.cancelActive()).toBe(true)
    await expect(first).rejects.toMatchObject({ name: 'AbortError' })
    expect(workers[0]!.terminated).toBe(true)

    const second = client.run(createEmptyScenario(), { runId: 'run-2' })
    staleHandler?.({ data: { type: 'result', id: 'run-1', result: result() } } as MessageEvent<SimulationWorkerResponse>)
    expect(client.activeRunId).toBe('run-2')
    workers[1]!.send({ type: 'result', id: 'run-2', result: result() })
    await expect(second).resolves.toMatchObject({ runId: 'run-2' })
  })

  it('cancels through AbortSignal and cleans up worker errors', async () => {
    const workers: FakeWorker[] = []
    const client = new SimulationWorkerClient(() => { const worker = new FakeWorker(); workers.push(worker); return worker })
    const controller = new AbortController()
    const cancelled = client.run(createEmptyScenario(), { signal: controller.signal, runId: 'abort' })
    controller.abort()
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' })
    expect(workers[0]!.terminated).toBe(true)

    const failed = client.run(createEmptyScenario(), { runId: 'error' })
    workers[1]!.fail('worker exploded')
    await expect(failed).rejects.toThrow('worker exploded')
    expect(client.activeRunId).toBeNull()
  })

  it('ignores a response whose run id does not match the active session', async () => {
    const worker = new FakeWorker()
    const client = new SimulationWorkerClient(() => worker)
    const pending = client.run(createEmptyScenario(), { runId: 'current' })
    worker.send({ type: 'result', id: 'stale', result: result() })
    expect(client.activeRunId).toBe('current')
    worker.send({ type: 'result', id: 'current', result: result() })
    await expect(pending).resolves.toMatchObject({ runId: 'current' })
  })

  it('cleans up when postMessage cannot start a run', async () => {
    const worker = new FakeWorker()
    worker.postMessage = () => { throw new Error('clone failed') }
    const client = new SimulationWorkerClient(() => worker)
    await expect(client.run(createEmptyScenario(), { runId: 'start-error' })).rejects.toThrow('clone failed')
    expect(worker.terminated).toBe(true)
    expect(client.activeRunId).toBeNull()
  })

  it('delivers progress batches without settling the active run', async () => {
    const worker = new FakeWorker()
    const batches: string[] = []
    const client = new SimulationWorkerClient(() => worker)
    const pending = client.run(createEmptyScenario(), { runId: 'progress', onProgress: (progress) => batches.push(progress.runId) })
    worker.send({ type: 'progress', id: 'progress', progress: { runId: 'progress', simulatedTimeMs: 1, simulatedDurationMs: 2, generatedRequests: 1, completedRequests: 0, failedRequests: 0, events: [] } })
    expect(batches).toEqual(['progress'])
    expect(client.activeRunId).toBe('progress')
    worker.send({ type: 'result', id: 'progress', result: result() })
    await expect(pending).resolves.toMatchObject({ runId: 'progress' })
  })

  it('disposes the active session and rejects future runs', async () => {
    const worker = new FakeWorker()
    const client = new SimulationWorkerClient(() => worker)
    const active = client.run(createEmptyScenario(), { runId: 'dispose' })
    client.dispose()
    await expect(active).rejects.toThrow('disposed')
    expect(worker.terminated).toBe(true)
    await expect(client.run(createEmptyScenario())).rejects.toThrow('disposed')
  })
})
