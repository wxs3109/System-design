import { experiments } from '../../experiments/registry'
export const publishedDesignsFor = (caseId: string) => experiments.forCase(caseId).map(e => ({ id: e.metadata.id, scope: e.scope! }))
