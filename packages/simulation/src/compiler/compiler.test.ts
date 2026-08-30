import { describe, expect, it } from 'vitest'
import { createEmptyProject } from '@system-design/model'
import { createRegisteredNode } from '@system-design/components'
import { compileSimulationInput } from './compiler'

describe('generic project compiler', () => {
  it('combines one topology with the selected experiment', () => {
    const project = createEmptyProject('compiled')
    project.topology.nodes = [createRegisteredNode('traffic', 'traffic', { x: 0, y: 0 })]
    project.experiments[0]!.workloads = [{ id: 'load-a', name: 'A', sourceNodeId: 'traffic', requestsPerSecond: 1, startAtSeconds: 0, durationSeconds: 1, pattern: 'constant', requestBytes: 1 }]
    project.experiments.push({ ...structuredClone(project.experiments[0]!), id: 'experiment-b', name: 'B', seed: 'selected-seed', workloads: [{ ...project.experiments[0]!.workloads[0]!, id: 'load-b' }] })
    project.activeExperimentId = 'experiment-b'
    const compiled = compileSimulationInput(project)
    expect(compiled.projectId).toBe('compiled')
    expect(compiled.experimentId).toBe('experiment-b')
    expect(compiled.scenario.seed).toBe('selected-seed')
    expect(compiled.scenario.workloads[0]!.id).toBe('load-b')
  })

  it('rejects missing and incompatible manifest ports', () => {
    const project = createEmptyProject('ports')
    project.topology.nodes = [createRegisteredNode('traffic', 'traffic', { x: 0, y: 0 }), createRegisteredNode('service', 'service', { x: 100, y: 0 })]
    project.experiments[0]!.workloads = [{ id: 'load', name: 'Load', sourceNodeId: 'traffic', requestsPerSecond: 1, startAtSeconds: 0, durationSeconds: 1, pattern: 'constant', requestBytes: 1 }]
    project.topology.edges = [{ id: 'missing', source: 'traffic', target: 'service', sourcePort: 'missing', targetPort: 'in', weight: 1, sourceSemantic: 'request', targetSemantic: 'request', routingMode: 'weighted-one' }]
    expect(() => compileSimulationInput(project)).toThrow('unknown output port')
    project.topology.edges[0] = { ...project.topology.edges[0]!, id: 'mismatch', sourcePort: 'out', targetPort: 'consume' }
    expect(() => compileSimulationInput(project)).toThrow('semantics do not match')
  })
})
