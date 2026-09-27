export interface ExperimentVersions {
  model: string
  definition: number
  assessment: number
}
export const sameVersions = (a: ExperimentVersions, b: ExperimentVersions) => a.model === b.model && a.definition === b.definition && a.assessment === b.assessment
