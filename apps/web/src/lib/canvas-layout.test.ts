import { describe, expect, it } from 'vitest'
import { createVideoDeliveryExample } from './examples'
import { canvasNodeSize, layoutTopology } from './canvas-layout'

describe('ELK canvas layout', () => {
  it('lays out every node deterministically without overlap', async () => {
    const project = createVideoDeliveryExample()
    const dimensions = new Map(project.topology.nodes.map((node, index) => [node.id, { width: canvasNodeSize.width, height: canvasNodeSize.height + index * 7 }]))
    const first = await layoutTopology(project, dimensions)
    const second = await layoutTopology(project, dimensions)
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
})
