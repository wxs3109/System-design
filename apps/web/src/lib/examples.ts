import { createRegisteredNode } from '@system-design/components'
import { createEmptyProject, type ProjectFileV2 } from '@system-design/model'

const connection = (id: string, source: string, target: string) => ({ id, source, target, sourcePort: 'out' as const, targetPort: 'in' as const, weight: 1 })

export const createDirectExample = (): ProjectFileV2 => {
  const project = createEmptyProject('direct-service')
  project.name = 'Direct service'
  project.topology.nodes = [
    createRegisteredNode('traffic', 'traffic-direct', { x: 60, y: 180 }, 'workload-direct'),
    createRegisteredNode('network', 'network-direct', { x: 330, y: 180 }),
    createRegisteredNode('service', 'service-direct', { x: 600, y: 180 }),
    createRegisteredNode('database', 'database-direct', { x: 870, y: 180 }),
  ]
  project.topology.edges = [connection('edge-direct-1', 'traffic-direct', 'network-direct'), connection('edge-direct-2', 'network-direct', 'service-direct'), connection('edge-direct-3', 'service-direct', 'database-direct')]
  const experiment = project.experiments[0]!
  experiment.seed = 'direct-service'
  experiment.workloads = [{ id: 'workload-direct', name: 'Web requests', sourceNodeId: 'traffic-direct', requestsPerSecond: 120, startAtSeconds: 0, durationSeconds: 30, pattern: 'poisson', requestBytes: 8_192 }]
  return project
}

export const createAsyncExample = (): ProjectFileV2 => {
  const project = createEmptyProject('async-pipeline')
  project.name = 'Async pipeline'
  project.topology.nodes = [
    createRegisteredNode('traffic', 'traffic-async', { x: 60, y: 180 }, 'workload-async'),
    createRegisteredNode('service', 'producer-async', { x: 330, y: 180 }),
    createRegisteredNode('queue', 'queue-async', { x: 600, y: 180 }),
    createRegisteredNode('service', 'worker-async', { x: 870, y: 180 }),
    createRegisteredNode('database', 'database-async', { x: 1_140, y: 180 }),
  ]
  project.topology.nodes[1]!.name = 'Producer API'
  project.topology.nodes[3]!.name = 'Workers'
  project.topology.edges = [connection('edge-async-1', 'traffic-async', 'producer-async'), connection('edge-async-2', 'producer-async', 'queue-async'), connection('edge-async-3', 'queue-async', 'worker-async'), connection('edge-async-4', 'worker-async', 'database-async')]
  const experiment = project.experiments[0]!
  experiment.seed = 'async-pipeline'
  experiment.workloads = [{ id: 'workload-async', name: 'Ingest events', sourceNodeId: 'traffic-async', requestsPerSecond: 300, startAtSeconds: 0, durationSeconds: 30, pattern: 'poisson', requestBytes: 2_048 }]
  return project
}
