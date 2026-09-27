import { AlgorithmDatabase, LabRepository } from '../../../core/experiments/repository'
import { LabSession } from '../../../core/experiments/session'
import { initialDraft, parseDraft, runAttempt, verifyAttempt, type RetryAttempt, type RetryDraft } from './lesson'

export const retryContract = { initial: initialDraft, parseDraft, runAttempt, verifyAttempt }
export class RetryRepository extends LabRepository<RetryDraft, RetryAttempt> {
  constructor(database = new AlgorithmDatabase(), scope = 'retry-idempotency:v1') { super(database, scope, retryContract) }
}
export class RetrySession extends LabSession<RetryDraft, RetryAttempt> {
  constructor(repository = new RetryRepository()) { super(repository) }
}
