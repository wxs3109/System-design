import { AlgorithmDatabase, LabRepository } from '../../../core/experiments/repository'
import { LabSession } from '../../../core/experiments/session'
import { initialDraft, parseDraft, runAttempt, verifyAttempt, type Draft, type Attempt } from './lesson'
export class ConcurrentRepository extends LabRepository<Draft, Attempt> { constructor(database = new AlgorithmDatabase()) { super(database, 'concurrent-update:v1', { initial: initialDraft, parseDraft, runAttempt, verifyAttempt }) } }
export class ConcurrentSession extends LabSession<Draft, Attempt> { constructor(repository = new ConcurrentRepository()) { super(repository) } }
