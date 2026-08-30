import { describe, expect, it } from 'vitest'
import { estimateDataAccessCost, sampleKey } from './operation-cost'

const access = { modelId: 'model@1', modelKind: 'relational' as const, objectId: 'orders', operation: 'point-read' as const, estimatedRows: 1, cardinality: 1_000_000, recordBytes: 512 }

describe('operation cost model', () => {
  it('makes scans more expensive than selective indexed and point access', () => {
    const point = estimateDataAccessCost(access, 5)
    const index = estimateDataAccessCost({ ...access, operation: 'index-read', indexId: 'ix', indexKind: 'btree', estimatedRows: 10 }, 5)
    const scan = estimateDataAccessCost({ ...access, operation: 'scan', estimatedRows: 10 }, 5)
    expect(point.recordsExamined).toBe(1)
    expect(index.recordsExamined).toBeLessThan(scan.recordsExamined)
    expect(index.serviceTimeMs).toBeLessThan(scan.serviceTimeMs)
    expect(scan.explanation).toContain('all 1000000 records')
  })

  it('samples hotspot keys deterministically and concentrates their traffic', () => {
    const values = [0.1, 0.25, 0.9, 0.5]
    let index = 0
    const random = () => values[index++ % values.length]!
    const distribution = { kind: 'hotspot' as const, keySpaceSize: 100, hotKeyCount: 2, hotTrafficFraction: 0.8 }
    expect(sampleKey(distribution, random, 1)).toBe('key:0')
    expect(sampleKey(distribution, random, 2)).toBe('key:51')
  })
})

