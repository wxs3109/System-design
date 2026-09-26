import { AlgorithmDatabase, LabRepository } from '../algorithm/repository'
import { LabSession } from '../algorithm/session'
import { initialDraft, parseDraft, runAttempt, verifyAttempt, type Attempt, type Draft, type LabId } from './lesson'

export class MessageRepository extends LabRepository<Draft, Attempt> {
  constructor(id: LabId, database = new AlgorithmDatabase()) {
    super(database, `${id}:v1`, { initial: () => initialDraft(id), parseDraft: (value) => parseDraft(value, id), runAttempt: (draft) => runAttempt(draft, id), verifyAttempt: (value): value is Attempt => verifyAttempt(value, id) })
  }
}
export class MessageSession extends LabSession<Draft, Attempt> {
  constructor(id: LabId, repository = new MessageRepository(id)) { super(repository) }
}
