import {
  projectFileV3Schema,
  type ApiDefinition,
  type CacheKeyDefinition,
  type DataModel,
  type EventDefinition,
  type InteractionDefinition,
  type JsonSchemaDocument,
  type OperationWorkload,
  type ProjectFile,
} from '@system-design/model'
export type DefinitionKind = 'jsonSchemas' | 'apis' | 'dataModels' | 'events' | 'cacheKeys' | 'interactions' | 'operationWorkloads'
export type DataModelKind = DataModel['kind']
export type DefinitionResource = JsonSchemaDocument | ApiDefinition | DataModel | EventDefinition | CacheKeyDefinition | InteractionDefinition | OperationWorkload

export interface DefinitionSelection {
  kind: DefinitionKind
  id: string
  version?: number
}

export interface DefinitionListItem extends DefinitionSelection {
  name: string
  detail: string
}

export const definitionGroups: ReadonlyArray<{ kind: DefinitionKind; label: string; emptyLabel: string }> = [
  { kind: 'jsonSchemas', label: 'JSON Schemas', emptyLabel: 'No schemas' },
  { kind: 'apis', label: 'APIs', emptyLabel: 'No APIs' },
  { kind: 'dataModels', label: 'Data Models', emptyLabel: 'No data models' },
  { kind: 'events', label: 'Events', emptyLabel: 'No events' },
  { kind: 'cacheKeys', label: 'Cache Keys', emptyLabel: 'No cache keys' },
  { kind: 'interactions', label: 'Interactions', emptyLabel: 'No interactions' },
  { kind: 'operationWorkloads', label: 'Operation Workloads', emptyLabel: 'No operation workloads' },
]

const resourceKey = (entry: { id: string; version?: number }) => `${entry.id}@${entry.version ?? 0}`

export const selectionKey = (selection: DefinitionSelection) => `${selection.kind}:${resourceKey(selection)}`

const resourceDetail = (kind: DefinitionKind, resource: DefinitionResource) => {
  if (kind === 'apis') return `${(resource as ApiDefinition).operations.length} operations`
  if (kind === 'dataModels') {
    const model = resource as DataModel
    const count = model.kind === 'relational' ? model.tables.length : model.kind === 'document' ? model.collections.length : model.namespaces.length
    return `${model.kind} · ${count} objects`
  }
  if (kind === 'events') return (resource as EventDefinition).delivery
  if (kind === 'cacheKeys') return (resource as CacheKeyDefinition).pattern
  if (kind === 'interactions') return `${(resource as InteractionDefinition).actions.length} actions`
  if (kind === 'operationWorkloads') return `${(resource as OperationWorkload).operationMix.length} operation mix entries`
  return `v${(resource as JsonSchemaDocument).version}`
}

export const listDefinitionResources = (project: ProjectFile, kind: DefinitionKind): DefinitionListItem[] => {
  const resources: DefinitionResource[] = kind === 'operationWorkloads'
    ? project.experiments.find((experiment) => experiment.id === project.activeExperimentId)?.operationWorkloads ?? []
    : project.definitions[kind]
  return resources.map((resource) => ({
    kind, id: resource.id, ...('version' in resource ? { version: resource.version } : {}),
    name: resource.name, detail: resourceDetail(kind, resource),
  }))
}

export const findDefinitionResource = (project: ProjectFile, selection: DefinitionSelection): DefinitionResource | undefined => {
  const resources: DefinitionResource[] = selection.kind === 'operationWorkloads'
    ? project.experiments.find((experiment) => experiment.id === project.activeExperimentId)?.operationWorkloads ?? []
    : project.definitions[selection.kind]
  return resources.find((resource) => resource.id === selection.id && (!('version' in resource) || selection.version === resource.version))
}

const replaceInArray = <T extends { id: string }>(resources: T[], selection: DefinitionSelection, replacement: DefinitionResource) => resources.map((resource) => {
  const sameVersion = !('version' in resource) || selection.version === resource.version
  return resource.id === selection.id && sameVersion ? replacement as unknown as T : resource
})

export const replaceDefinitionResource = (project: ProjectFile, selection: DefinitionSelection, replacement: DefinitionResource): ProjectFile => {
  if (selection.kind === 'operationWorkloads') return {
    ...project,
    experiments: project.experiments.map((experiment) => experiment.id === project.activeExperimentId
      ? { ...experiment, operationWorkloads: replaceInArray(experiment.operationWorkloads, selection, replacement) }
      : experiment),
  }
  const definitions = { ...project.definitions }
  if (selection.kind === 'jsonSchemas') definitions.jsonSchemas = replaceInArray(definitions.jsonSchemas, selection, replacement)
  else if (selection.kind === 'apis') definitions.apis = replaceInArray(definitions.apis, selection, replacement)
  else if (selection.kind === 'dataModels') definitions.dataModels = replaceInArray(definitions.dataModels, selection, replacement)
  else if (selection.kind === 'events') definitions.events = replaceInArray(definitions.events, selection, replacement)
  else if (selection.kind === 'cacheKeys') definitions.cacheKeys = replaceInArray(definitions.cacheKeys, selection, replacement)
  else definitions.interactions = replaceInArray(definitions.interactions, selection, replacement)
  return { ...project, definitions }
}

export const removeDefinitionResource = (project: ProjectFile, selection: DefinitionSelection): ProjectFile => {
  const retain = (resource: { id: string; version?: number }) => resource.id !== selection.id || (resource.version !== undefined && resource.version !== selection.version)
  if (selection.kind === 'operationWorkloads') return {
    ...project,
    experiments: project.experiments.map((experiment) => experiment.id === project.activeExperimentId
      ? { ...experiment, operationWorkloads: experiment.operationWorkloads.filter(retain) }
      : experiment),
  }
  return { ...project, definitions: { ...project.definitions, [selection.kind]: project.definitions[selection.kind].filter(retain) } } as ProjectFile
}

const uniqueId = (base: string, used: Iterable<string>) => {
  const occupied = new Set(used)
  if (!occupied.has(base)) return base
  let suffix = 2
  while (occupied.has(`${base}-${suffix}`)) suffix += 1
  return `${base}-${suffix}`
}

const requireFirst = <T>(items: readonly T[], message: string): T => {
  const first = items[0]
  if (first === undefined) throw new Error(message)
  return first
}

const allResourceIds = (project: ProjectFile, kind: Exclude<DefinitionKind, 'operationWorkloads'>) => project.definitions[kind].map((resource) => resource.id)

export const createDefinitionResource = (project: ProjectFile, kind: DefinitionKind, modelKind: DataModelKind = 'relational'): DefinitionResource => {
  const schemas = project.definitions.jsonSchemas
  const services = project.topology.nodes.filter((node) => node.type === 'service')
  const databases = project.topology.nodes.filter((node) => node.type === 'database')
  const traffic = project.topology.nodes.filter((node) => node.type === 'traffic')
  if (kind === 'jsonSchemas') {
    const id = uniqueId('schema.NewObject', allResourceIds(project, kind))
    return { id, version: 1, name: 'New object', dialect: 'https://json-schema.org/draft/2020-12/schema', schema: { type: 'object', properties: {} } }
  }
  if (kind === 'apis') {
    const owner = requireFirst(services, 'Add a Service component before defining an API.')
    const id = uniqueId('api', allResourceIds(project, kind))
    const operationIds = project.definitions.apis.flatMap((api) => api.operations.map((operation) => operation.id))
    return { id, version: 1, name: 'New API', ownerNodeId: owner.id, operations: [{ id: uniqueId('operation', operationIds), name: 'New operation', method: 'GET', path: '/resource', responses: [{ statusCode: '200' }] }] }
  }
  if (kind === 'dataModels') {
    const owner = requireFirst(databases, 'Add a Database component before defining a data model.')
    const id = uniqueId(`${modelKind}-model`, allResourceIds(project, kind))
    if (modelKind === 'relational') return {
      id, version: 1, name: 'Relational model', ownerNodeId: owner.id, kind: 'relational',
      tables: [{ id: 'table', name: 'table', columns: [{ id: 'id', name: 'id', type: { kind: 'uuid' }, nullable: false }], primaryKey: { id: 'pk-table', name: 'table_pk', columnIds: ['id'] }, uniqueKeys: [], foreignKeys: [], indexes: [], estimatedRows: 1_000, estimatedRowBytes: 256 }],
    }
    const schema = requireFirst(schemas, `Add a JSON Schema before defining a ${modelKind} data model.`)
    if (modelKind === 'document') return {
      id, version: 1, name: 'Document model', ownerNodeId: owner.id, kind: 'document',
      collections: [{ id: 'collection', name: 'collection', documentSchema: { schemaId: schema.id, schemaVersion: schema.version }, partitionKey: '/id', secondaryIndexes: [], estimatedDocuments: 1_000, estimatedDocumentBytes: 1_024 }],
    }
    return {
      id, version: 1, name: 'Key-value model', ownerNodeId: owner.id, kind: 'key-value',
      namespaces: [{ id: 'namespace', name: 'namespace', keySchema: { schemaId: schema.id, schemaVersion: schema.version }, valueSchema: { schemaId: schema.id, schemaVersion: schema.version }, keyDistribution: { kind: 'uniform', keySpaceSize: 1_000 }, estimatedValueBytes: 512, consistencyHint: 'eventual' }],
    }
  }
  if (kind === 'events') {
    const schema = requireFirst(schemas, 'Add a JSON Schema before defining an event.')
    const producer = requireFirst(services, 'Add a Service component before defining an event.')
    const id = uniqueId('event', allResourceIds(project, kind))
    return { id, version: 1, name: 'New event', payloadSchema: { schemaId: schema.id, schemaVersion: schema.version }, estimatedPayloadBytes: 512, ordering: 'none', delivery: 'at-least-once', producerNodeId: producer.id, consumerNodeIds: [] }
  }
  if (kind === 'cacheKeys') {
    const id = uniqueId('cache-key', allResourceIds(project, kind))
    return { id, version: 1, name: 'New cache key', pattern: 'resource:{id}', estimatedValueBytes: 512 }
  }
  if (kind === 'interactions') {
    const api = requireFirst(project.definitions.apis, 'Add an API before defining an interaction.')
    const operation = requireFirst(api.operations, 'The selected API must contain an operation.')
    const source = traffic[0] ?? services[0]
    if (!source) throw new Error('Add a Traffic Generator or Service component before defining an interaction.')
    const id = uniqueId('interaction', allResourceIds(project, kind))
    const operationReference = { apiId: api.id, apiVersion: api.version, operationId: operation.id }
    return { id, version: 1, name: 'New interaction', entryOperation: operationReference, actions: [{ id: 'call-api', kind: 'api-call', dependsOn: [], sourceNodeId: source.id, targetNodeId: api.ownerNodeId, operation: operationReference }] }
  }
  const api = requireFirst(project.definitions.apis, 'Add an API before defining an operation workload.')
  const operation = requireFirst(api.operations, 'The selected API must contain an operation.')
  const interaction = requireFirst(project.definitions.interactions.filter((candidate) => candidate.entryOperation.apiId === api.id && candidate.entryOperation.apiVersion === api.version && candidate.entryOperation.operationId === operation.id), 'Add an interaction for an API operation before defining its workload.')
  const source = requireFirst(traffic, 'Add a Traffic Generator before defining an operation workload.')
  const activeExperiment = requireFirst(project.experiments.filter((experiment) => experiment.id === project.activeExperimentId), 'The active experiment does not exist.')
  const id = uniqueId('operation-workload', activeExperiment.operationWorkloads.map((workload) => workload.id))
  return {
    id, name: 'Operation workload', sourceNodeId: source.id,
    phases: [{ id: 'steady', startAtSeconds: 0, durationSeconds: activeExperiment.simulation.durationSeconds, requestsPerSecond: 100, pattern: 'poisson' }],
    operationMix: [{ operation: { apiId: api.id, apiVersion: api.version, operationId: operation.id }, interaction: { interactionId: interaction.id, interactionVersion: interaction.version }, weight: 1 }],
  }
}

export const addDefinitionResource = (project: ProjectFile, kind: DefinitionKind, resource: DefinitionResource): ProjectFile => {
  const businessAware = { ...project, modelingMode: 'business-aware' as const }
  if (kind === 'operationWorkloads') return {
    ...businessAware,
    experiments: businessAware.experiments.map((experiment) => experiment.id === businessAware.activeExperimentId
      ? { ...experiment, operationWorkloads: [...experiment.operationWorkloads, resource as OperationWorkload] }
      : experiment),
  }
  return { ...businessAware, definitions: { ...businessAware.definitions, [kind]: [...businessAware.definitions[kind], resource] } } as ProjectFile
}

export interface DefinitionValidationIssue { path: Array<string | number>; message: string }

export const validateDefinitionCandidate = (project: ProjectFile, selection: DefinitionSelection, resource: DefinitionResource): { project?: ProjectFile; issues: DefinitionValidationIssue[] } => {
  const parsed = projectFileV3Schema.safeParse(replaceDefinitionResource(project, selection, resource))
  return parsed.success ? { project: parsed.data, issues: [] } : { issues: parsed.error.issues.map((issue) => ({ path: issue.path.filter((part): part is string | number => typeof part === 'string' || typeof part === 'number'), message: issue.message })) }
}

export const referencedNodeIds = (resource: DefinitionResource): string[] => {
  const ids: string[] = []
  if ('ownerNodeId' in resource) ids.push(resource.ownerNodeId)
  if ('producerNodeId' in resource) ids.push(resource.producerNodeId, ...resource.consumerNodeIds)
  if ('sourceNodeId' in resource && !('actions' in resource)) ids.push(resource.sourceNodeId)
  if ('actions' in resource) resource.actions.forEach((action) => {
    if ('sourceNodeId' in action) ids.push(action.sourceNodeId)
    if ('targetNodeId' in action) ids.push(action.targetNodeId)
    if ('nodeId' in action) ids.push(action.nodeId)
    if ('producerNodeId' in action) ids.push(action.producerNodeId)
    if ('consumerNodeId' in action) ids.push(action.consumerNodeId)
    if ('brokerNodeId' in action) ids.push(action.brokerNodeId)
  })
  return [...new Set(ids)]
}
