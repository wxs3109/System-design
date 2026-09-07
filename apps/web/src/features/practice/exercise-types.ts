import type { ProjectFile, SimulationResult } from '@system-design/model'

export type ExerciseCheckStatus = 'pass' | 'fail' | 'inconclusive'
export interface ExerciseCheck { id: string; label: string; status: ExerciseCheckStatus; message: string; actual?: number; expected?: number | string }
export type ExerciseMetrics = Record<string, number | undefined>
export interface ExerciseEvaluation { status: ExerciseCheckStatus; summary: string; checks: ExerciseCheck[]; metrics: ExerciseMetrics }

export interface ExerciseParameter {
  id: string
  nodeId: string
  field: string
  label: string
  unit: string
  choices: readonly { value: number; label: string }[]
}

export interface ExerciseMetricDisplay {
  key: string
  label: string
  unit?: string
  format?: 'number' | 'percent'
}

/** Authored lesson data describes the UI; evaluation consumes ordinary run evidence. */
export interface ExerciseDefinition {
  id: string
  version: number
  title: string
  summary: string
  category: string
  difficulty: string
  estimatedMinutes: number
  introduction: string
  givens: readonly { label: string; value: string; unit?: string }[]
  flow: readonly string[]
  prompt: string
  objectives: readonly string[]
  observationNote: string
  parameters: readonly ExerciseParameter[]
  focusNodeId: string
  hints: readonly string[]
  boundary: string
  resultMetrics: readonly ExerciseMetricDisplay[]
  attemptMetric: ExerciseMetricDisplay
  createProject: (projectId?: string) => ProjectFile
  evaluate: (projectSnapshot: ProjectFile, result?: SimulationResult) => ExerciseEvaluation
}
