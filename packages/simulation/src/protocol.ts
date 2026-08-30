import type { Scenario, SimulationResult } from '@system-design/model'

export interface RunSimulationMessage {
  type: 'run'
  id: string
  scenario: Scenario
}

export interface CancelSimulationMessage {
  type: 'cancel'
  id: string
}

export type SimulationWorkerRequest = RunSimulationMessage | CancelSimulationMessage

export interface SimulationSuccessMessage {
  type: 'result'
  id: string
  result: SimulationResult
}

export interface SimulationErrorMessage {
  type: 'error'
  id: string
  error: {
    name: string
    message: string
    problems?: string[]
  }
}

export type SimulationWorkerResponse = SimulationSuccessMessage | SimulationErrorMessage
