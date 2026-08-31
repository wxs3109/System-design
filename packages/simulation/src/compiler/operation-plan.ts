import type {
  ApiOperation, ApiOperationReference, DataModel, InteractionAction, KeyDistribution, OperationMixEntry, ProjectFile, ValueSizeDistribution,
} from '@system-design/model'
import { serviceConfigSchema } from '@system-design/model'
import type { CompiledConnection } from './compiler'

export interface CompiledOperationAction {
  id: string
  kind: InteractionAction['kind']
  dependsOn: string[]
  condition?: InteractionAction['condition']
  nodeId: string
  sourceNodeId?: string
  edgeIds: string[]
  operationId?: string
  handlerTimeMs: number
  requestBytes?: number
  responseBytes?: number
  data?: CompiledDataAccess
  cache?: { operation: 'get' | 'put' | 'delete'; keyId: string; estimatedValueBytes: number; ttlSeconds?: number }
  event?: { operation: 'publish' | 'consume'; eventId: string; estimatedPayloadBytes: number; delivery: 'at-most-once' | 'at-least-once'; ordering: 'none' | 'partition-key' }
  realtime?: { operation: 'connect' | 'broadcast' | 'disconnect'; connectionPattern: string; channelPattern: string; messageBytes?: number }
  workflow?: CompiledWorkflow
  descriptiveFields: string[]
}

export interface CompiledWorkflowActivity {
  targetNodeId: string
  edgeIds: string[]
  operationId?: string
  requestBytes?: number
  responseBytes?: number
  handlerTimeMs: number
  serviceTimeMs: number
  jitterMs: number
  errorRate: number
  timeoutMs: number
  retry: { maxAttempts: number; backoff: 'fixed' | 'exponential'; baseDelayMs: number; maxDelayMs: number; jitterRatio: number }
}

export interface CompiledWorkflowStep extends CompiledWorkflowActivity {
  id: string
  compensation?: CompiledWorkflowActivity
}

export interface CompiledWorkflow {
  definitionId: string
  idempotencyKeyPattern: string
  steps: CompiledWorkflowStep[]
}

export interface CompiledDataAccess {
  modelId: string
  modelKind: DataModel['kind']
  objectId: string
  operation: Extract<InteractionAction, { kind: 'data-access' }>['operation']
  indexId?: string
  estimatedRows: number
  cardinality: number
  recordBytes: number
  indexKind?: 'btree' | 'hash'
}

export interface CompiledOperationPlan {
  id: string
  operation: ApiOperationReference
  interactionId: string
  sourceNodeId: string
  requestBytes: number
  responseBytes: number
  keyDistribution?: KeyDistribution
  valueSizeDistribution?: ValueSizeDistribution
  actions: CompiledOperationAction[]
}

export interface CompiledOperationPhase {
  id: string
  workloadId: string
  sourceNodeId: string
  startAtSeconds: number
  durationSeconds: number
  requestsPerSecond: number
  pattern: 'constant' | 'poisson'
  plans: Array<{ weight: number; plan: CompiledOperationPlan }>
}

export interface CompiledSchedulerWorkload {
  workloadId: string
  sourceNodeId: string
  plans: Array<{ weight: number; plan: CompiledOperationPlan }>
}

export interface CompiledOperations {
  phases: CompiledOperationPhase[]
  schedulerWorkloads: Map<string, CompiledSchedulerWorkload>
  plans: Map<string, CompiledOperationPlan>
  warnings: string[]
}

const referenceKey = (id: string, version: number) => `${id}@${version}`
const operationKey = (reference: ApiOperationReference) => `${reference.apiId}@${reference.apiVersion}:${reference.operationId}`
const interactionKey = (id: string, version: number) => `${id}@${version}`
const appendUnique = (values: string[], ...additions: string[]) => {
  for (const value of additions) if (!values.includes(value)) values.push(value)
}

const shortestPath = (source: string, target: string, outgoing: ReadonlyMap<string, CompiledConnection[]>, allowedModes?: ReadonlySet<CompiledConnection['routingMode']>) => {
  if (source === target) return []
  const queue = [source]
  const visited = new Set(queue)
  const previous = new Map<string, { nodeId: string; edge: CompiledConnection }>()
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const edge of outgoing.get(current) ?? []) {
      if (allowedModes && !allowedModes.has(edge.routingMode)) continue
      if (visited.has(edge.target)) continue
      visited.add(edge.target)
      previous.set(edge.target, { nodeId: current, edge })
      if (edge.target === target) {
        const path: CompiledConnection[] = []
        let cursor = target
        while (cursor !== source) {
          const step = previous.get(cursor)!
          path.unshift(step.edge)
          cursor = step.nodeId
        }
        return path
      }
      queue.push(edge.target)
    }
  }
  return undefined
}

const compileDataAccess = (action: Extract<InteractionAction, { kind: 'data-access' }>, model: DataModel): CompiledDataAccess => {
  let cardinality: number
  let recordBytes: number
  let indexKind: 'btree' | 'hash' | undefined
  if (model.kind === 'relational') {
    const object = model.tables.find((table) => table.id === action.objectId)
    if (!object) throw new Error(`Interaction action ${action.id} references unknown data object ${action.objectId}.`)
    cardinality = object.estimatedRows
    recordBytes = object.estimatedRowBytes
    const index = action.indexId ? [object.primaryKey, ...object.uniqueKeys, ...object.indexes].find((candidate) => candidate.id === action.indexId) : undefined
    indexKind = index ? ('kind' in index && (index.kind === 'btree' || index.kind === 'hash') ? index.kind : 'btree') : undefined
  } else if (model.kind === 'document') {
    const object = model.collections.find((collection) => collection.id === action.objectId)
    if (!object) throw new Error(`Interaction action ${action.id} references unknown data object ${action.objectId}.`)
    cardinality = object.estimatedDocuments
    recordBytes = object.estimatedDocumentBytes
    indexKind = action.indexId ? 'btree' : undefined
  } else {
    const object = model.namespaces.find((namespace) => namespace.id === action.objectId)
    if (!object) throw new Error(`Interaction action ${action.id} references unknown data object ${action.objectId}.`)
    cardinality = object.keyDistribution.keySpaceSize
    recordBytes = object.estimatedValueBytes
  }
  if (action.operation === 'range-read' && indexKind === 'hash') {
    throw new Error(`Interaction action ${action.id} cannot execute a range read through hash index ${action.indexId}.`)
  }
  return {
    modelId: referenceKey(model.id, model.version), modelKind: model.kind, objectId: action.objectId, operation: action.operation,
    ...(action.indexId === undefined ? {} : { indexId: action.indexId }), estimatedRows: action.estimatedRows ?? 1, cardinality, recordBytes,
    ...(indexKind === undefined ? {} : { indexKind }),
  }
}

const responseBytes = (operation: ApiOperation) => operation.responses.find((response) => response.statusCode.startsWith('2'))?.body?.estimatedBytes
  ?? operation.responses.find((response) => response.statusCode === 'default')?.body?.estimatedBytes ?? 1_024

/** Compiles business contracts into generic, topology-bound executable plans. */
export const compileOperationPlans = (project: ProjectFile, edges: readonly CompiledConnection[], outgoing: ReadonlyMap<string, CompiledConnection[]>): CompiledOperations => {
  const experiment = project.experiments.find((candidate) => candidate.id === project.activeExperimentId)!
  if (experiment.operationWorkloads.length === 0) return { phases: [], schedulerWorkloads: new Map(), plans: new Map(), warnings: [] }
  const operations = new Map(project.definitions.apis.flatMap((api) => api.operations.map((operation) => [operationKey({ apiId: api.id, apiVersion: api.version, operationId: operation.id }), { api, operation }] as const)))
  const interactions = new Map(project.definitions.interactions.map((interaction) => [interactionKey(interaction.id, interaction.version), interaction]))
  const models = new Map(project.definitions.dataModels.map((model) => [referenceKey(model.id, model.version), model]))
  const cacheKeys = new Map(project.definitions.cacheKeys.map((key) => [referenceKey(key.id, key.version), key]))
  const events = new Map(project.definitions.events.map((event) => [referenceKey(event.id, event.version), event]))
  const workflows = new Map(project.definitions.workflows.map((workflow) => [referenceKey(workflow.id, workflow.version), workflow]))
  const plans = new Map<string, CompiledOperationPlan>()
  const warnings = new Set<string>()
  const enabledNodeIds = new Set(project.topology.nodes.filter((node) => !node.disabled).map((node) => node.id))
  const topologyNodes = new Map(project.topology.nodes.map((node) => [node.id, node]))
  const requireEnabledNode = (nodeId: string, interactionId: string, actionId: string, role: 'source' | 'target') => {
    if (!enabledNodeIds.has(nodeId)) throw new Error(`Interaction ${interactionId} action ${actionId} has a disabled or missing ${role} node ${nodeId}.`)
  }

  const compileMix = (workloadId: string, workloadSourceNodeId: string, mix: OperationMixEntry): CompiledOperationPlan => {
    const id = `${workloadId}:${operationKey(mix.operation)}#${interactionKey(mix.interaction.interactionId, mix.interaction.interactionVersion)}`
    const existing = plans.get(id)
    if (existing) return existing
    const resolved = operations.get(operationKey(mix.operation))
    const interaction = interactions.get(interactionKey(mix.interaction.interactionId, mix.interaction.interactionVersion))
    if (!resolved || !interaction) throw new Error(`Cannot resolve operation plan ${id}.`)
    const entryAction = interaction.actions[0]
    if (entryAction?.kind !== 'api-call' || operationKey(entryAction.operation) !== operationKey(mix.operation)
      || entryAction.sourceNodeId !== workloadSourceNodeId || entryAction.targetNodeId !== resolved.api.ownerNodeId
      || entryAction.dependsOn.length > 0 || entryAction.condition !== undefined) {
      throw new Error(`Interaction ${interaction.id} must begin with an unconditional API call for operation ${mix.operation.operationId} from workload source ${workloadSourceNodeId} to API owner ${resolved.api.ownerNodeId}.`)
    }
    const actionById = new Map<string, CompiledOperationAction>()
    const executionContextByActionId = new Map<string, string>()
    const actions = interaction.actions.map((action) => {
      const predecessorIds = [...action.dependsOn, ...(action.condition === undefined ? [] : [action.condition.actionId])]
      const predecessorContexts = new Set(predecessorIds.map((predecessorId) => executionContextByActionId.get(predecessorId)).filter((nodeId): nodeId is string => nodeId !== undefined))
      const inferredCaller = predecessorContexts.size === 0 ? resolved.api.ownerNodeId : predecessorContexts.size === 1 ? [...predecessorContexts][0]! : undefined
      if ((action.kind === 'data-access' || action.kind === 'cache-access') && inferredCaller === undefined) {
        throw new Error(`Interaction ${interaction.id} action ${action.id} has ambiguous caller context across nodes ${[...predecessorContexts].join(', ')}. Add an explicit service-call action that joins the branches.`)
      }
      const sourceNodeId = action.kind === 'api-call' || action.kind === 'service-call' ? action.sourceNodeId
        : action.kind === 'event-publish' ? action.producerNodeId : action.kind === 'event-consume' ? action.brokerNodeId
          : inferredCaller!
      const nodeId = action.kind === 'api-call' || action.kind === 'service-call' ? action.targetNodeId
        : action.kind === 'data-access' || action.kind === 'cache-access' ? action.nodeId
          : action.kind === 'event-publish' ? action.brokerNodeId : action.kind === 'event-consume' ? action.consumerNodeId : action.nodeId
      const executionContextNodeId = action.kind === 'api-call' || action.kind === 'service-call' ? action.targetNodeId
        : action.kind === 'event-publish' ? action.producerNodeId : action.kind === 'event-consume' ? action.consumerNodeId : inferredCaller!
      requireEnabledNode(sourceNodeId, interaction.id, action.id, 'source')
      requireEnabledNode(nodeId, interaction.id, action.id, 'target')
      if (action.condition && (action.condition.outcome === 'cache-hit' || action.condition.outcome === 'cache-miss')) {
        const conditionSource = actionById.get(action.condition.actionId)
        if (conditionSource?.kind !== 'cache-access' || conditionSource.cache?.operation !== 'get') {
          throw new Error(`Interaction ${interaction.id} action ${action.id} tests ${action.condition.outcome}, but ${action.condition.actionId} is not a cache get action.`)
        }
      }
      const modes = action.kind === 'event-publish' || action.kind === 'event-consume' ? new Set<CompiledConnection['routingMode']>(['async-publish']) : new Set<CompiledConnection['routingMode']>(['weighted-one', 'fan-out'])
      const path = shortestPath(sourceNodeId, nodeId, outgoing, modes)
      if (!path) throw new Error(`Interaction ${interaction.id} action ${action.id} has no ${action.kind.startsWith('event-') ? 'async publish' : 'synchronous'} topology path from ${sourceNodeId} to ${nodeId}.`)
      const operation = 'operation' in action && action.operation && typeof action.operation === 'object' ? operations.get(operationKey(action.operation))?.operation : undefined
      const descriptiveFields: string[] = []
      if (operation) {
        appendUnique(descriptiveFields, 'api.method', 'api.path', 'api.payloadSchema', 'api.slo')
      }
      if (action.kind === 'event-publish' || action.kind === 'event-consume') appendUnique(descriptiveFields, 'event.payloadSchema', 'event.partitionKey', 'event.delivery', 'event.ordering')
      if (action.kind === 'cache-access') appendUnique(descriptiveFields, 'cache.pattern', 'cache.valueSchema')
      if (action.kind === 'data-access') {
        const model = models.get(referenceKey(action.model.modelId, action.model.modelVersion))!
        if (model.kind === 'relational') appendUnique(descriptiveFields, 'data.columns', 'data.keyColumns', 'data.foreignKeys', 'data.indexColumns', 'data.indexUniqueness')
        else if (model.kind === 'document') appendUnique(descriptiveFields, 'data.documentSchema', 'data.partitionKey', 'data.indexFields', 'data.indexUniqueness')
        else appendUnique(descriptiveFields, 'data.keySchema', 'data.valueSchema', 'data.keyDistribution', 'data.consistencyHint', 'data.ttlSeconds')
      }
      const compiled: CompiledOperationAction = {
        id: action.id, kind: action.kind, dependsOn: [...action.dependsOn], ...(action.condition === undefined ? {} : { condition: action.condition }), nodeId,
        ...(sourceNodeId === nodeId ? {} : { sourceNodeId }), edgeIds: path.map((edge) => edge.id),
        ...(operation === undefined ? {} : { operationId: operation.id, requestBytes: operation.request?.estimatedBytes ?? 1_024, responseBytes: responseBytes(operation) }),
        handlerTimeMs: operation?.handlerTimeMs ?? (action.kind === 'api-call' ? resolved.operation.handlerTimeMs ?? 0 : 0), descriptiveFields,
      }
      if (action.kind === 'data-access') {
        const model = models.get(referenceKey(action.model.modelId, action.model.modelVersion))!
        compiled.data = compileDataAccess(action, model)
      } else if (action.kind === 'cache-access') {
        const key = cacheKeys.get(referenceKey(action.key.cacheKeyId, action.key.cacheKeyVersion))!
        compiled.cache = { operation: action.operation, keyId: referenceKey(key.id, key.version), estimatedValueBytes: key.estimatedValueBytes, ...(key.ttlSeconds === undefined ? {} : { ttlSeconds: key.ttlSeconds }) }
      } else if (action.kind === 'event-publish' || action.kind === 'event-consume') {
        const event = events.get(referenceKey(action.event.eventId, action.event.eventVersion))!
        compiled.event = { operation: action.kind === 'event-publish' ? 'publish' : 'consume', eventId: referenceKey(event.id, event.version), estimatedPayloadBytes: event.estimatedPayloadBytes, delivery: event.delivery, ordering: event.ordering }
        if (action.kind === 'event-consume' && topologyNodes.get(action.brokerNodeId)?.type === 'topic') {
          const subscriptionEdges = outgoing.get(action.brokerNodeId)?.filter((edge) => edge.routingMode === 'async-publish') ?? []
          const targetEdge = path[0]
          const subscriptionIndex = targetEdge ? subscriptionEdges.findIndex((edge) => edge.id === targetEdge.id) : -1
          if (subscriptionIndex < 0) throw new Error(`Interaction ${interaction.id} action ${action.id} does not map to a Topic subscription edge.`)
          const duplicate = [...actionById.values()].find((candidate) => candidate.event?.operation === 'consume' && candidate.sourceNodeId === action.brokerNodeId && candidate.edgeIds[0] === targetEdge!.id)
          if (duplicate) throw new Error(`Interaction ${interaction.id} maps Topic consumer actions ${duplicate.id} and ${action.id} to the same subscription edge ${targetEdge!.id}.`)
        }
      } else if (action.kind === 'realtime') {
        compiled.realtime = { operation: action.operation, connectionPattern: action.connectionPattern, channelPattern: action.channelPattern, ...(action.messageBytes === undefined ? {} : { messageBytes: action.messageBytes }) }
      } else if (action.kind === 'workflow') {
        const workflow = workflows.get(referenceKey(action.workflow.workflowId, action.workflow.workflowVersion))!
        const compileActivity = (activity: typeof workflow.steps[number] | NonNullable<typeof workflow.steps[number]['compensation']>): CompiledWorkflowActivity => {
          requireEnabledNode(activity.targetNodeId, interaction.id, action.id, 'target')
          const path = shortestPath(action.nodeId, activity.targetNodeId, outgoing, new Set<CompiledConnection['routingMode']>(['weighted-one', 'fan-out']))
          if (!path) throw new Error(`Workflow ${workflow.id} has no synchronous topology path from ${action.nodeId} to step target ${activity.targetNodeId}.`)
          const operation = activity.operation ? operations.get(operationKey(activity.operation))?.operation : undefined
          const target = topologyNodes.get(activity.targetNodeId)
          if (!target || target.type !== 'service') throw new Error(`Workflow ${workflow.id} step target ${activity.targetNodeId} must be a Service.`)
          const targetConfig = serviceConfigSchema.parse(target.config)
          return {
            targetNodeId: activity.targetNodeId, edgeIds: path.map((edge) => edge.id),
            ...(operation === undefined ? {} : {
              operationId: operation.id, requestBytes: operation.request?.estimatedBytes ?? 1_024, responseBytes: responseBytes(operation),
            }), handlerTimeMs: operation?.handlerTimeMs ?? 0,
            serviceTimeMs: targetConfig.serviceTimeMs, jitterMs: targetConfig.jitterMs, errorRate: targetConfig.errorRate,
            timeoutMs: activity.timeoutMs, retry: { ...activity.retry },
          }
        }
        compiled.workflow = {
          definitionId: referenceKey(workflow.id, workflow.version), idempotencyKeyPattern: action.idempotencyKeyPattern,
          steps: workflow.steps.map((step) => ({ id: step.id, ...compileActivity(step), ...(step.compensation === undefined ? {} : { compensation: compileActivity(step.compensation) }) })),
        }
      }
      actionById.set(action.id, compiled)
      executionContextByActionId.set(action.id, executionContextNodeId)
      for (const field of descriptiveFields) warnings.add(`Interaction ${interaction.id} action ${action.id}: ${field} is descriptive and does not yet affect execution.`)
      return compiled
    })
    const plan: CompiledOperationPlan = {
      id, operation: mix.operation, interactionId: interactionKey(interaction.id, interaction.version), sourceNodeId: workloadSourceNodeId,
      requestBytes: mix.requestBytes ?? resolved.operation.request?.estimatedBytes ?? 1_024, responseBytes: mix.responseBytes ?? responseBytes(resolved.operation),
      ...(mix.keyDistribution === undefined ? {} : { keyDistribution: mix.keyDistribution }), ...(mix.valueSizeDistribution === undefined ? {} : { valueSizeDistribution: mix.valueSizeDistribution }), actions,
    }
    plans.set(id, plan)
    return plan
  }

  const sourceNodes = new Map(project.topology.nodes.map((node) => [node.id, node]))
  const compiledWorkloads = experiment.operationWorkloads.map((workload) => ({
    workload, plans: workload.operationMix.map((mix) => ({ weight: mix.weight, plan: compileMix(workload.id, workload.sourceNodeId, mix) })),
  }))
  const schedulerWorkloads = new Map<string, CompiledSchedulerWorkload>()
  for (const { workload, plans: workloadPlans } of compiledWorkloads) {
    if (sourceNodes.get(workload.sourceNodeId)?.type !== 'scheduler') continue
    if (schedulerWorkloads.has(workload.sourceNodeId)) throw new Error(`Scheduler ${workload.sourceNodeId} can bind only one operation workload.`)
    schedulerWorkloads.set(workload.sourceNodeId, { workloadId: workload.id, sourceNodeId: workload.sourceNodeId, plans: workloadPlans })
    warnings.add(`Operation workload ${workload.id} uses Scheduler timing; its arrival phases are not executed.`)
  }
  const phases = compiledWorkloads.flatMap(({ workload, plans: workloadPlans }) => sourceNodes.get(workload.sourceNodeId)?.type === 'scheduler' ? [] : workload.phases.map((phase) => ({
    ...phase, workloadId: workload.id, sourceNodeId: workload.sourceNodeId, plans: workloadPlans,
  })))
  const operationSources = new Set(experiment.operationWorkloads.map((workload) => workload.sourceNodeId))
  for (const workload of experiment.workloads) if (operationSources.has(workload.sourceNodeId)) warnings.add(`Operation workloads supersede legacy capacity workload ${workload.id} on source ${workload.sourceNodeId}.`)
  void edges
  return { phases, schedulerWorkloads, plans, warnings: [...warnings] }
}
