import { AlgorithmDatabase, LabRepository } from '../../../core/experiments/repository'
import { LabSession } from '../../../core/experiments/session'
import { initialDraft, parseDraft, runAttempt, verifyAttempt, type Draft, type Attempt } from './lesson'
export class OverloadRepository extends LabRepository<Draft, Attempt> { constructor(database = new AlgorithmDatabase()) { super(database, 'overload:v1', { initial: initialDraft, parseDraft, runAttempt, verifyAttempt }) } }
export class OverloadSession extends LabSession<Draft, Attempt> { constructor(repository = new OverloadRepository()) { super(repository) } }
