import type { ProjectFile, ProjectFileV2, Scenario, SimulationProgress, SimulationResult } from '@system-design/model'

export interface RunSimulationMessage {
  type: 'run'
  id: string
  scenario: Scenario | ProjectFileV2 | ProjectFile
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

export interface SimulationProgressMessage {
  type: 'progress'
  id: string
  progress: SimulationProgress
}

export type SimulationWorkerResponse = SimulationSuccessMessage | SimulationErrorMessage | SimulationProgressMessage
