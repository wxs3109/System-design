import type { ComponentType, ProjectFile } from '@system-design/model'
import type { ExerciseDefinition } from '../practice/exercise-types'

export interface DesignTool {
  type: ComponentType
  label: string
  limit: number
  fields: readonly { key: string; label: string; values: readonly number[] }[]
  create: (id: string, index: number) => ProjectFile['topology']['nodes'][number]
}

/** A product brief is broader than the explicitly assessed executable slice. */
export interface DesignExercise extends ExerciseDefinition {
  kind: 'design'
  pains: readonly string[]
  requirements: readonly string[]
  contracts: readonly { name: string; description: string }[]
  decisions: readonly string[]
  exclusions: readonly string[]
  relatedLabs: readonly { id: string; title: string }[]
  tools: readonly DesignTool[]
  sourceId: string
  presets: readonly { id: string; title: string; description: string; create: (projectId: string) => ProjectFile }[]
  /** Checks editable vocabulary/budgets, independently of whether the graph is solved. */
  editIssue: (project: ProjectFile) => string | undefined
}
