import { z } from 'zod'

export const contractIdSchema = z.string().trim().min(1).max(120).regex(/^[A-Za-z][A-Za-z0-9._:-]*$/, 'IDs must start with a letter and contain only letters, numbers, dot, underscore, colon, or hyphen.')
export const contractVersionSchema = z.number().int().positive().max(1_000_000)
const contractNameSchema = z.string().trim().min(1).max(160)
const positiveBytesSchema = z.number().int().positive().max(1_000_000_000_000)
const jsonPointerSchema = z.string().refine((value) => value === '' || value.startsWith('/'), 'JSON Pointer must be empty or start with /.')

const uniqueValues = (values: readonly string[]) => new Set(values).size === values.length
const addDuplicateIssues = (values: readonly string[], path: (string | number)[], kind: string, context: z.RefinementCtx) => {
  const seen = new Set<string>()
  values.forEach((value, index) => {
    if (seen.has(value)) context.addIssue({ code: 'custom', path: [...path, index], message: `Duplicate ${kind}: ${value}` })
    seen.add(value)
  })
}

const versionedReferenceFields = { id: contractIdSchema, version: contractVersionSchema }
export const jsonSchemaReferenceSchema = z.object({ schemaId: contractIdSchema, schemaVersion: contractVersionSchema }).strict()
export const apiOperationReferenceSchema = z.object({ apiId: contractIdSchema, apiVersion: contractVersionSchema, operationId: contractIdSchema }).strict()
export const dataModelReferenceSchema = z.object({ modelId: contractIdSchema, modelVersion: contractVersionSchema }).strict()
export const eventReferenceSchema = z.object({ eventId: contractIdSchema, eventVersion: contractVersionSchema }).strict()
export const cacheKeyReferenceSchema = z.object({ cacheKeyId: contractIdSchema, cacheKeyVersion: contractVersionSchema }).strict()
export const interactionReferenceSchema = z.object({ interactionId: contractIdSchema, interactionVersion: contractVersionSchema }).strict()

export const jsonSchemaDocumentSchema = z.object({
  ...versionedReferenceFields,
  name: contractNameSchema,
  dialect: z.literal('https://json-schema.org/draft/2020-12/schema'),
  schema: z.union([z.boolean(), z.record(z.string(), z.unknown())]),
}).strict()

export const httpMethodSchema = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])
const httpPathSchema = z.string().trim().min(1).max(500).superRefine((path, context) => {
  if (!path.startsWith('/')) context.addIssue({ code: 'custom', message: 'HTTP paths must start with /.' })
  if (/\s|[?#]/.test(path)) context.addIssue({ code: 'custom', message: 'HTTP paths cannot contain whitespace, query strings, or fragments.' })
  const withoutParameters = path.replace(/\{[A-Za-z][A-Za-z0-9_]*\}/g, '')
  if (/[{}]/.test(withoutParameters)) context.addIssue({ code: 'custom', message: 'Path parameters must use balanced {name} syntax.' })
  const parameters = [...path.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map((match) => match[1]!)
  if (!uniqueValues(parameters)) context.addIssue({ code: 'custom', message: 'Path parameter names must be unique.' })
})

const payloadContractSchema = z.object({
  schema: jsonSchemaReferenceSchema,
  estimatedBytes: positiveBytesSchema,
}).strict()

const responseContractSchema = z.object({
  statusCode: z.string().regex(/^(default|[1-5][0-9]{2})$/, 'Response status must be default or an HTTP status code from 100 to 599.'),
  body: payloadContractSchema.optional(),
}).strict()

const sloTargetSchema = z.object({
  latencyP95Ms: z.number().finite().positive().optional(),
  availability: z.number().finite().min(0).max(1).optional(),
}).strict().refine((value) => value.latencyP95Ms !== undefined || value.availability !== undefined, 'An SLO target must define latency or availability.')

export const apiOperationSchema = z.object({
  id: contractIdSchema,
  name: contractNameSchema,
  method: httpMethodSchema,
  path: httpPathSchema,
  request: payloadContractSchema.optional(),
  responses: z.array(responseContractSchema).min(1).max(100),
  handlerTimeMs: z.number().finite().nonnegative().optional(),
  slo: sloTargetSchema.optional(),
}).strict().superRefine((operation, context) => {
  addDuplicateIssues(operation.responses.map((response) => response.statusCode), ['responses'], 'response status', context)
})

export const apiDefinitionSchema = z.object({
  ...versionedReferenceFields,
  name: contractNameSchema,
  ownerNodeId: contractIdSchema,
  operations: z.array(apiOperationSchema).min(1).max(10_000),
}).strict().superRefine((api, context) => {
  addDuplicateIssues(api.operations.map((operation) => operation.id), ['operations'], 'operation id', context)
  addDuplicateIssues(api.operations.map((operation) => `${operation.method} ${operation.path}`), ['operations'], 'method/path pair', context)
})

const stringColumnTypeSchema = z.object({ kind: z.literal('string'), maxLength: z.number().int().positive().max(1_000_000).optional() }).strict()
const integerColumnTypeSchema = z.object({ kind: z.literal('integer'), bits: z.union([z.literal(16), z.literal(32), z.literal(64)]).default(64) }).strict()
const decimalColumnTypeSchema = z.object({ kind: z.literal('decimal'), precision: z.number().int().min(1).max(1_000), scale: z.number().int().min(0).max(1_000) }).strict()
  .refine((value) => value.scale <= value.precision, { path: ['scale'], message: 'Decimal scale cannot exceed precision.' })
const simpleColumnType = <T extends string>(kind: T) => z.object({ kind: z.literal(kind) }).strict()
export const relationalColumnTypeSchema = z.discriminatedUnion('kind', [
  stringColumnTypeSchema, integerColumnTypeSchema, decimalColumnTypeSchema,
  simpleColumnType('number'), simpleColumnType('boolean'), simpleColumnType('uuid'), simpleColumnType('date'),
  simpleColumnType('datetime'), simpleColumnType('json'), simpleColumnType('binary'),
])

export const relationalColumnSchema = z.object({
  id: contractIdSchema,
  name: contractNameSchema,
  type: relationalColumnTypeSchema,
  nullable: z.boolean().default(false),
}).strict()

const relationalKeySchema = z.object({ id: contractIdSchema, name: contractNameSchema, columnIds: z.array(contractIdSchema).min(1).max(100) }).strict()
const relationalIndexSchema = relationalKeySchema.extend({
  kind: z.enum(['btree', 'hash']).default('btree'),
  unique: z.boolean().default(false),
  includedColumnIds: z.array(contractIdSchema).max(100).default([]),
}).strict()
const relationalForeignKeySchema = z.object({
  id: contractIdSchema,
  name: contractNameSchema,
  columnIds: z.array(contractIdSchema).min(1).max(100),
  referencedTableId: contractIdSchema,
  referencedColumnIds: z.array(contractIdSchema).min(1).max(100),
}).strict().refine((key) => key.columnIds.length === key.referencedColumnIds.length, { path: ['referencedColumnIds'], message: 'Foreign-key source and target column counts must match.' })

export const relationalTableSchema = z.object({
  id: contractIdSchema,
  name: contractNameSchema,
  columns: z.array(relationalColumnSchema).min(1).max(10_000),
  primaryKey: relationalKeySchema,
  uniqueKeys: z.array(relationalKeySchema).max(1_000).default([]),
  foreignKeys: z.array(relationalForeignKeySchema).max(10_000).default([]),
  indexes: z.array(relationalIndexSchema).max(10_000).default([]),
  estimatedRows: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  estimatedRowBytes: positiveBytesSchema,
}).strict().superRefine((table, context) => {
  const columnIds = new Set(table.columns.map((column) => column.id))
  addDuplicateIssues(table.columns.map((column) => column.id), ['columns'], 'column id', context)
  addDuplicateIssues([table.primaryKey.id, ...table.uniqueKeys.map((key) => key.id), ...table.indexes.map((index) => index.id)], ['indexes'], 'key or index id', context)
  const validateColumns = (ids: readonly string[], path: (string | number)[]) => ids.forEach((id, index) => {
    if (!columnIds.has(id)) context.addIssue({ code: 'custom', path: [...path, index], message: `Unknown table column: ${id}` })
  })
  validateColumns(table.primaryKey.columnIds, ['primaryKey', 'columnIds'])
  table.uniqueKeys.forEach((key, index) => validateColumns(key.columnIds, ['uniqueKeys', index, 'columnIds']))
  table.indexes.forEach((indexDefinition, index) => {
    validateColumns(indexDefinition.columnIds, ['indexes', index, 'columnIds'])
    validateColumns(indexDefinition.includedColumnIds, ['indexes', index, 'includedColumnIds'])
    if (!uniqueValues([...indexDefinition.columnIds, ...indexDefinition.includedColumnIds])) context.addIssue({ code: 'custom', path: ['indexes', index], message: 'An index cannot repeat a key or included column.' })
  })
  table.foreignKeys.forEach((key, index) => validateColumns(key.columnIds, ['foreignKeys', index, 'columnIds']))
})

const versionedDataModelFields = { ...versionedReferenceFields, name: contractNameSchema, ownerNodeId: contractIdSchema }
export const relationalDataModelSchema = z.object({
  ...versionedDataModelFields,
  kind: z.literal('relational'),
  tables: z.array(relationalTableSchema).min(1).max(10_000),
}).strict().superRefine((model, context) => {
  addDuplicateIssues(model.tables.map((table) => table.id), ['tables'], 'table id', context)
  const tables = new Map(model.tables.map((table) => [table.id, table]))
  model.tables.forEach((table, tableIndex) => table.foreignKeys.forEach((key, keyIndex) => {
    const target = tables.get(key.referencedTableId)
    if (!target) {
      context.addIssue({ code: 'custom', path: ['tables', tableIndex, 'foreignKeys', keyIndex, 'referencedTableId'], message: `Unknown referenced table: ${key.referencedTableId}` })
      return
    }
    const targetColumns = new Set(target.columns.map((column) => column.id))
    key.referencedColumnIds.forEach((columnId, columnIndex) => {
      if (!targetColumns.has(columnId)) context.addIssue({ code: 'custom', path: ['tables', tableIndex, 'foreignKeys', keyIndex, 'referencedColumnIds', columnIndex], message: `Unknown referenced column: ${columnId}` })
    })
  }))
})

export const documentIndexSchema = z.object({
  id: contractIdSchema,
  name: contractNameSchema,
  fields: z.array(z.object({ path: jsonPointerSchema, direction: z.enum(['asc', 'desc']).default('asc') }).strict()).min(1).max(100),
  unique: z.boolean().default(false),
}).strict()

export const documentCollectionSchema = z.object({
  id: contractIdSchema,
  name: contractNameSchema,
  documentSchema: jsonSchemaReferenceSchema,
  partitionKey: jsonPointerSchema,
  secondaryIndexes: z.array(documentIndexSchema).max(10_000).default([]),
  estimatedDocuments: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  estimatedDocumentBytes: positiveBytesSchema,
}).strict().superRefine((collection, context) => {
  addDuplicateIssues(collection.secondaryIndexes.map((index) => index.id), ['secondaryIndexes'], 'document index id', context)
  collection.secondaryIndexes.forEach((index, indexIndex) => addDuplicateIssues(index.fields.map((field) => field.path), ['secondaryIndexes', indexIndex, 'fields'], 'index field', context))
})

export const documentDataModelSchema = z.object({
  ...versionedDataModelFields,
  kind: z.literal('document'),
  collections: z.array(documentCollectionSchema).min(1).max(10_000),
}).strict().superRefine((model, context) => addDuplicateIssues(model.collections.map((collection) => collection.id), ['collections'], 'collection id', context))

export const keyDistributionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('uniform'), keySpaceSize: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict(),
  z.object({ kind: z.literal('hotspot'), keySpaceSize: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), hotKeyCount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), hotTrafficFraction: z.number().finite().min(0).max(1) }).strict()
    .refine((value) => value.hotKeyCount <= value.keySpaceSize, { path: ['hotKeyCount'], message: 'Hot-key count cannot exceed key-space size.' }),
  z.object({ kind: z.literal('zipfian'), keySpaceSize: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), exponent: z.number().finite().positive().max(10) }).strict(),
])

export const valueSizeDistributionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('fixed'), bytes: positiveBytesSchema }).strict(),
  z.object({ kind: z.literal('uniform'), minBytes: positiveBytesSchema, maxBytes: positiveBytesSchema }).strict()
    .refine((value) => value.minBytes <= value.maxBytes, { path: ['maxBytes'], message: 'Maximum bytes must be at least minimum bytes.' }),
])

export const keyValueNamespaceSchema = z.object({
  id: contractIdSchema,
  name: contractNameSchema,
  keySchema: jsonSchemaReferenceSchema,
  valueSchema: jsonSchemaReferenceSchema,
  keyDistribution: keyDistributionSchema,
  estimatedValueBytes: positiveBytesSchema,
  ttlSeconds: z.number().finite().positive().max(31_536_000).optional(),
  consistencyHint: z.enum(['strong', 'eventual', 'session']).default('eventual'),
}).strict()

export const keyValueDataModelSchema = z.object({
  ...versionedDataModelFields,
  kind: z.literal('key-value'),
  namespaces: z.array(keyValueNamespaceSchema).min(1).max(10_000),
}).strict().superRefine((model, context) => addDuplicateIssues(model.namespaces.map((namespace) => namespace.id), ['namespaces'], 'namespace id', context))

export const dataModelSchema = z.discriminatedUnion('kind', [relationalDataModelSchema, documentDataModelSchema, keyValueDataModelSchema])

export const eventDefinitionSchema = z.object({
  ...versionedReferenceFields,
  name: contractNameSchema,
  payloadSchema: jsonSchemaReferenceSchema,
  estimatedPayloadBytes: positiveBytesSchema,
  partitionKey: jsonPointerSchema.optional(),
  ordering: z.enum(['none', 'partition-key']).default('none'),
  delivery: z.enum(['at-most-once', 'at-least-once']).default('at-least-once'),
  producerNodeId: contractIdSchema,
  consumerNodeIds: z.array(contractIdSchema).max(10_000).default([]),
}).strict().superRefine((event, context) => {
  addDuplicateIssues(event.consumerNodeIds, ['consumerNodeIds'], 'consumer node', context)
  if (event.ordering === 'partition-key' && event.partitionKey === undefined) context.addIssue({ code: 'custom', path: ['partitionKey'], message: 'Partition-key ordering requires a partition key.' })
})

export const cacheKeyDefinitionSchema = z.object({
  ...versionedReferenceFields,
  name: contractNameSchema,
  pattern: z.string().trim().min(1).max(500),
  valueSchema: jsonSchemaReferenceSchema.optional(),
  estimatedValueBytes: positiveBytesSchema,
  ttlSeconds: z.number().finite().positive().max(31_536_000).optional(),
}).strict()

const actionBaseFields = {
  id: contractIdSchema,
  name: contractNameSchema.optional(),
  dependsOn: z.array(contractIdSchema).max(100).default([]),
  condition: z.object({ actionId: contractIdSchema, outcome: z.enum(['success', 'failure', 'cache-hit', 'cache-miss']) }).strict().optional(),
}

const apiCallActionSchema = z.object({
  ...actionBaseFields, kind: z.literal('api-call'), sourceNodeId: contractIdSchema, targetNodeId: contractIdSchema, operation: apiOperationReferenceSchema,
}).strict()
const serviceCallActionSchema = z.object({
  ...actionBaseFields, kind: z.literal('service-call'), sourceNodeId: contractIdSchema, targetNodeId: contractIdSchema, operation: apiOperationReferenceSchema.optional(),
}).strict()
const dataAccessActionSchema = z.object({
  ...actionBaseFields, kind: z.literal('data-access'), nodeId: contractIdSchema, model: dataModelReferenceSchema, objectId: contractIdSchema,
  operation: z.enum(['point-read', 'index-read', 'range-read', 'scan', 'insert', 'update', 'delete']),
  indexId: contractIdSchema.optional(), estimatedRows: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
}).strict().superRefine((action, context) => {
  const needsIndex = action.operation === 'index-read' || action.operation === 'range-read'
  if (needsIndex && !action.indexId) context.addIssue({ code: 'custom', path: ['indexId'], message: `${action.operation} requires an index.` })
  if (!needsIndex && action.indexId) context.addIssue({ code: 'custom', path: ['indexId'], message: `${action.operation} cannot select a secondary index.` })
})
const cacheAccessActionSchema = z.object({
  ...actionBaseFields, kind: z.literal('cache-access'), nodeId: contractIdSchema, operation: z.enum(['get', 'put', 'delete']), key: cacheKeyReferenceSchema,
}).strict()
const eventPublishActionSchema = z.object({
  ...actionBaseFields, kind: z.literal('event-publish'), producerNodeId: contractIdSchema, brokerNodeId: contractIdSchema, event: eventReferenceSchema,
}).strict()
const eventConsumeActionSchema = z.object({
  ...actionBaseFields, kind: z.literal('event-consume'), consumerNodeId: contractIdSchema, brokerNodeId: contractIdSchema, event: eventReferenceSchema,
}).strict()
const realtimeActionSchema = z.object({
  ...actionBaseFields, kind: z.literal('realtime'), nodeId: contractIdSchema, operation: z.enum(['connect', 'broadcast', 'disconnect']),
  connectionPattern: z.string().trim().min(1).max(500).default('connection:{request}'),
  channelPattern: z.string().trim().min(1).max(500).default('channel:{key}'), messageBytes: positiveBytesSchema.optional(),
}).strict().superRefine((action, context) => {
  if (action.operation === 'broadcast' && action.messageBytes === undefined) context.addIssue({ code: 'custom', path: ['messageBytes'], message: 'Broadcast requires a message size.' })
  if (action.operation !== 'broadcast' && action.messageBytes !== undefined) context.addIssue({ code: 'custom', path: ['messageBytes'], message: `${action.operation} cannot define a message size.` })
})

export const interactionActionSchema = z.discriminatedUnion('kind', [
  apiCallActionSchema, serviceCallActionSchema, dataAccessActionSchema, cacheAccessActionSchema, eventPublishActionSchema, eventConsumeActionSchema, realtimeActionSchema,
])

export const interactionDefinitionSchema = z.object({
  ...versionedReferenceFields,
  name: contractNameSchema,
  entryOperation: apiOperationReferenceSchema,
  actions: z.array(interactionActionSchema).min(1).max(10_000),
}).strict().superRefine((interaction, context) => {
  addDuplicateIssues(interaction.actions.map((action) => action.id), ['actions'], 'action id', context)
  const prior = new Set<string>()
  interaction.actions.forEach((action, index) => {
    addDuplicateIssues(action.dependsOn, ['actions', index, 'dependsOn'], 'dependency', context)
    action.dependsOn.forEach((dependency, dependencyIndex) => {
      if (!prior.has(dependency)) context.addIssue({ code: 'custom', path: ['actions', index, 'dependsOn', dependencyIndex], message: `Action dependencies must reference an earlier action: ${dependency}` })
    })
    if (action.condition && !prior.has(action.condition.actionId)) context.addIssue({ code: 'custom', path: ['actions', index, 'condition', 'actionId'], message: `Action conditions must reference an earlier action: ${action.condition.actionId}` })
    prior.add(action.id)
  })
})

export const businessDefinitionsSchema = z.object({
  schemaVersion: z.literal(1),
  jsonSchemas: z.array(jsonSchemaDocumentSchema).max(10_000).default([]),
  apis: z.array(apiDefinitionSchema).max(10_000).default([]),
  dataModels: z.array(dataModelSchema).max(10_000).default([]),
  events: z.array(eventDefinitionSchema).max(10_000).default([]),
  cacheKeys: z.array(cacheKeyDefinitionSchema).max(10_000).default([]),
  interactions: z.array(interactionDefinitionSchema).max(10_000).default([]),
}).strict().superRefine((definitions, context) => {
  addDuplicateIssues(definitions.jsonSchemas.map((entry) => `${entry.id}@${entry.version}`), ['jsonSchemas'], 'JSON Schema version', context)
  addDuplicateIssues(definitions.apis.map((entry) => `${entry.id}@${entry.version}`), ['apis'], 'API version', context)
  addDuplicateIssues(definitions.dataModels.map((entry) => `${entry.id}@${entry.version}`), ['dataModels'], 'data-model version', context)
  addDuplicateIssues(definitions.events.map((entry) => `${entry.id}@${entry.version}`), ['events'], 'event version', context)
  addDuplicateIssues(definitions.cacheKeys.map((entry) => `${entry.id}@${entry.version}`), ['cacheKeys'], 'cache-key version', context)
  addDuplicateIssues(definitions.interactions.map((entry) => `${entry.id}@${entry.version}`), ['interactions'], 'interaction version', context)
  const operationIds = definitions.apis.flatMap((api) => api.operations.map((operation) => operation.id))
  addDuplicateIssues(operationIds, ['apis'], 'global operation id', context)
})

export const arrivalPhaseSchema = z.object({
  id: contractIdSchema,
  startAtSeconds: z.number().finite().nonnegative(),
  durationSeconds: z.number().finite().positive().max(86_400),
  requestsPerSecond: z.number().finite().positive().max(1_000_000),
  pattern: z.enum(['constant', 'poisson']).default('poisson'),
}).strict()

export const operationMixEntrySchema = z.object({
  operation: apiOperationReferenceSchema,
  interaction: interactionReferenceSchema,
  weight: z.number().finite().positive(),
  requestBytes: positiveBytesSchema.optional(),
  responseBytes: positiveBytesSchema.optional(),
  keyDistribution: keyDistributionSchema.optional(),
  valueSizeDistribution: valueSizeDistributionSchema.optional(),
}).strict()

export const operationWorkloadSchema = z.object({
  id: contractIdSchema,
  name: contractNameSchema,
  sourceNodeId: contractIdSchema,
  phases: z.array(arrivalPhaseSchema).min(1).max(1_000),
  operationMix: z.array(operationMixEntrySchema).min(1).max(10_000),
}).strict().superRefine((workload, context) => {
  addDuplicateIssues(workload.phases.map((phase) => phase.id), ['phases'], 'arrival phase id', context)
  addDuplicateIssues(workload.operationMix.map((entry) => `${entry.operation.apiId}@${entry.operation.apiVersion}:${entry.operation.operationId}`), ['operationMix'], 'operation mix entry', context)
})

export const emptyBusinessDefinitions = (): BusinessDefinitions => ({
  schemaVersion: 1, jsonSchemas: [], apis: [], dataModels: [], events: [], cacheKeys: [], interactions: [],
})

export type JsonSchemaReference = z.infer<typeof jsonSchemaReferenceSchema>
export type ApiOperationReference = z.infer<typeof apiOperationReferenceSchema>
export type DataModelReference = z.infer<typeof dataModelReferenceSchema>
export type EventReference = z.infer<typeof eventReferenceSchema>
export type CacheKeyReference = z.infer<typeof cacheKeyReferenceSchema>
export type InteractionReference = z.infer<typeof interactionReferenceSchema>
export type JsonSchemaDocument = z.infer<typeof jsonSchemaDocumentSchema>
export type ApiDefinition = z.infer<typeof apiDefinitionSchema>
export type ApiOperation = z.infer<typeof apiOperationSchema>
export type RelationalDataModel = z.infer<typeof relationalDataModelSchema>
export type DocumentDataModel = z.infer<typeof documentDataModelSchema>
export type KeyValueDataModel = z.infer<typeof keyValueDataModelSchema>
export type DataModel = z.infer<typeof dataModelSchema>
export type EventDefinition = z.infer<typeof eventDefinitionSchema>
export type CacheKeyDefinition = z.infer<typeof cacheKeyDefinitionSchema>
export type InteractionAction = z.infer<typeof interactionActionSchema>
export type InteractionDefinition = z.infer<typeof interactionDefinitionSchema>
export type BusinessDefinitions = z.infer<typeof businessDefinitionsSchema>
export type KeyDistribution = z.infer<typeof keyDistributionSchema>
export type ValueSizeDistribution = z.infer<typeof valueSizeDistributionSchema>
export type ArrivalPhase = z.infer<typeof arrivalPhaseSchema>
export type OperationMixEntry = z.infer<typeof operationMixEntrySchema>
export type OperationWorkload = z.infer<typeof operationWorkloadSchema>
