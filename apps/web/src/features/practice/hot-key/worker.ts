import { runHotAttempt, verifyHotAttempt, type HotDraft } from './lesson'
self.onmessage = (event: MessageEvent<{ operation: 'run' | 'verify'; value: unknown }>) => {
  try {
    if (!['run', 'verify'].includes(event.data.operation)) throw new Error('未知实验操作。')
    const result = event.data.operation === 'run' ? runHotAttempt(event.data.value as HotDraft) : verifyHotAttempt(event.data.value)
    self.postMessage({ ok: true, result })
  } catch (cause) { self.postMessage({ ok: false, error: cause instanceof Error ? cause.message : '热点实验计算失败。' }) }
}
