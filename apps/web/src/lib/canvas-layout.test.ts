import { describe, expect, it } from 'vitest'
import { createDirectExample, createVideoDeliveryExample } from './examples'
import { canvasNodeSize, layoutTopology } from './canvas-layout'

describe('ELK canvas layout', () => {
  it('automatically lays out every node deterministically without overlap', async () => {
    const project = createVideoDeliveryExample()
    const dimensions = new Map(project.topology.nodes.map((node, index) => [node.id, { width: canvasNodeSize.width, height: canvasNodeSize.height + index * 7 }]))
    const first = await layoutTopology(project, dimensions, 'auto')
    const second = await layoutTopology(project, dimensions, 'auto')
    expect(first).toEqual(second)
    expect(Object.keys(first)).toHaveLength(project.topology.nodes.length)
    const positions = Object.values(first)
    for (let left = 0; left < positions.length; left += 1) {
      for (let right = left + 1; right < positions.length; right += 1) {
        const a = positions[left]!
        const b = positions[right]!
        const sizeA = dimensions.get(project.topology.nodes[left]!.id)!
        const sizeB = dimensions.get(project.topology.nodes[right]!.id)!
        const overlap = a.x < b.x + sizeB.width && a.x + sizeA.width > b.x
          && a.y < b.y + sizeB.height && a.y + sizeA.height > b.y
        expect(overlap).toBe(false)
      }
    }
  })

  it('tidies established business lanes without expanding the diagram', async () => {
    const project = createVideoDeliveryExample()
    const positions = await layoutTopology(project, undefined, 'tidy')
    expect(positions['raw-video-storage']?.y).toBe(positions['video-upload-api']?.y)
    expect(positions['video-upload-api']?.y).toBe(positions['transcode-queue']?.y)
    expect(positions['video-viewers']!.y).toBeLessThan(positions['segment-streams']!.y)
    expect(positions['segment-streams']?.y).toBe(positions['video-cdn']?.y)
    expect(Math.max(...Object.values(positions).map((position) => position.x))).toBeLessThanOrEqual(1_008)
  })

  it('uses business entry lanes and graph stages for a visible automatic re-layout', async () => {
    const project = createVideoDeliveryExample()
    const positions = await layoutTopology(project, undefined, 'auto')
    expect(positions['video-upload-streams']?.x).toBe(positions['video-creators']?.x)
    expect(positions['video-creators']?.x).toBe(positions['video-viewers']?.x)
    expect(positions['video-viewers']?.x).toBe(positions['segment-streams']?.x)
    expect(positions['video-upload-api']!.x).toBeGreaterThan(positions['video-creators']!.x)
    expect(positions['transcode-queue']!.x).toBeGreaterThan(positions['video-upload-api']!.x)
    expect(positions['transcoder-workers']!.x).toBeGreaterThan(positions['transcode-queue']!.x)
    expect(positions['video-rendition-storage']!.x).toBeGreaterThan(positions['transcoder-workers']!.x)
    expect(positions['video-rendition-storage']?.y).toBe(positions['transcoder-workers']?.y)
    expect(positions['video-upload-api']).not.toEqual(project.topology.nodes.find((node) => node.id === 'video-upload-api')?.position)
  })

  it('falls back to layered placement when nodes do not have usable positions', async () => {
    const project = createDirectExample()
    project.topology.nodes.forEach((node) => { node.position = { x: 0, y: 0 } })
    const positions = await layoutTopology(project, undefined, 'auto')
    expect(new Set(Object.values(positions).map((position) => `${position.x}:${position.y}`)).size).toBe(project.topology.nodes.length)
    expect(positions['traffic-direct']!.x).toBeLessThan(positions['service-direct']!.x)
  })
})
