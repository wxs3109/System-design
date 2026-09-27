import { afterEach, expect, it, vi } from 'vitest'
import { executeWorker, type ExperimentWorker } from './worker-execution'
function worker() { return { onmessage: null, onerror: null, postMessage: vi.fn(), terminate: vi.fn() } as ExperimentWorker & { terminate: ReturnType<typeof vi.fn> } }
afterEach(() => vi.useRealTimers())
it('terminates successful and failed workers and rejects malformed results', async () => {
  const first = worker(); const success = executeWorker<number>(() => first, { input: 3 })
  first.onmessage!({ data: { ok: true, result: 6 } } as MessageEvent)
  expect(await success).toBe(6); expect(first.terminate).toHaveBeenCalledOnce(); expect(first.onmessage).toBeNull()
  const second = worker(); const failure = executeWorker(() => second, {})
  const rejected = expect(failure).rejects.toThrow('无效结果')
  second.onmessage!({ data: {} } as MessageEvent); await rejected
  expect(second.terminate).toHaveBeenCalledOnce()
})
it('bounds a hung worker, supports cancellation and ignores late messages', async () => {
  vi.useFakeTimers()
  const first = worker(); const hung = executeWorker(() => first, {}, { timeoutMs: 20 })
  const late = first.onmessage!; const rejected = expect(hung).rejects.toThrow('时间预算')
  await vi.advanceTimersByTimeAsync(20); await rejected
  late({ data: { ok: true, result: 'late' } } as MessageEvent); expect(first.terminate).toHaveBeenCalledOnce()
  const second = worker(); const abort = new AbortController(); const cancelled = executeWorker(() => second, {}, { signal: abort.signal })
  const aborted = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' }); abort.abort(); await aborted
  expect(second.terminate).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0)
})
