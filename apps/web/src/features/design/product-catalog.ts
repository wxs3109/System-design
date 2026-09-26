import { newsFeedDesign } from './news-feed'
import type { ProductDesign } from './product-types'

export const productDesigns: readonly ProductDesign[] = [newsFeedDesign]
export const getProductDesign = (id: string) => productDesigns.find((d) => d.id === id)
