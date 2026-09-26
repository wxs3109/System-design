import { LabSession } from '../algorithm/session'
import { AlgorithmRepository } from './repository'
import type { Draft, AlgorithmAttempt } from './lesson'
export type AlgorithmSessionState = import('../algorithm/session').LabSessionState<Draft, AlgorithmAttempt>
export class AlgorithmSession extends LabSession<Draft, AlgorithmAttempt> {
  constructor(repository = new AlgorithmRepository()) { super(repository) }
}
