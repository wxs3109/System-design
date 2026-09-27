'use client'
import { ProductStudio } from '../product-studio'
import { dispatchDesign } from '../dispatch'
export default function Entry() { return <ProductStudio design={dispatchDesign} /> }
