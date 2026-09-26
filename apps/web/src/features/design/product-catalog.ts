import { newsFeedDesign } from './news-feed'
import { objectStorageDesign } from './object-storage'
import type { ProductDesign } from './product-types'

export const productDesigns: readonly ProductDesign[] = [newsFeedDesign, objectStorageDesign]
export const getProductDesign = (id: string) => productDesigns.find((d) => d.id === id)
