import { quantileSorted } from 'simple-statistics'

export const percentile = (values: number[], probability: number) => values.length === 0 ? 0 : quantileSorted(values, probability)
export const round = (value: number, digits = 3) => { const scale = 10 ** digits; return Math.round(value * scale) / scale }
