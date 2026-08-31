import { describe, expect, it } from 'vitest'
import {
  apiDefinitionSchema,
  businessDefinitionsSchema,
  dataModelSchema,
  interactionDefinitionSchema,
  operationWorkloadSchema,
  workflowDefinitionSchema,
} from './business-contracts'

const schemaRef = { schemaId: 'schema.Order', schemaVersion: 1 }

describe('business contract primitives', () => {
  it('accepts distinct relational, document, and key-value models', () => {
    const models = [
      {
        id: 'orders', version: 1, name: 'Orders', ownerNodeId: 'orders-db', kind: 'relational',
        tables: [{
          id: 'orders-table', name: 'orders',
          columns: [
            { id: 'id', name: 'id', type: { kind: 'uuid' }, nullable: false },
            { id: 'customer-id', name: 'customer_id', type: { kind: 'uuid' }, nullable: false },
          ],
          primaryKey: { id: 'pk-orders', name: 'orders_pk', columnIds: ['id'] },
          uniqueKeys: [], foreignKeys: [],
          indexes: [{ id: 'ix-customer', name: 'orders_customer', columnIds: ['customer-id'], includedColumnIds: ['id'], kind: 'btree', unique: false }],
          estimatedRows: 1_000_000, estimatedRowBytes: 256,
        }],
      },
      {
        id: 'profiles', version: 1, name: 'Profiles', ownerNodeId: 'profiles-db', kind: 'document',
        collections: [{ id: 'profiles-collection', name: 'profiles', documentSchema: schemaRef, partitionKey: '/tenantId', secondaryIndexes: [], estimatedDocuments: 50_000, estimatedDocumentBytes: 2_048 }],
      },
      {
        id: 'sessions', version: 1, name: 'Sessions', ownerNodeId: 'sessions-db', kind: 'key-value',
        namespaces: [{ id: 'session', name: 'session', keySchema: schemaRef, valueSchema: schemaRef, keyDistribution: { kind: 'uniform', keySpaceSize: 1_000 }, estimatedValueBytes: 512, ttlSeconds: 3_600, consistencyHint: 'session' }],
      },
    ]
    expect(models.map((model) => dataModelSchema.parse(model).kind)).toEqual(['relational', 'document', 'key-value'])
  })

  it('rejects duplicate API operations, method/path pairs, and invalid paths', () => {
    const operation = { id: 'create-order', name: 'Create order', method: 'POST', path: '/orders', responses: [{ statusCode: '201' }] }
    const api = { id: 'orders-api', version: 1, name: 'Orders API', ownerNodeId: 'orders-service', operations: [operation, { ...operation, id: 'create-order-copy' }] }
    expect(apiDefinitionSchema.safeParse(api).success).toBe(false)
    expect(apiDefinitionSchema.safeParse({ ...api, operations: [{ ...operation, path: 'orders?bad=true' }] }).success).toBe(false)
  })

  it('rejects invalid table indexes and forward interaction dependencies', () => {
    const relational = {
      id: 'orders', version: 1, name: 'Orders', ownerNodeId: 'db', kind: 'relational',
      tables: [{ id: 'orders-table', name: 'orders', columns: [{ id: 'id', name: 'id', type: { kind: 'uuid' }, nullable: false }], primaryKey: { id: 'pk', name: 'pk', columnIds: ['missing'] }, uniqueKeys: [], foreignKeys: [], indexes: [], estimatedRows: 1, estimatedRowBytes: 32 }],
    }
    expect(dataModelSchema.safeParse(relational).success).toBe(false)
    const interaction = {
      id: 'create-order-flow', version: 1, name: 'Create order flow', entryOperation: { apiId: 'orders-api', apiVersion: 1, operationId: 'create-order' },
      actions: [{ id: 'persist', kind: 'data-access', dependsOn: ['later'], nodeId: 'db', model: { modelId: 'orders', modelVersion: 1 }, objectId: 'orders-table', operation: 'insert' }],
    }
    expect(interactionDefinitionSchema.safeParse(interaction).success).toBe(false)
  })

  it('requires valid workload phases and unique operation entries', () => {
    const mix = { operation: { apiId: 'orders-api', apiVersion: 1, operationId: 'create-order' }, interaction: { interactionId: 'create-order-flow', interactionVersion: 1 }, weight: 1 }
    expect(operationWorkloadSchema.safeParse({ id: 'load', name: 'Load', sourceNodeId: 'traffic', phases: [{ id: 'steady', startAtSeconds: 0, durationSeconds: 10, requestsPerSecond: 10 }], operationMix: [mix, mix] }).success).toBe(false)
  })

  it('validates durable workflow steps, retry bounds, and compensation', () => {
    const activity = { targetNodeId: 'payments-service', timeoutMs: 1_000, retry: { maxAttempts: 3, backoff: 'exponential', baseDelayMs: 50, maxDelayMs: 500, jitterRatio: 0.1 } } as const
    const workflow = {
      id: 'checkout', version: 1, name: 'Checkout', ownerNodeId: 'checkout-workflow',
      steps: [
        { id: 'reserve', ...activity, compensation: { ...activity, targetNodeId: 'inventory-service' } },
        { id: 'charge', ...activity },
      ],
    }
    expect(workflowDefinitionSchema.parse(workflow)).toEqual(workflow)
    expect(workflowDefinitionSchema.safeParse({ ...workflow, steps: [workflow.steps[0], workflow.steps[0]] }).success).toBe(false)
    expect(workflowDefinitionSchema.safeParse({ ...workflow, steps: [{ ...workflow.steps[0], retry: { ...activity.retry, maxDelayMs: 10 } }] }).success).toBe(false)
  })

  it('rejects unknown fields and duplicate versioned resources', () => {
    const document = { id: 'schema.Order', version: 1, name: 'Order', dialect: 'https://json-schema.org/draft/2020-12/schema', schema: { type: 'object' } }
    expect(businessDefinitionsSchema.safeParse({ schemaVersion: 1, jsonSchemas: [document, document], apis: [], dataModels: [], events: [], cacheKeys: [], workflows: [], interactions: [] }).success).toBe(false)
    expect(businessDefinitionsSchema.safeParse({ schemaVersion: 1, jsonSchemas: [], apis: [], dataModels: [], events: [], cacheKeys: [], workflows: [], interactions: [], arbitrary: true }).success).toBe(false)
  })
})
