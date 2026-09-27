import { AlgorithmDatabase, LabRepository } from '../../../core/experiments/repository'
import { LabSession } from '../../../core/experiments/session'
import { hotChallenge, parseHotDraft, runHotAttempt, verifyHotAttempt, type HotAttempt, type HotDraft } from './lesson'
import { runHotWorker, verifyHotWorker } from './worker-client'

export const hotContract = { versions: { model: 'hot-key-v1', definition: 1, assessment: 1 }, draftVersion: 1, initial: hotChallenge, parseDraft: parseHotDraft, runAttempt: runHotAttempt, verifyAttempt: verifyHotAttempt, verifyAttemptAsync: verifyHotWorker }
export class HotRepository extends LabRepository<HotDraft, HotAttempt> {
  constructor(database = new AlgorithmDatabase(), scope = 'hot-key:v1') { super(database, scope, hotContract) }
}
export class HotSession extends LabSession<HotDraft, HotAttempt> {
  constructor(repository = new HotRepository()) { super(repository) }
  override run() {
    if (typeof Worker === 'undefined') return super.run()
    void this.runAsync(runHotWorker).catch(() => { /* The session exposes the failure with the preserved input. */ })
  }
}
