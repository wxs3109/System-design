import { experiments } from '../../experiments/registry'
export const productDesigns = experiments.entries.filter(e => e.kind === 'product-design').map(e => e.definition)
export const getProductDesign = (id: string) => productDesigns.find(d => d.id === id)
