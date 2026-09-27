import { describe, expect, it } from 'vitest'
import { cityPoints, cityRoads, mapsDesign, runMaps } from './maps'
import { nearby, referenceRouteCost, shortestRoute } from './geography'
import { newsFeedDesign, runNewsFeed } from './news-feed'
import { objectStorageDesign, runObjectStorage } from './object-storage'

describe('maps product design', () => {
  const safe = mapsDesign.alternatives[0]!.config
  for (const scenario of mapsDesign.scenarios) it(`verifies actual spatial/route evidence for ${scenario.id}`, () => {
    expect(scenario.check(runMaps(mapsDesign.initialConfig, scenario.script)).some((c) => !c.pass)).toBe(true)
    for (const alternative of mapsDesign.alternatives) expect(scenario.check(runMaps(alternative.config, scenario.script))).toSatisfy((checks: { pass: boolean }[]) => checks.every((c) => c.pass))
  })
  it('covers adjacent grid cells and filters candidates by exact distance', () => {
    const q = { x: 0.95, y: 0.5, radius: 0.3 }
    expect(nearby(cityPoints, q, 'grid', true).results.map((p) => p.id)).toEqual(['P1', 'P2', 'P3'])
    expect(nearby(cityPoints, q, 'cell', true).results.map((p) => p.id)).toEqual(['P1'])
    expect(nearby(cityPoints, q, 'grid', false).results.map((p) => p.id)).toContain('P5')
    expect(nearby([{ id: 'negative', x: -0.1, y: 0 }], { x: 0.1, y: 0, radius: 0.2 }, 'grid', true).results).toHaveLength(1)
  })
  it('computes known paths and matches an independent exhaustive oracle', () => {
    const nodes = ['A', 'B', 'C', 'D', 'E', 'F']; const roads = structuredClone(cityRoads)
    expect(shortestRoute(nodes, roads, 'A', 'F')).toMatchObject({ path: ['A', 'B', 'C', 'F'], minutes: 6 })
    roads[1]!.open = false
    expect(shortestRoute(nodes, roads, 'A', 'F')).toMatchObject({ path: ['A', 'B', 'E', 'F'], minutes: 7 })
    roads[6]!.minutes = 10
    expect(shortestRoute(nodes, roads, 'A', 'F')).toMatchObject({ path: ['A', 'D', 'E', 'F'], minutes: 9 })
    for (let mask = 0; mask < 128; mask++) {
      const graph = cityRoads.map((r, i) => ({ ...r, open: (mask & (1 << i)) !== 0 }))
      expect(shortestRoute(nodes, graph, 'A', 'F')?.minutes ?? Infinity).toBe(referenceRouteCost(graph, 'A', 'F'))
    }
  })
  it('rejects deferred index updates even with correct coverage and distance filtering', () => {
    const scenario = mapsDesign.scenarios[1]!
    const result = runMaps({ ...safe, updates: 'deferred' }, scenario.script)
    expect(result.metrics).toMatchObject({ nearbyErrors: 1, indexLag: 1 })
    expect(scenario.check(result).every((c) => c.pass)).toBe(false)
  })
  it('requires observations after changes, not a matching count of earlier successful reads', () => {
    expect(mapsDesign.scenarios[1]!.check(runMaps(safe, ['nearby', 'nearby', 'move-point'])).every((c) => c.pass)).toBe(false)
    expect(mapsDesign.scenarios[2]!.check(runMaps(safe, ['route', 'route', 'route', 'close-road', 'traffic-change'])).every((c) => c.pass)).toBe(false)
    const feed = newsFeedDesign.scenarios[3]!
    expect(feed.check(runNewsFeed(newsFeedDesign.alternatives[1]!.config, ['publish-friend', 'relay', 'drain', 'read', 'delete-friend'])).every((c) => c.pass)).toBe(false)
    const object = objectStorageDesign.scenarios[0]!
    expect(object.check(runObjectStorage(objectStorageDesign.alternatives[0]!.config, ['begin', 'part1', 'get', 'part2', 'complete', 'get', 'lose-a'])).every((c) => c.pass)).toBe(false)
  })
})
