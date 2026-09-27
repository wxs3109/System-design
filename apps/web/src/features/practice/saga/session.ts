import { AlgorithmDatabase, LabRepository } from '../../../core/experiments/repository'
import { LabSession } from '../../../core/experiments/session'
import { initialDraft, parseDraft, runAttempt, verifyAttempt, type Attempt, type Draft } from './lesson'
export class SagaRepository extends LabRepository<Draft, Attempt> { constructor(database = new AlgorithmDatabase()) { super(database, 'saga-recovery:v1', { initial: initialDraft, parseDraft, runAttempt, verifyAttempt }) } }
export class SagaSession extends LabSession<Draft, Attempt> { constructor(repository = new SagaRepository()) { super(repository) } }
