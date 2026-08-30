import { describe, expect, it } from 'vitest'
import { createEmptyProject } from '@system-design/model'
import { createRegisteredNode } from '@system-design/components'
import { compileSimulationInput } from './compiler'
import { validateScenarioForSimulation } from './validation'

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

  it('validates and orders policy attachments through the registry', () => {
    const project = createEmptyProject('policies')
    project.topology.nodes = [createRegisteredNode('traffic', 'traffic', { x: 0, y: 0 }), createRegisteredNode('service', 'service', { x: 100, y: 0 })]
    project.experiments[0]!.workloads = [{ id: 'load', name: 'Load', sourceNodeId: 'traffic', requestsPerSecond: 1, startAtSeconds: 0, durationSeconds: 1, pattern: 'constant', requestBytes: 1 }]
    project.topology.edges = [{ id: 'edge', source: 'traffic', target: 'service', sourcePort: 'out', targetPort: 'in', weight: 1, sourceSemantic: 'request', targetSemantic: 'request', routingMode: 'weighted-one' }]
    project.topology.policies = [
      { id: 'timeout', type: 'timeout', version: 1, target: { kind: 'edge', id: 'edge' }, order: 1, enabled: true, config: { timeoutMs: 20 } },
      { id: 'retry', type: 'retry', version: 1, target: { kind: 'edge', id: 'edge' }, order: 0, enabled: true, config: { maxAttempts: 2, backoff: 'exponential', baseDelayMs: 50, maxDelayMs: 2_000, jitterRatio: 0 } },
    ]
    expect(compileSimulationInput(project).policies.get('edge:edge')?.map((policy) => policy.type)).toEqual(['retry', 'timeout'])
    project.topology.policies[0]!.config = { timeoutMs: -1 }
    expect(() => compileSimulationInput(project)).toThrow()
  })

  it('rejects Scheduler faults and node policies that have no runtime semantics', () => {
    const project = createEmptyProject('scheduler-semantics')
    project.topology.nodes = [createRegisteredNode('scheduler', 'scheduler', { x: 0, y: 0 }), createRegisteredNode('service', 'service', { x: 100, y: 0 })]
    project.topology.edges = [{ id: 'edge', source: 'scheduler', target: 'service', sourcePort: 'out', targetPort: 'in', weight: 1, sourceSemantic: 'request', targetSemantic: 'request', routingMode: 'weighted-one' }]
    project.topology.policies = [{ id: 'limit', type: 'rate-limit', version: 1, target: { kind: 'node', id: 'scheduler' }, order: 0, enabled: true, config: { capacity: 1, refillTokens: 1, refillIntervalMs: 1_000 } }]
    expect(() => compileSimulationInput(project)).toThrow('Scheduler does not support rate-limit@1 as a node policy')
    project.topology.policies = []
    project.experiments[0]!.faults = [{ id: 'down', type: 'node-down', target: { kind: 'node', id: 'scheduler' }, startAtSeconds: 0, durationSeconds: 1, enabled: true }]
    expect(() => compileSimulationInput(project)).toThrow('Scheduler does not support node-down faults')
  })

  it('rejects a CDN without an explicit origin miss path', () => {
    const project = createEmptyProject('cdn-origin-path')
    project.topology.nodes = [createRegisteredNode('traffic', 'traffic', { x: 0, y: 0 }, 'load'), createRegisteredNode('cdn', 'cdn', { x: 100, y: 0 })]
    project.topology.edges = [{ id: 'entry', source: 'traffic', target: 'cdn', sourcePort: 'out', targetPort: 'in', weight: 1, sourceSemantic: 'request', targetSemantic: 'request', routingMode: 'weighted-one' }]
    project.experiments[0]!.workloads = [{ id: 'load', name: 'Load', sourceNodeId: 'traffic', requestsPerSecond: 1, startAtSeconds: 0, durationSeconds: 1, pattern: 'constant', requestBytes: 100 }]
    expect(validateScenarioForSimulation(project).errors).toContain('CDN CDN requires a connected miss path to an origin.')
  })

  it('warns when a CDN hit path is not connected', () => {
    const project = createEmptyProject('cdn-hit-path')
    project.topology.nodes = [createRegisteredNode('traffic', 'traffic', { x: 0, y: 0 }, 'load'), createRegisteredNode('cdn', 'cdn', { x: 100, y: 0 }), createRegisteredNode('object-storage', 'origin', { x: 200, y: 0 })]
    project.topology.edges = [
      { id: 'entry', source: 'traffic', target: 'cdn', sourcePort: 'out', targetPort: 'in', weight: 1, sourceSemantic: 'request', targetSemantic: 'request', routingMode: 'weighted-one' },
      { id: 'origin', source: 'cdn', target: 'origin', sourcePort: 'miss', targetPort: 'in', weight: 1, sourceSemantic: 'miss', targetSemantic: 'request', routingMode: 'weighted-one' },
    ]
    project.experiments[0]!.workloads = [{ id: 'load', name: 'Load', sourceNodeId: 'traffic', requestsPerSecond: 1, startAtSeconds: 0, durationSeconds: 1, pattern: 'constant', requestBytes: 100 }]
    expect(validateScenarioForSimulation(project).warnings).toContain('CDN CDN has no connected hit path; cached responses terminate at the CDN node.')
  })
})
