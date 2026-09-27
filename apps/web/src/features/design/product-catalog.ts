import { newsFeedDesign } from './news-feed'
import { objectStorageDesign } from './object-storage'
import { mapsDesign } from './maps'
import { dispatchDesign } from './dispatch'
import { cloudDriveDesign } from './cloud-drive'
import type { ProductDesign } from './product-types'

export const productDesigns: readonly ProductDesign[] = [newsFeedDesign, objectStorageDesign, mapsDesign, dispatchDesign, cloudDriveDesign]
export const getProductDesign = (id: string) => productDesigns.find((d) => d.id === id)
