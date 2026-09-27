import { experiments } from '../../experiments/registry'
import { conceptsForLab } from '../learning/catalog'

export const practiceCatalog = experiments.entries.filter(e => e.kind !== 'design' && e.kind !== 'product-design').map(e => ({ ...e.metadata, conceptIds: conceptsForLab(e.metadata.id).map(c => c.id) }))
export const getPracticeEntry = (id: string) => experiments.get(id)?.metadata
