import { AlgorithmDatabase, LabRepository } from '../../../core/experiments/repository'
import { LabSession } from '../../../core/experiments/session'
import { initialDraft, parseDraft, runAttempt, verifyAttempt, type RetryAttempt, type RetryDraft } from './lesson'

export const retryContract = { versions: { model: 'request-retry-v1', definition: 1, assessment: 1 }, draftVersion: 1, initial: initialDraft, parseDraft, runAttempt, verifyAttempt }
export class RetryRepository extends LabRepository<RetryDraft, RetryAttempt> {
  constructor(database = new AlgorithmDatabase(), scope = 'retry-idempotency:v1') { super(database, scope, retryContract) }
}
export class RetrySession extends LabSession<RetryDraft, RetryAttempt> {
  constructor(repository = new RetryRepository()) { super(repository) }
}
