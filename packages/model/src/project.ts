import { z } from 'zod'
import {
  connectionSchema,
  faultSchema,
  scenarioSchema,
  simulationConfigSchema,
  workloadSchema,
  positionSchema,
  type Scenario,
} from './schema'
import {
  businessDefinitionsSchema,
  emptyBusinessDefinitions,
  operationWorkloadSchema,
  type BusinessDefinitions,
} from './business-contracts'

const projectIdSchema = z.string().trim().min(1).max(120)
const projectNameSchema = z.string().trim().min(1).max(120)

export const portSemanticSchema = z.enum(['request', 'response', 'publish', 'consume', 'hit', 'miss', 'success', 'failure'])
export const routingModeSchema = z.enum(['weighted-one', 'fan-out', 'async-publish'])

export const projectConnectionSchema = connectionSchema.omit({ sourcePort: true, targetPort: true }).extend({
  sourcePort: projectIdSchema.default('out'),
  targetPort: projectIdSchema.default('in'),
  sourceSemantic: portSemanticSchema.default('request'),
  targetSemantic: portSemanticSchema.default('request'),
  routingMode: routingModeSchema.default('weighted-one'),
})

export const projectComponentNodeSchema = z.object({
  id: projectIdSchema,
  name: z.string().trim().min(1).max(80),
  type: projectIdSchema,
  componentVersion: z.number().int().positive(),
  position: positionSchema,
  disabled: z.boolean().optional(),
  rolePreset: z.object({ id: projectIdSchema, version: z.number().int().positive() }).optional(),
  config: z.record(z.string(), z.unknown()).default({}),
})

export const topologyGroupSchema = z.object({
  id: projectIdSchema,
  name: z.string().trim().min(1).max(80),
  kind: z.enum(['group', 'zone', 'region']).default('group'),
  nodeIds: z.array(projectIdSchema).max(10_000).default([]),
})

export const policyAttachmentSchema = z.object({
  id: projectIdSchema,
  type: projectIdSchema,
  version: z.number().int().positive(),
  target: z.object({
    kind: z.enum(['node', 'edge', 'group']),
    id: projectIdSchema,
  }),
  order: z.number().int().min(0).default(0),
  enabled: z.boolean().default(true),
  config: z.record(z.string(), z.unknown()).default({}),
})

export const topologySchema = z.object({
  nodes: z.array(projectComponentNodeSchema).max(10_000),
  edges: z.array(projectConnectionSchema).max(50_000),
  groups: z.array(topologyGroupSchema).max(10_000).default([]),
  policies: z.array(policyAttachmentSchema).max(50_000).default([]),
})

export const experimentSchema = z.object({
  id: projectIdSchema,
  name: z.string().trim().min(1).max(120),
  workloads: z.array(workloadSchema).max(1_000),
  faults: z.array(faultSchema).max(10_000).default([]),
  simulation: simulationConfigSchema,
  seed: z.string().min(1).max(120),
})

export const projectExperimentSchema = experimentSchema.extend({
  operationWorkloads: z.array(operationWorkloadSchema).max(1_000).default([]),
}).strict()

const addDuplicateIssue = (
  context: z.RefinementCtx,
  path: (string | number)[],
  kind: string,
  id: string,
) => context.addIssue({ code: 'custom', path, message: `Duplicate ${kind} id: ${id}` })

export const projectFileV2Schema = z.object({
  schemaVersion: z.literal(2),
  id: projectIdSchema,
  name: projectNameSchema,
  topology: topologySchema,
  experiments: z.array(experimentSchema).min(1).max(1_000),
  activeExperimentId: projectIdSchema,
}).superRefine((project, context) => {
  const nodeIds = new Set<string>()
  const edgeIds = new Set<string>()
  const groupIds = new Set<string>()
  const policyIds = new Set<string>()
  const experimentIds = new Set<string>()

  project.topology.nodes.forEach((node, index) => {
    if (nodeIds.has(node.id)) addDuplicateIssue(context, ['topology', 'nodes', index, 'id'], 'node', node.id)
    nodeIds.add(node.id)
  })
  project.topology.edges.forEach((edge, index) => {
    if (edgeIds.has(edge.id)) addDuplicateIssue(context, ['topology', 'edges', index, 'id'], 'edge', edge.id)
    edgeIds.add(edge.id)
    if (!nodeIds.has(edge.source)) context.addIssue({ code: 'custom', path: ['topology', 'edges', index, 'source'], message: `Unknown source node: ${edge.source}` })
    if (!nodeIds.has(edge.target)) context.addIssue({ code: 'custom', path: ['topology', 'edges', index, 'target'], message: `Unknown target node: ${edge.target}` })
    if (edge.source === edge.target) context.addIssue({ code: 'custom', path: ['topology', 'edges', index], message: 'A node cannot connect directly to itself' })
    if (edge.routingMode === 'async-publish' && (edge.sourceSemantic !== 'publish' || edge.targetSemantic !== 'consume')) {
      context.addIssue({ code: 'custom', path: ['topology', 'edges', index], message: 'async-publish routing requires publish -> consume semantics' })
    }
    if (edge.routingMode !== 'async-publish' && edge.sourceSemantic === 'publish') {
      context.addIssue({ code: 'custom', path: ['topology', 'edges', index, 'routingMode'], message: 'A publish port requires async-publish routing' })
    }
  })
  project.topology.groups.forEach((group, index) => {
    if (groupIds.has(group.id)) addDuplicateIssue(context, ['topology', 'groups', index, 'id'], 'group', group.id)
    groupIds.add(group.id)
    group.nodeIds.forEach((nodeId, nodeIndex) => {
      if (!nodeIds.has(nodeId)) context.addIssue({ code: 'custom', path: ['topology', 'groups', index, 'nodeIds', nodeIndex], message: `Unknown group member: ${nodeId}` })
    })
  })
  project.topology.policies.forEach((policy, index) => {
    if (policyIds.has(policy.id)) addDuplicateIssue(context, ['topology', 'policies', index, 'id'], 'policy', policy.id)
    policyIds.add(policy.id)
    const targets = policy.target.kind === 'node' ? nodeIds : policy.target.kind === 'edge' ? edgeIds : groupIds
    if (!targets.has(policy.target.id)) context.addIssue({ code: 'custom', path: ['topology', 'policies', index, 'target', 'id'], message: `Unknown ${policy.target.kind} policy target: ${policy.target.id}` })
  })

  project.experiments.forEach((experiment, experimentIndex) => {
    if (experimentIds.has(experiment.id)) addDuplicateIssue(context, ['experiments', experimentIndex, 'id'], 'experiment', experiment.id)
    experimentIds.add(experiment.id)
    const workloadIds = new Set<string>()
    const faultIds = new Set<string>()
    experiment.workloads.forEach((workload, workloadIndex) => {
      if (workloadIds.has(workload.id)) addDuplicateIssue(context, ['experiments', experimentIndex, 'workloads', workloadIndex, 'id'], 'workload', workload.id)
      workloadIds.add(workload.id)
      const source = project.topology.nodes.find((node) => node.id === workload.sourceNodeId)
      if (!source) context.addIssue({ code: 'custom', path: ['experiments', experimentIndex, 'workloads', workloadIndex, 'sourceNodeId'], message: `Unknown workload source: ${workload.sourceNodeId}` })
      else if (source.type !== 'traffic') context.addIssue({ code: 'custom', path: ['experiments', experimentIndex, 'workloads', workloadIndex, 'sourceNodeId'], message: 'A workload source must be a Traffic Generator' })
    })
    project.topology.nodes.forEach((node, nodeIndex) => {
      if (node.type === 'traffic' && !experiment.workloads.some((workload) => workload.sourceNodeId === node.id)) {
        context.addIssue({ code: 'custom', path: ['topology', 'nodes', nodeIndex], message: `Traffic node ${node.id} must have a workload in experiment ${experiment.id}` })
      }
    })
    experiment.faults.forEach((fault, faultIndex) => {
      if (faultIds.has(fault.id)) addDuplicateIssue(context, ['experiments', experimentIndex, 'faults', faultIndex, 'id'], 'fault', fault.id)
      faultIds.add(fault.id)
      const target = fault.target ?? (fault.targetNodeId === undefined ? undefined : { kind: 'node' as const, id: fault.targetNodeId })
      if (!target) return
      const targets = target.kind === 'node' ? nodeIds : target.kind === 'edge' ? edgeIds : target.kind === 'group' ? groupIds : workloadIds
      if (!targets.has(target.id)) context.addIssue({ code: 'custom', path: ['experiments', experimentIndex, 'faults', faultIndex, 'target'], message: `Unknown ${target.kind} fault target: ${target.id}` })
      const allowedTargets = fault.type === 'node-down' || fault.type === 'capacity-drop' ? ['node']
        : fault.type === 'latency-spike' ? ['node', 'edge']
          : fault.type === 'bandwidth-drop' || fault.type === 'packet-loss' ? ['edge']
            : fault.type === 'traffic-spike' || fault.type === 'hot-key' ? ['workload']
              : ['group']
      if (!allowedTargets.includes(target.kind)) context.addIssue({ code: 'custom', path: ['experiments', experimentIndex, 'faults', faultIndex, 'target'], message: `${fault.type} cannot target a ${target.kind}.` })
      if (fault.type === 'region-outage' && target.kind === 'group') {
        const group = project.topology.groups.find((candidate) => candidate.id === target.id)
        if (group?.kind !== 'region' && group?.kind !== 'zone') context.addIssue({ code: 'custom', path: ['experiments', experimentIndex, 'faults', faultIndex, 'target'], message: 'region-outage must target a region or zone.' })
      }
    })
  })

  if (!experimentIds.has(project.activeExperimentId)) {
    context.addIssue({ code: 'custom', path: ['activeExperimentId'], message: `Unknown active experiment: ${project.activeExperimentId}` })
  }
})

export type ProjectComponentNode = z.infer<typeof projectComponentNodeSchema>
export type PortSemantic = z.infer<typeof portSemanticSchema>
export type RoutingMode = z.infer<typeof routingModeSchema>
export type ProjectConnection = z.infer<typeof projectConnectionSchema>
export type TopologyGroup = z.infer<typeof topologyGroupSchema>
export type PolicyAttachment = z.infer<typeof policyAttachmentSchema>
export type Topology = z.infer<typeof topologySchema>
export type ExperimentV2 = z.infer<typeof experimentSchema>
export type ProjectFileV2 = z.infer<typeof projectFileV2Schema>

export const projectModelingModeSchema = z.enum(['capacity-only', 'business-aware'])

const referenceKey = (id: string, version: number) => `${id}@${version}`
const operationReferenceKey = (apiId: string, apiVersion: number, operationId: string) => `${referenceKey(apiId, apiVersion)}:${operationId}`

const addReferenceIssue = (context: z.RefinementCtx, path: (string | number)[], message: string) => {
  context.addIssue({ code: 'custom', path, message })
}

const validateBusinessReferences = (project: {
  modelingMode: 'capacity-only' | 'business-aware'
  topology: Topology
  definitions: BusinessDefinitions
  experiments: Array<ExperimentV2 & { operationWorkloads: z.infer<typeof operationWorkloadSchema>[] }>
}, context: z.RefinementCtx) => {
  const nodes = new Map(project.topology.nodes.map((node) => [node.id, node]))
  const schemas = new Set(project.definitions.jsonSchemas.map((schema) => referenceKey(schema.id, schema.version)))
  const apis = new Map(project.definitions.apis.map((api) => [referenceKey(api.id, api.version), api]))
  const operations = new Map(project.definitions.apis.flatMap((api) => api.operations.map((operation) => [
    operationReferenceKey(api.id, api.version, operation.id), { api, operation },
  ] as const)))
  const models = new Map(project.definitions.dataModels.map((model) => [referenceKey(model.id, model.version), model]))
  const events = new Map(project.definitions.events.map((event) => [referenceKey(event.id, event.version), event]))
  const cacheKeys = new Set(project.definitions.cacheKeys.map((key) => referenceKey(key.id, key.version)))
  const workflows = new Map(project.definitions.workflows.map((workflow) => [referenceKey(workflow.id, workflow.version), workflow]))
  const interactions = new Map(project.definitions.interactions.map((interaction) => [referenceKey(interaction.id, interaction.version), interaction]))

  const requireNode = (id: string, path: (string | number)[], expectedType?: string | readonly string[]) => {
    const node = nodes.get(id)
    if (!node) {
      addReferenceIssue(context, path, `Unknown topology node: ${id}`)
      return undefined
    }
    const expectedTypes = expectedType === undefined ? undefined : Array.isArray(expectedType) ? expectedType : [expectedType]
    if (expectedTypes && !expectedTypes.includes(node.type)) addReferenceIssue(context, path, `Node ${id} must be a ${expectedTypes.join(' or ')} component.`)
    return node
  }
  const requireSchema = (reference: { schemaId: string; schemaVersion: number }, path: (string | number)[]) => {
    const key = referenceKey(reference.schemaId, reference.schemaVersion)
    if (!schemas.has(key)) addReferenceIssue(context, path, `Unknown JSON Schema: ${key}`)
  }
  const requireOperation = (reference: { apiId: string; apiVersion: number; operationId: string }, path: (string | number)[]) => {
    const key = operationReferenceKey(reference.apiId, reference.apiVersion, reference.operationId)
    const operation = operations.get(key)
    if (!operation) addReferenceIssue(context, path, `Unknown API operation: ${key}`)
    return operation
  }

  project.definitions.apis.forEach((api, apiIndex) => {
    requireNode(api.ownerNodeId, ['definitions', 'apis', apiIndex, 'ownerNodeId'], 'service')
    api.operations.forEach((operation, operationIndex) => {
      if (operation.request) requireSchema(operation.request.schema, ['definitions', 'apis', apiIndex, 'operations', operationIndex, 'request', 'schema'])
      operation.responses.forEach((response, responseIndex) => {
        if (response.body) requireSchema(response.body.schema, ['definitions', 'apis', apiIndex, 'operations', operationIndex, 'responses', responseIndex, 'body', 'schema'])
      })
    })
  })

  project.definitions.dataModels.forEach((model, modelIndex) => {
    const owner = requireNode(model.ownerNodeId, ['definitions', 'dataModels', modelIndex, 'ownerNodeId'], model.kind === 'document' ? ['database', 'search-index'] : 'database')
    if (owner?.type === 'search-index' && model.kind !== 'document') addReferenceIssue(context, ['definitions', 'dataModels', modelIndex, 'kind'], 'Search Index can own only a document data model.')
    if (model.kind === 'document') model.collections.forEach((collection, collectionIndex) => {
      requireSchema(collection.documentSchema, ['definitions', 'dataModels', modelIndex, 'collections', collectionIndex, 'documentSchema'])
    })
    if (model.kind === 'key-value') model.namespaces.forEach((namespace, namespaceIndex) => {
      requireSchema(namespace.keySchema, ['definitions', 'dataModels', modelIndex, 'namespaces', namespaceIndex, 'keySchema'])
      requireSchema(namespace.valueSchema, ['definitions', 'dataModels', modelIndex, 'namespaces', namespaceIndex, 'valueSchema'])
    })
  })

  project.definitions.events.forEach((event, eventIndex) => {
    requireSchema(event.payloadSchema, ['definitions', 'events', eventIndex, 'payloadSchema'])
    requireNode(event.producerNodeId, ['definitions', 'events', eventIndex, 'producerNodeId'], 'service')
    event.consumerNodeIds.forEach((nodeId, nodeIndex) => requireNode(nodeId, ['definitions', 'events', eventIndex, 'consumerNodeIds', nodeIndex], 'service'))
  })
  project.definitions.cacheKeys.forEach((cacheKey, cacheKeyIndex) => {
    if (cacheKey.valueSchema) requireSchema(cacheKey.valueSchema, ['definitions', 'cacheKeys', cacheKeyIndex, 'valueSchema'])
  })
  project.definitions.workflows.forEach((workflow, workflowIndex) => {
    requireNode(workflow.ownerNodeId, ['definitions', 'workflows', workflowIndex, 'ownerNodeId'], 'workflow')
    const validateActivity = (activity: typeof workflow.steps[number] | NonNullable<typeof workflow.steps[number]['compensation']>, path: (string | number)[]) => {
      const target = requireNode(activity.targetNodeId, [...path, 'targetNodeId'], 'service')
      if (activity.operation) {
        const referenced = requireOperation(activity.operation, [...path, 'operation'])
        if (target && referenced && referenced.api.ownerNodeId !== target.id) addReferenceIssue(context, [...path, 'targetNodeId'], `API operation is owned by node ${referenced.api.ownerNodeId}, not ${target.id}.`)
      }
    }
    workflow.steps.forEach((step, stepIndex) => {
      const path = ['definitions', 'workflows', workflowIndex, 'steps', stepIndex] as (string | number)[]
      validateActivity(step, path)
      if (step.compensation) validateActivity(step.compensation, [...path, 'compensation'])
    })
  })

  project.definitions.interactions.forEach((interaction, interactionIndex) => {
    requireOperation(interaction.entryOperation, ['definitions', 'interactions', interactionIndex, 'entryOperation'])
    interaction.actions.forEach((action, actionIndex) => {
      const path = ['definitions', 'interactions', interactionIndex, 'actions', actionIndex] as (string | number)[]
      if (action.kind === 'api-call') {
        requireNode(action.sourceNodeId, [...path, 'sourceNodeId'])
        const target = requireNode(action.targetNodeId, [...path, 'targetNodeId'], 'service')
        const referenced = requireOperation(action.operation, [...path, 'operation'])
        if (target && referenced && referenced.api.ownerNodeId !== target.id) addReferenceIssue(context, [...path, 'targetNodeId'], `API operation is owned by node ${referenced.api.ownerNodeId}, not ${target.id}.`)
      } else if (action.kind === 'service-call') {
        requireNode(action.sourceNodeId, [...path, 'sourceNodeId'])
        const target = requireNode(action.targetNodeId, [...path, 'targetNodeId'], 'service')
        if (action.operation) {
          const referenced = requireOperation(action.operation, [...path, 'operation'])
          if (target && referenced && referenced.api.ownerNodeId !== target.id) addReferenceIssue(context, [...path, 'targetNodeId'], `API operation is owned by node ${referenced.api.ownerNodeId}, not ${target.id}.`)
        }
      } else if (action.kind === 'data-access') {
        const node = requireNode(action.nodeId, [...path, 'nodeId'], ['database', 'search-index'])
        const modelKey = referenceKey(action.model.modelId, action.model.modelVersion)
        const model = models.get(modelKey)
        if (!model) {
          addReferenceIssue(context, [...path, 'model'], `Unknown data model: ${modelKey}`)
          return
        }
        if (node && model.ownerNodeId !== node.id) addReferenceIssue(context, [...path, 'nodeId'], `Data model is owned by node ${model.ownerNodeId}, not ${node.id}.`)
        if (node?.type === 'search-index') {
          if (model.kind !== 'document') addReferenceIssue(context, [...path, 'model'], 'Search Index data access requires a document data model.')
          const allowed = ['index-read', 'range-read', 'scan', 'insert', 'update', 'delete']
          if (!allowed.includes(action.operation)) addReferenceIssue(context, [...path, 'operation'], `Search Index does not support ${action.operation}.`)
        }
        const object = model.kind === 'relational' ? model.tables.find((candidate) => candidate.id === action.objectId)
          : model.kind === 'document' ? model.collections.find((candidate) => candidate.id === action.objectId)
            : model.namespaces.find((candidate) => candidate.id === action.objectId)
        if (!object) {
          addReferenceIssue(context, [...path, 'objectId'], `Unknown ${model.kind} data object: ${action.objectId}`)
          return
        }
        if (action.indexId) {
          const indexExists = model.kind === 'relational'
            ? (() => {
                const relationalObject = model.tables.find((candidate) => candidate.id === action.objectId)!
                return [relationalObject.primaryKey, ...relationalObject.uniqueKeys, ...relationalObject.indexes].some((index) => index.id === action.indexId)
              })()
            : model.kind === 'document'
              ? model.collections.find((candidate) => candidate.id === action.objectId)!.secondaryIndexes.some((index) => index.id === action.indexId)
              : false
          if (!indexExists) addReferenceIssue(context, [...path, 'indexId'], `Unknown index ${action.indexId} on data object ${action.objectId}.`)
        }
      } else if (action.kind === 'cache-access') {
        requireNode(action.nodeId, [...path, 'nodeId'], 'cache')
        const key = referenceKey(action.key.cacheKeyId, action.key.cacheKeyVersion)
        if (!cacheKeys.has(key)) addReferenceIssue(context, [...path, 'key'], `Unknown cache-key contract: ${key}`)
      } else if (action.kind === 'realtime') {
        requireNode(action.nodeId, [...path, 'nodeId'], 'realtime-gateway')
      } else if (action.kind === 'workflow') {
        const node = requireNode(action.nodeId, [...path, 'nodeId'], 'workflow')
        const key = referenceKey(action.workflow.workflowId, action.workflow.workflowVersion)
        const workflow = workflows.get(key)
        if (!workflow) addReferenceIssue(context, [...path, 'workflow'], `Unknown workflow definition: ${key}`)
        else if (node && workflow.ownerNodeId !== node.id) addReferenceIssue(context, [...path, 'nodeId'], `Workflow definition is owned by node ${workflow.ownerNodeId}, not ${node.id}.`)
      } else {
        const brokerNodeId = action.brokerNodeId
        const broker = requireNode(brokerNodeId, [...path, 'brokerNodeId'])
        if (broker && broker.type !== 'queue' && broker.type !== 'stream' && broker.type !== 'topic') addReferenceIssue(context, [...path, 'brokerNodeId'], `Node ${brokerNodeId} must be a queue, stream, or topic component.`)
        const eventKey = referenceKey(action.event.eventId, action.event.eventVersion)
        const event = events.get(eventKey)
        if (!event) addReferenceIssue(context, [...path, 'event'], `Unknown event contract: ${eventKey}`)
        if (action.kind === 'event-publish') {
          requireNode(action.producerNodeId, [...path, 'producerNodeId'], 'service')
          if (event && event.producerNodeId !== action.producerNodeId) addReferenceIssue(context, [...path, 'producerNodeId'], `Event ${eventKey} is produced by ${event.producerNodeId}.`)
        } else {
          requireNode(action.consumerNodeId, [...path, 'consumerNodeId'], 'service')
          if (event && !event.consumerNodeIds.includes(action.consumerNodeId)) addReferenceIssue(context, [...path, 'consumerNodeId'], `Node ${action.consumerNodeId} is not a consumer of event ${eventKey}.`)
        }
      }
    })
  })

  project.experiments.forEach((experiment, experimentIndex) => {
    const operationWorkloadIds = new Set<string>()
    const schedulerWorkloadSources = new Set<string>()
    experiment.operationWorkloads.forEach((workload, workloadIndex) => {
      if (operationWorkloadIds.has(workload.id)) addDuplicateIssue(context, ['experiments', experimentIndex, 'operationWorkloads', workloadIndex, 'id'], 'operation workload', workload.id)
      operationWorkloadIds.add(workload.id)
      const source = requireNode(workload.sourceNodeId, ['experiments', experimentIndex, 'operationWorkloads', workloadIndex, 'sourceNodeId'])
      if (source && source.type !== 'traffic' && source.type !== 'scheduler') addReferenceIssue(context, ['experiments', experimentIndex, 'operationWorkloads', workloadIndex, 'sourceNodeId'], `Node ${source.id} must be a traffic or scheduler component.`)
      if (source?.type === 'scheduler') {
        if (schedulerWorkloadSources.has(source.id)) addReferenceIssue(context, ['experiments', experimentIndex, 'operationWorkloads', workloadIndex, 'sourceNodeId'], `Scheduler ${source.id} can bind only one operation workload per experiment.`)
        schedulerWorkloadSources.add(source.id)
      }
      workload.operationMix.forEach((mix, mixIndex) => {
        const operation = requireOperation(mix.operation, ['experiments', experimentIndex, 'operationWorkloads', workloadIndex, 'operationMix', mixIndex, 'operation'])
        const interactionKey = referenceKey(mix.interaction.interactionId, mix.interaction.interactionVersion)
        const interaction = interactions.get(interactionKey)
        if (!interaction) addReferenceIssue(context, ['experiments', experimentIndex, 'operationWorkloads', workloadIndex, 'operationMix', mixIndex, 'interaction'], `Unknown interaction: ${interactionKey}`)
        if (operation && interaction && operationReferenceKey(interaction.entryOperation.apiId, interaction.entryOperation.apiVersion, interaction.entryOperation.operationId) !== operationReferenceKey(mix.operation.apiId, mix.operation.apiVersion, mix.operation.operationId)) {
          addReferenceIssue(context, ['experiments', experimentIndex, 'operationWorkloads', workloadIndex, 'operationMix', mixIndex, 'interaction'], `Interaction ${interactionKey} does not implement the selected operation.`)
        }
      })
    })
  })

  const hasDefinitions = project.definitions.jsonSchemas.length + project.definitions.apis.length + project.definitions.dataModels.length
    + project.definitions.events.length + project.definitions.cacheKeys.length + project.definitions.workflows.length + project.definitions.interactions.length > 0
  const hasOperationWorkloads = project.experiments.some((experiment) => experiment.operationWorkloads.length > 0)
  if (project.modelingMode === 'capacity-only' && (hasDefinitions || hasOperationWorkloads)) {
    addReferenceIssue(context, ['modelingMode'], 'A capacity-only project cannot contain business definitions or operation workloads.')
  }
}

const projectFileV3BaseSchema = z.object({
  schemaVersion: z.literal(3),
  id: projectIdSchema,
  name: projectNameSchema,
  modelingMode: projectModelingModeSchema,
  topology: topologySchema,
  definitions: businessDefinitionsSchema,
  experiments: z.array(projectExperimentSchema).min(1).max(1_000),
  activeExperimentId: projectIdSchema,
}).strict()

export const projectFileV3Schema = projectFileV3BaseSchema.superRefine((project, context) => {
  const phaseOneShape = {
    schemaVersion: 2 as const, id: project.id, name: project.name, topology: project.topology,
    experiments: project.experiments.map(({ operationWorkloads: _operationWorkloads, ...experiment }) => experiment),
    activeExperimentId: project.activeExperimentId,
  }
  const phaseOneValidation = projectFileV2Schema.safeParse(phaseOneShape)
  if (!phaseOneValidation.success) phaseOneValidation.error.issues.forEach((issue) => {
    if (issue.path[0] === 'topology' && issue.path[1] === 'nodes' && typeof issue.path[2] === 'number' && issue.message.includes('must have a workload')) {
      const nodeId = project.topology.nodes[issue.path[2]]?.id
      if (nodeId && project.experiments.every((experiment) => experiment.operationWorkloads.some((workload) => workload.sourceNodeId === nodeId))) return
    }
    if (issue.path[0] === 'experiments' && issue.message.includes('Unknown workload fault target:')) {
      const targetId = issue.message.split(': ').at(-1)
      const experimentIndex = typeof issue.path[1] === 'number' ? issue.path[1] : undefined
      if (targetId && experimentIndex !== undefined && project.experiments[experimentIndex]?.operationWorkloads.some((workload) => workload.id === targetId)) return
    }
    context.addIssue({ code: 'custom', path: [...issue.path], message: issue.message })
  })
  validateBusinessReferences(project, context)
})

export type Experiment = z.infer<typeof projectExperimentSchema>
export type ProjectModelingMode = z.infer<typeof projectModelingModeSchema>
export type ProjectFileV3 = z.infer<typeof projectFileV3Schema>
export type ProjectFile = ProjectFileV3
export type AnyProjectFile = ProjectFileV2 | ProjectFileV3

export class UnsupportedProjectVersionError extends Error {
  constructor(readonly version: unknown) {
    super(`Unsupported project schemaVersion: ${String(version)}. This version can open schemaVersion 1, 2, or 3.`)
    this.name = 'UnsupportedProjectVersionError'
  }
}

const defaultExperimentId = 'default-experiment'

export const migrateScenarioV1ToProjectV2 = (input: Scenario | unknown): ProjectFileV2 => {
  const scenario = scenarioSchema.parse(input)
  return projectFileV2Schema.parse({
    schemaVersion: 2,
    id: scenario.id,
    name: scenario.name,
    topology: {
      nodes: scenario.nodes.map((node) => ({
        ...node,
        componentVersion: 1,
        config: node.type === 'traffic' ? {} : node.config,
      })),
      edges: scenario.edges,
      groups: [],
      policies: [],
    },
    experiments: [{
      id: defaultExperimentId,
      name: 'Default experiment',
      workloads: scenario.workloads,
      faults: scenario.faults,
      simulation: scenario.simulation,
      seed: scenario.seed,
    }],
    activeExperimentId: defaultExperimentId,
  })
}

export const migrateProjectV2ToProjectV3 = (input: ProjectFileV2 | unknown): ProjectFileV3 => {
  const project = projectFileV2Schema.parse(input)
  return projectFileV3Schema.parse({
    ...project,
    schemaVersion: 3,
    modelingMode: 'capacity-only',
    definitions: emptyBusinessDefinitions(),
    experiments: project.experiments.map((experiment) => ({ ...experiment, operationWorkloads: [] })),
  })
}

export const migrateScenarioV1ToProjectV3 = (input: Scenario | unknown): ProjectFileV3 => migrateProjectV2ToProjectV3(migrateScenarioV1ToProjectV2(input))

export const parseProjectFile = (input: unknown): ProjectFileV3 => {
  if (typeof input !== 'object' || input === null || !('schemaVersion' in input)) {
    throw new UnsupportedProjectVersionError(undefined)
  }
  const version = (input as { schemaVersion?: unknown }).schemaVersion
  if (version === 1) return migrateScenarioV1ToProjectV3(input)
  if (version === 2) return migrateProjectV2ToProjectV3(input)
  if (version === 3) return projectFileV3Schema.parse(input)
  throw new UnsupportedProjectVersionError(version)
}

export function getActiveExperiment(project: ProjectFileV3): Experiment
export function getActiveExperiment(project: ProjectFileV2): ExperimentV2
export function getActiveExperiment(project: AnyProjectFile): Experiment | ExperimentV2
export function getActiveExperiment(project: AnyProjectFile): Experiment | ExperimentV2 {
  const experiment = project.experiments.find((candidate) => candidate.id === project.activeExperimentId)
  if (!experiment) throw new Error(`Active experiment ${project.activeExperimentId} does not exist.`)
  return experiment
}

export const setActiveExperiment = <T extends AnyProjectFile>(input: T, experimentId: string): T => {
  const schema = input.schemaVersion === 3 ? projectFileV3Schema : projectFileV2Schema
  return schema.parse({ ...input, activeExperimentId: experimentId }) as T
}

export const projectToScenario = (input: AnyProjectFile, experimentId = input.activeExperimentId): Scenario => {
  const project = input.schemaVersion === 3 ? projectFileV3Schema.parse(input) : projectFileV2Schema.parse(input)
  const experiment = project.experiments.find((candidate) => candidate.id === experimentId)
  if (!experiment) throw new Error(`Experiment ${experimentId} does not exist.`)
  const operationWorkloadIds = new Set(project.schemaVersion === 3
    ? project.experiments.find((candidate) => candidate.id === experimentId)!.operationWorkloads.map((workload) => workload.id) : [])
  const expandedFaults = experiment.faults.flatMap((fault) => {
    const target = fault.target ?? (fault.targetNodeId === undefined ? undefined : { kind: 'node' as const, id: fault.targetNodeId })
    if (target?.kind !== 'group') return [fault]
    const members = project.topology.groups.find((group) => group.id === target.id)?.nodeIds ?? []
    const memberSet = new Set(members)
    const affectedEdges = project.topology.edges.filter((edge) => memberSet.has(edge.source) || memberSet.has(edge.target)).map((edge) => edge.id)
    return [
      ...members.map((nodeId, index) => ({ ...fault, id: `${fault.id}:node:${index}`, sourceFaultId: fault.id, type: 'region-outage' as const, target: { kind: 'node' as const, id: nodeId } })),
      ...affectedEdges.map((edgeId, index) => ({ ...fault, id: `${fault.id}:edge:${index}`, sourceFaultId: fault.id, type: 'region-outage' as const, target: { kind: 'edge' as const, id: edgeId } })),
    ]
  })
  const operationFaults = expandedFaults.filter((fault) => {
    const target = fault.target ?? (fault.targetNodeId === undefined ? undefined : { kind: 'node' as const, id: fault.targetNodeId })
    return target?.kind === 'workload' && operationWorkloadIds.has(target.id)
  })
  const scenario = scenarioSchema.parse({
    schemaVersion: 1,
    id: project.id,
    name: project.name,
    seed: experiment.seed,
    nodes: project.topology.nodes.map((projectNode) => {
      const { componentVersion, rolePreset: _rolePreset, ...node } = projectNode
      const versioned = componentVersion > 1 ? { ...node, componentVersion } : node
      return node.type === 'traffic'
        ? { ...versioned, type: 'traffic' as const, config: { workloadId: experiment.workloads.find((workload) => workload.sourceNodeId === node.id)?.id ?? `${node.id}-workload` } }
        : versioned
    }),
    edges: project.topology.edges.map(({ sourceSemantic: _sourceSemantic, targetSemantic: _targetSemantic, routingMode: _routingMode, ...edge }) => ({ ...edge, sourcePort: 'out' as const, targetPort: 'in' as const })),
    workloads: experiment.workloads,
    faults: expandedFaults.filter((fault) => !operationFaults.includes(fault)),
    simulation: experiment.simulation,
  })
  if (operationFaults.length > 0) scenario.faults.push(...operationFaults)
  return scenario
}

export const createEmptyProject = (id = 'untitled-system'): ProjectFileV3 => projectFileV3Schema.parse({
  schemaVersion: 3,
  id,
  name: 'Untitled system',
  modelingMode: 'capacity-only',
  topology: { nodes: [], edges: [], groups: [], policies: [] },
  definitions: emptyBusinessDefinitions(),
  experiments: [{
    id: defaultExperimentId,
    name: 'Default experiment',
    workloads: [],
    faults: [],
    simulation: { durationSeconds: 30, sampleIntervalMs: 1_000, maxRequests: 100_000, traceLimit: 200, maxHops: 64 },
    seed: 'system-design',
    operationWorkloads: [],
  }],
  activeExperimentId: defaultExperimentId,
})
