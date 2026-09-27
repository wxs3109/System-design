export interface ExperimentWorker {
  onmessage: ((event: MessageEvent) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  postMessage(value: unknown): void
  terminate(): void
}
/** One bounded computation per worker. Abort, failure and timeout always release it. */
export function executeWorker<T>(create: () => ExperimentWorker, input: unknown, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutMs = options.timeoutMs ?? 5000
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30000) { reject(new Error('实验运行预算无效。')); return }
    if (options.signal?.aborted) { reject(new DOMException('实验已取消。', 'AbortError')); return }
    const worker = create(); let settled = false
    const finish = (error: Error | null, result?: T) => {
      if (settled) return; settled = true
      clearTimeout(timer); options.signal?.removeEventListener('abort', abort)
      worker.onmessage = null; worker.onerror = null; worker.terminate()
      if (error) reject(error); else resolve(result as T)
    }
    const abort = () => finish(new DOMException('实验已取消。', 'AbortError'))
    const timer = setTimeout(() => finish(new Error('实验计算超过时间预算，已停止；输入保留，可以减少数据后重试。')), timeoutMs)
    options.signal?.addEventListener('abort', abort, { once: true })
    if (options.signal?.aborted) { abort(); return }
    worker.onmessage = event => {
      const response = event.data as { ok?: boolean; result?: T; error?: string } | null
      if (response?.ok === true) finish(null, response.result)
      else finish(new Error(typeof response?.error === 'string' ? response.error : '实验计算返回了无效结果。'))
    }
    worker.onerror = event => finish(new Error(event.message || '实验计算失败。'))
    try { worker.postMessage(input) } catch (cause) { finish(cause instanceof Error ? cause : new Error('无法启动实验。')) }
  })
}
