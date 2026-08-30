import { describe, expect, it } from 'vitest'
import { projectFileV3Schema } from '@system-design/model'
import { runSimulation } from '@system-design/simulation'
import { createCloudDriveDeliveryExample, createVideoDeliveryExample } from './examples'

describe('CDN examples', () => {
  it.each([
    ['video delivery', createVideoDeliveryExample, 'video-cdn', 'video-origin'],
    ['cloud drive delivery', createCloudDriveDeliveryExample, 'download-cdn', 'drive-origin'],
  ] as const)('provides a valid, executable %s project', async (_name, createExample, cdnId, originId) => {
    const project = createExample()
    expect(projectFileV3Schema.safeParse(project).success).toBe(true)
    const cdn = project.topology.nodes.find((node) => node.id === cdnId)
    expect(cdn?.type).toBe('cdn')
    expect(project.topology.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: cdnId, sourcePort: 'hit' }),
      expect.objectContaining({ source: cdnId, sourcePort: 'miss', target: originId }),
    ]))

    const result = await runSimulation(project, `${project.id}-example`)
    const details = result.nodes.find((node) => node.nodeId === cdnId)?.details
    expect(Number(details?.cdnOriginFetches)).toBeGreaterThan(0)
    expect(Number(details?.cdnHitRate)).toBeGreaterThan(0)
    expect(Number(details?.cdnBytesServed)).toBeGreaterThan(0)
  })

  it('uses different delivery shapes instead of relabeling one topology', () => {
    const video = createVideoDeliveryExample().topology.nodes.find((node) => node.type === 'cdn')
    const drive = createCloudDriveDeliveryExample().topology.nodes.find((node) => node.type === 'cdn')
    if (video?.type !== 'cdn' || drive?.type !== 'cdn') throw new Error('Expected both examples to contain a CDN.')
    expect({ selection: drive.config.popSelection, pops: drive.config.popCount, bytes: drive.config.defaultObjectSizeBytes }).not.toEqual({
      selection: video.config.popSelection, pops: video.config.popCount, bytes: video.config.defaultObjectSizeBytes,
    })
  })
})
