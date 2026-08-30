import { describe, expect, it } from 'vitest'
import { createOrderSystemContractFixture } from '@system-design/model'
import { POST as openApiPost } from './openapi/route'
import { POST as dbmlPost } from './dbml/route'

const request = (body: unknown) => new Request('http://localhost/api/formats', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

describe('server-only format routes', () => {
  it('exports and imports OpenAPI through the HTTP boundary', async () => {
    const project = createOrderSystemContractFixture()
    const exported = await openApiPost(request({ action: 'export', contracts: { api: project.definitions.apis[0], schemas: project.definitions.jsonSchemas } }))
    expect(exported.status).toBe(200)
    const imported = await openApiPost(request({ action: 'import', source: await exported.text(), apiId: 'orders-api', ownerNodeId: 'orders-service' }))
    expect(imported.status).toBe(200)
    expect((await imported.json()).api).toEqual(project.definitions.apis[0])
  })

  it('exports and imports DBML through the HTTP boundary', async () => {
    const model = createOrderSystemContractFixture().definitions.dataModels.find((candidate) => candidate.kind === 'relational')!
    const exported = await dbmlPost(request({ action: 'export', model }))
    expect(exported.status).toBe(200)
    const imported = await dbmlPost(request({ action: 'import', source: await exported.text(), options: { modelId: model.id, modelName: model.name, ownerNodeId: model.ownerNodeId, estimatedRows: 10_000_000, estimatedRowBytes: 512 } }))
    expect(imported.status).toBe(200)
    expect((await imported.json()).tables[0]).toMatchObject({ id: 'orders-table', estimatedRows: 10_000_000 })
  })

  it('returns actionable conversion errors', async () => {
    const response = await openApiPost(request({ action: 'import', source: '{}', apiId: 'api', ownerNodeId: 'service' }))
    expect(response.status).toBe(422)
    expect(await response.json()).toEqual(expect.objectContaining({ error: expect.any(String) }))
  })
})
