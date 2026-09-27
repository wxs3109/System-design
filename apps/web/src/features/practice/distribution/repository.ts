import { challenge, parseDraft, runAttempt, verifyAttempt } from './lesson'
import { AlgorithmDatabase, LabRepository } from '../../../core/experiments/repository'

export { AlgorithmDatabase } from '../../../core/experiments/repository'
export const algorithmScope = 'consistent-hashing:v1'
export const hashingContract = { initial: challenge, parseDraft, runAttempt, verifyAttempt }
export class AlgorithmRepository extends LabRepository<ReturnType<typeof challenge>, ReturnType<typeof runAttempt>> {
  constructor(database = new AlgorithmDatabase(), scope = algorithmScope) { super(database, scope, hashingContract) }
}
