import { describe, expect, it } from 'vitest'
import { createOrderSystemContractFixture } from '@system-design/model'
import { exportDbml, importDbml } from './dbml'

describe('DBML adapter', () => {
  it('uses @dbml/core to export and import supported relational structure', () => {
    const original = createOrderSystemContractFixture().definitions.dataModels.find((model) => model.kind === 'relational')!
    const source = exportDbml(original)
    const imported = importDbml(source, { modelId: original.id, modelName: original.name, ownerNodeId: original.ownerNodeId, estimatedRows: original.tables[0]!.estimatedRows, estimatedRowBytes: original.tables[0]!.estimatedRowBytes })
    expect(imported.tables[0]).toMatchObject({
      name: 'orders', estimatedRows: 10_000_000, estimatedRowBytes: 512, primaryKey: expect.objectContaining({ columnIds: ['id'] }),
    })
    expect(imported.tables[0]!.columns.map(({ name, type, nullable }) => ({ name, type, nullable }))).toEqual(original.tables[0]!.columns.map(({ name, type, nullable }) => ({ name, type, nullable })))
    expect(imported.tables[0]!.indexes).toEqual([expect.objectContaining({ id: 'ix-customer', name: 'orders_customer', columnIds: ['customer-id', 'created-at'], includedColumnIds: ['id', 'status', 'total'], unique: false })])
  })

  it('rejects unsupported types and tables without primary keys', () => {
    expect(() => importDbml('Table logs { id int [pk]\n body geography }', { modelId: 'logs', ownerNodeId: 'database' })).toThrow()
  })

  it('maps official DBML references to foreign keys', () => {
    const source = 'Table customers {\n id uuid [pk]\n}\nTable orders {\n id uuid [pk]\n customer_id uuid [not null]\n}\nRef order_customer: orders.customer_id > customers.id'
    const model = importDbml(source, { modelId: 'commerce', ownerNodeId: 'database' })
    expect(model.tables.find((table) => table.id === 'orders')?.foreignKeys).toEqual([expect.objectContaining({ name: 'order_customer', columnIds: ['customer_id'], referencedTableId: 'customers', referencedColumnIds: ['id'] })])
  })

  it('round-trips stable IDs, foreign keys, unique keys, and unique secondary indexes', () => {
    const original = createOrderSystemContractFixture().definitions.dataModels.find((model) => model.kind === 'relational')!
    const orders = original.tables[0]!
    orders.uniqueKeys.push({ id: 'uk-order-status', name: 'order_status_key', columnIds: ['status'] })
    orders.indexes[0]!.unique = true
    original.tables.push({
      id: 'customers-table', name: 'customers', columns: [{ id: 'customer-pk', name: 'id', type: { kind: 'uuid' }, nullable: false }],
      primaryKey: { id: 'pk-customers', name: 'customers_pk', columnIds: ['customer-pk'] }, uniqueKeys: [], foreignKeys: [], indexes: [], estimatedRows: 1_000, estimatedRowBytes: 128,
    })
    orders.foreignKeys.push({ id: 'fk-orders-customer', name: 'orders_customer_fk', columnIds: ['customer-id'], referencedTableId: 'customers-table', referencedColumnIds: ['customer-pk'] })

    const imported = importDbml(exportDbml(original), { modelId: original.id, modelName: original.name, ownerNodeId: original.ownerNodeId })
    expect(imported).toEqual(original)
  })
})
