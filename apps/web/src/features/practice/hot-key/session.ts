import { AlgorithmDatabase, LabRepository } from '../../../core/experiments/repository'
import { LabSession } from '../../../core/experiments/session'
import { hotChallenge, parseHotDraft, runHotAttempt, verifyHotAttempt, type HotAttempt, type HotDraft } from './lesson'

export const hotContract = { versions: { model: 'hot-key-v1', definition: 1, assessment: 1 }, draftVersion: 1, initial: hotChallenge, parseDraft: parseHotDraft, runAttempt: runHotAttempt, verifyAttempt: verifyHotAttempt }
export class HotRepository extends LabRepository<HotDraft, HotAttempt> {
  constructor(database = new AlgorithmDatabase(), scope = 'hot-key:v1') { super(database, scope, hotContract) }
}
export class HotSession extends LabSession<HotDraft, HotAttempt> {
  constructor(repository = new HotRepository()) { super(repository) }
}
