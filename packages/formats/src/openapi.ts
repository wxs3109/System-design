import { validate } from '@scalar/openapi-parser'
import { apiDefinitionSchema, jsonSchemaDocumentSchema, type ApiDefinition, type JsonSchemaDocument } from '@system-design/model'

export interface FormatIssue { path: Array<string | number>; message: string }
export interface OpenApiImportOptions { apiId: string; ownerNodeId: string }
export interface OpenApiContracts { api: ApiDefinition; schemas: JsonSchemaDocument[] }

const objectValue = (value: unknown): Record<string, unknown> | undefined => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
const contractId = (value: string, fallback: string) => {
  const normalized = value.replace(/[^A-Za-z0-9._:-]+/g, '-').replace(/^[^A-Za-z]+/, '')
  return normalized || fallback
}
const schemaNameFor = (schema: JsonSchemaDocument) => contractId(schema.name, contractId(schema.id.replace(/^schema\./, ''), 'Object'))
const schemaIdFor = (name: string) => `schema.${contractId(name, 'Object')}`
const referenceName = (value: unknown) => {
  const reference = objectValue(value)?.$ref
  return typeof reference === 'string' && reference.startsWith('#/components/schemas/') ? decodeURIComponent(reference.slice('#/components/schemas/'.length)) : undefined
}
const positiveInteger = (value: unknown, fallback: number) => typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback

export async function importOpenApi(source: string, options: OpenApiImportOptions): Promise<OpenApiContracts> {
  const validation = await validate(source)
  if (!validation.valid) throw new Error(`Invalid OpenAPI document: ${validation.errors?.[0]?.message ?? 'validation failed'}`)
  const document = JSON.parse(source) as Record<string, unknown>
  if (typeof document.openapi !== 'string' || !document.openapi.startsWith('3.1.')) throw new Error('Only OpenAPI 3.1 documents are supported.')
  const info = objectValue(document.info) ?? {}
  const components = objectValue(document.components)
  const schemaEntries = Object.entries(objectValue(components?.schemas) ?? {})
  const schemas = schemaEntries.map(([key, rawSchema]) => {
    const schema = objectValue(rawSchema) ?? rawSchema
    const schemaObject = objectValue(schema)
    const exportedName = typeof schemaObject?.['x-system-design-name'] === 'string' ? schemaObject['x-system-design-name'] : undefined
    const normalizedSchema = schemaObject
      ? Object.fromEntries(Object.entries(schemaObject).filter(([property]) => !property.startsWith('x-system-design-')))
      : schema
    return jsonSchemaDocumentSchema.parse({
    id: typeof schemaObject?.['x-system-design-id'] === 'string' ? schemaObject['x-system-design-id'] : schemaIdFor(key), version: positiveInteger(schemaObject?.['x-system-design-version'], 1), name: exportedName ?? (typeof schemaObject?.title === 'string' ? schemaObject.title : key), dialect: 'https://json-schema.org/draft/2020-12/schema', schema: normalizedSchema,
  }) })
  const schemaByComponentName = new Map(schemaEntries.map(([key], index) => [key, schemas[index]!]))
  const schemaReferenceForName = (name: string) => {
    const schema = schemaByComponentName.get(name)
    return schema ? { schemaId: schema.id, schemaVersion: schema.version } : { schemaId: schemaIdFor(name), schemaVersion: 1 }
  }
  const paths = objectValue(document.paths) ?? {}
  const operations: ApiDefinition['operations'] = []
  const methods = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options'])
  for (const [path, pathItemValue] of Object.entries(paths)) {
    const pathItem = objectValue(pathItemValue)
    if (!pathItem) continue
    for (const [method, operationValue] of Object.entries(pathItem)) {
      if (!methods.has(method)) continue
      const operation = objectValue(operationValue) ?? {}
      const requestBody = objectValue(operation.requestBody)
      const requestContent = objectValue(requestBody?.content)
      const requestMedia = objectValue(requestContent?.['application/json'])
      const requestSchemaName = referenceName(requestMedia?.schema)
      if (requestMedia?.schema && !requestSchemaName) throw new Error(`${method.toUpperCase()} ${path} uses an inline request schema; move it to components.schemas for lossless import.`)
      const responsesObject = objectValue(operation.responses) ?? {}
      const responses = Object.entries(responsesObject).map(([statusCode, responseValue]) => {
        const response = objectValue(responseValue) ?? {}
        const content = objectValue(response.content)
        const media = objectValue(content?.['application/json'])
        const responseSchemaName = referenceName(media?.schema)
        if (media?.schema && !responseSchemaName) throw new Error(`${method.toUpperCase()} ${path} response ${statusCode} uses an inline schema; move it to components.schemas for lossless import.`)
        return { statusCode, ...(responseSchemaName ? { body: { schema: schemaReferenceForName(responseSchemaName), estimatedBytes: positiveInteger(media?.['x-estimated-bytes'], 1_024) } } : {}) }
      })
      operations.push({
        id: contractId(typeof operation.operationId === 'string' ? operation.operationId : `${method}-${path}`, 'operation'),
        name: typeof operation.summary === 'string' ? operation.summary : typeof operation.operationId === 'string' ? operation.operationId : `${method.toUpperCase()} ${path}`,
        method: method.toUpperCase() as ApiDefinition['operations'][number]['method'], path,
        ...(requestSchemaName ? { request: { schema: schemaReferenceForName(requestSchemaName), estimatedBytes: positiveInteger(requestMedia?.['x-estimated-bytes'], 1_024) } } : {}),
        responses,
        ...(typeof operation['x-handler-time-ms'] === 'number' ? { handlerTimeMs: operation['x-handler-time-ms'] } : {}),
        ...(objectValue(operation['x-slo']) ? { slo: operation['x-slo'] as { latencyP95Ms?: number; availability?: number } } : {}),
      })
    }
  }
  return {
    schemas,
    api: apiDefinitionSchema.parse({ id: contractId(options.apiId, 'api'), version: 1, name: typeof info.title === 'string' ? info.title : options.apiId, ownerNodeId: options.ownerNodeId, operations }),
  }
}

export async function exportOpenApi(contracts: OpenApiContracts): Promise<string> {
  const api = apiDefinitionSchema.parse(contracts.api)
  const schemas = contracts.schemas.map((schema) => jsonSchemaDocumentSchema.parse(schema))
  const names = new Map(schemas.map((schema) => [`${schema.id}@${schema.version}`, schemaNameFor(schema)]))
  const schemaReference = (reference: { schemaId: string; schemaVersion: number }) => {
    const name = names.get(`${reference.schemaId}@${reference.schemaVersion}`)
    if (!name) throw new Error(`Unknown JSON Schema: ${reference.schemaId}@${reference.schemaVersion}`)
    return { $ref: `#/components/schemas/${encodeURIComponent(name)}` }
  }
  const paths: Record<string, Record<string, unknown>> = {}
  for (const operation of api.operations) {
    const responseEntries = operation.responses.map((response) => [response.statusCode, {
      description: response.statusCode === 'default' ? 'Default response' : `HTTP ${response.statusCode}`,
      ...(response.body ? { content: { 'application/json': { schema: schemaReference(response.body.schema), 'x-estimated-bytes': response.body.estimatedBytes } } } : {}),
    }])
    ;(paths[operation.path] ??= {})[operation.method.toLowerCase()] = {
      operationId: operation.id, summary: operation.name,
      ...(operation.request ? { requestBody: { required: true, content: { 'application/json': { schema: schemaReference(operation.request.schema), 'x-estimated-bytes': operation.request.estimatedBytes } } } } : {}),
      responses: Object.fromEntries(responseEntries),
      ...(operation.handlerTimeMs === undefined ? {} : { 'x-handler-time-ms': operation.handlerTimeMs }),
      ...(operation.slo === undefined ? {} : { 'x-slo': operation.slo }),
    }
  }
  const document = { openapi: '3.1.0', info: { title: api.name, version: String(api.version) }, paths, components: { schemas: Object.fromEntries(schemas.map((schema) => [schemaNameFor(schema), typeof schema.schema === 'boolean' ? schema.schema : { ...schema.schema, 'x-system-design-id': schema.id, 'x-system-design-version': schema.version, 'x-system-design-name': schema.name }])) } }
  const source = JSON.stringify(document, null, 2)
  const validation = await validate(source)
  if (!validation.valid) throw new Error(`Generated invalid OpenAPI: ${validation.errors?.[0]?.message ?? 'validation failed'}`)
  return source
}
