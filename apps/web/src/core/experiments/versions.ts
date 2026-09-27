export interface ExperimentVersions {
  model: string
  definition: number
  assessment: number
}
export const sameVersions = (a: ExperimentVersions, b: ExperimentVersions) => a.model === b.model && a.definition === b.definition && a.assessment === b.assessment
export const validVersions = (value: unknown): value is ExperimentVersions => {
  const v = value as ExperimentVersions | null
  return !!v && typeof v.model === 'string' && v.model.length > 0 && [v.definition, v.assessment].every(n => Number.isSafeInteger(n) && n > 0)
}
