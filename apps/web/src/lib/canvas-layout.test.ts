import { describe, expect, it } from 'vitest'
import { createVideoDeliveryExample } from './examples'
import { canvasNodeSize, layoutTopology } from './canvas-layout'

describe('ELK canvas layout', () => {
  it('lays out every node deterministically without overlap', async () => {
    const project = createVideoDeliveryExample()
    const first = await layoutTopology(project)
    const second = await layoutTopology(project)
    expect(first).toEqual(second)
    expect(Object.keys(first)).toHaveLength(project.topology.nodes.length)
    const positions = Object.values(first)
    for (let left = 0; left < positions.length; left += 1) {
      for (let right = left + 1; right < positions.length; right += 1) {
        const a = positions[left]!
        const b = positions[right]!
        const overlap = a.x < b.x + canvasNodeSize.width && a.x + canvasNodeSize.width > b.x
          && a.y < b.y + canvasNodeSize.height && a.y + canvasNodeSize.height > b.y
        expect(overlap).toBe(false)
      }
    }
  })
})
