import { describe, expect, it } from 'vitest'
import type { ComparisonChartPoint } from './comparison-chart'

describe('comparison chart contract', () => {
  it('retains aligned absolute values and their signed delta', () => {
    const point: ComparisonChartPoint = { timeSeconds: 1, baseline: 10, candidate: 13, delta: 3 }
    expect(point.candidate - point.baseline).toBe(point.delta)
  })
})
