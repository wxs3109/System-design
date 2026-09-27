import { executeWorker } from '../../../core/experiments/worker-execution'
import { runHotAttempt, verifyHotAttempt, type HotAttempt, type HotDraft } from './lesson'
const create = () => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
export const runHotWorker = (draft: HotDraft, signal?: AbortSignal) => typeof Worker === 'undefined' ? Promise.resolve(runHotAttempt(draft)) : executeWorker<HotAttempt>(create, { operation: 'run', value: draft }, signal ? { signal } : {})
export const verifyHotWorker = (attempt: unknown, signal?: AbortSignal) => typeof Worker === 'undefined' ? Promise.resolve(verifyHotAttempt(attempt)) : executeWorker<boolean>(create, { operation: 'verify', value: attempt }, signal ? { signal } : {})
