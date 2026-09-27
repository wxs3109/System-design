import { AlgorithmDatabase, LabRepository } from '../../../core/experiments/repository'
import { LabSession } from '../../../core/experiments/session'
import { initialDraft, parseDraft, runAttempt, verifyAttempt, type Attempt, type Draft, type LabId } from './lesson'

export class CoordinationRepository extends LabRepository<Draft, Attempt> {
  constructor(id: LabId, database = new AlgorithmDatabase()) {
    super(database, `${id}:v1`, { versions: { model: 'coordination-v1', definition: 1, assessment: 1 }, draftVersion: 1, initial: () => initialDraft(id), parseDraft: (value) => parseDraft(value, id), runAttempt: (draft) => runAttempt(draft, id), verifyAttempt: (value): value is Attempt => verifyAttempt(value, id) })
  }
}
export class CoordinationSession extends LabSession<Draft, Attempt> {
  constructor(id: LabId, repository = new CoordinationRepository(id)) { super(repository) }
}
