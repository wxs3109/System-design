import { describe, expect, it } from 'vitest'
import { createOrderSystemContractFixture } from '@system-design/model'
import { exportOpenApi, importOpenApi } from './openapi'

describe('OpenAPI 3.1 adapter', () => {
  it('validates and round-trips the supported API and JSON Schema subset', async () => {
    const project = createOrderSystemContractFixture()
    const source = await exportOpenApi({ api: project.definitions.apis[0]!, schemas: project.definitions.jsonSchemas })
    const imported = await importOpenApi(source, { apiId: 'orders-api', ownerNodeId: 'orders-service' })
    expect(imported.api).toEqual(project.definitions.apis[0])
    expect(imported.schemas).toEqual(project.definitions.jsonSchemas)
  })

  it('rejects invalid versions and inline schemas instead of guessing lossy mappings', async () => {
    await expect(importOpenApi(JSON.stringify({ openapi: '3.0.3', info: { title: 'Old', version: '1' }, paths: {} }), { apiId: 'api', ownerNodeId: 'service' })).rejects.toThrow(/OpenAPI 3.1/)
    const inline = { openapi: '3.1.0', info: { title: 'Inline', version: '1' }, paths: { '/items': { post: { operationId: 'create', requestBody: { content: { 'application/json': { schema: { type: 'object' } } } }, responses: { '204': { description: 'ok' } } } } } }
    await expect(importOpenApi(JSON.stringify(inline), { apiId: 'api', ownerNodeId: 'service' })).rejects.toThrow(/inline request schema/)
  })

  it('preserves a JSON Schema title independently from its contract display name and stable ID', async () => {
    const project = createOrderSystemContractFixture()
    const schema = project.definitions.jsonSchemas[0]!
    schema.name = 'Order contract'
    schema.schema = { ...schema.schema as Record<string, unknown>, title: 'Domain order title' }
    const source = await exportOpenApi({ api: project.definitions.apis[0]!, schemas: project.definitions.jsonSchemas })
    const imported = await importOpenApi(source, { apiId: 'orders-api', ownerNodeId: 'orders-service' })
    expect(imported.schemas[0]).toEqual(schema)
    expect(imported.schemas[0]?.id).toBe('schema.CreateOrder')
  })

  it('exports inferred OpenAPI path parameters for modeled route templates', async () => {
    const project = createOrderSystemContractFixture()
    const document = JSON.parse(await exportOpenApi({ api: project.definitions.apis[0]!, schemas: project.definitions.jsonSchemas }))
    expect(document.paths['/orders/{id}'].get.parameters).toEqual([{
      name: 'id', in: 'path', required: true, schema: { type: 'string' },
    }])
  })
})
