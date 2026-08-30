import { createEmptyScenario, createNode, type Scenario } from '@system-design/model'

const connection = (id: string, source: string, target: string) => ({
  id, source, target, sourcePort: 'out' as const, targetPort: 'in' as const, weight: 1,
})

export const createDirectExample = (): Scenario => {
  const scenario = createEmptyScenario('direct-service')
  scenario.name = 'Direct service'
  scenario.seed = 'direct-service'
  scenario.nodes = [
    createNode('traffic', 'traffic-direct', { x: 60, y: 180 }, 'workload-direct'),
    createNode('network', 'network-direct', { x: 330, y: 180 }),
    createNode('service', 'service-direct', { x: 600, y: 180 }),
    createNode('database', 'database-direct', { x: 870, y: 180 }),
  ]
  scenario.edges = [
    connection('edge-direct-1', 'traffic-direct', 'network-direct'),
    connection('edge-direct-2', 'network-direct', 'service-direct'),
    connection('edge-direct-3', 'service-direct', 'database-direct'),
  ]
  scenario.workloads = [{
    id: 'workload-direct', name: 'Web requests', sourceNodeId: 'traffic-direct',
    requestsPerSecond: 120, startAtSeconds: 0, durationSeconds: 30, pattern: 'poisson', requestBytes: 8_192,
  }]
  return scenario
}

export const createAsyncExample = (): Scenario => {
  const scenario = createEmptyScenario('async-pipeline')
  scenario.name = 'Async pipeline'
  scenario.seed = 'async-pipeline'
  scenario.nodes = [
    createNode('traffic', 'traffic-async', { x: 60, y: 180 }, 'workload-async'),
    createNode('service', 'producer-async', { x: 330, y: 180 }),
    createNode('queue', 'queue-async', { x: 600, y: 180 }),
    createNode('service', 'worker-async', { x: 870, y: 180 }),
    createNode('database', 'database-async', { x: 1_140, y: 180 }),
  ]
  scenario.nodes[1]!.name = 'Producer API'
  scenario.nodes[3]!.name = 'Workers'
  scenario.edges = [
    connection('edge-async-1', 'traffic-async', 'producer-async'),
    connection('edge-async-2', 'producer-async', 'queue-async'),
    connection('edge-async-3', 'queue-async', 'worker-async'),
    connection('edge-async-4', 'worker-async', 'database-async'),
  ]
  scenario.workloads = [{
    id: 'workload-async', name: 'Ingest events', sourceNodeId: 'traffic-async',
    requestsPerSecond: 300, startAtSeconds: 0, durationSeconds: 30, pattern: 'poisson', requestBytes: 2_048,
  }]
  return scenario
}
