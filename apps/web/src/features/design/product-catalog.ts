import { newsFeedDesign } from './news-feed'
import { objectStorageDesign } from './object-storage'
import { mapsDesign } from './maps'
import type { ProductDesign } from './product-types'

export const productDesigns: readonly ProductDesign[] = [newsFeedDesign, objectStorageDesign, mapsDesign]
export const getProductDesign = (id: string) => productDesigns.find((d) => d.id === id)
