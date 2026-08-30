import { exporter, Parser } from '@dbml/core'
import { relationalDataModelSchema, type RelationalDataModel } from '@system-design/model'

const safeId = (value: string, fallback: string) => {
  const normalized = value.replace(/[^A-Za-z0-9._:-]+/g, '-').replace(/^[^A-Za-z]+/, '')
  return normalized || fallback
}
const quoteText = (value: string) => "'" + value.replaceAll('\\', '\\\\').replaceAll("'", "\\'") + "'"
const metadata = (values: Record<string, string | number>) => Object.entries(values).map(([key, value]) => key + '=' + String(value)).join(';')
const noteValue = (value: unknown) => typeof value === 'string' ? value : value && typeof value === 'object' && 'value' in value ? String((value as { value: unknown }).value) : ''
const metadataValue = (note: unknown, key: string) => new RegExp('(?:^|;)' + key + '=([^;]*)').exec(noteValue(note))?.[1]
const encodedReferenceName = (id: string, displayName: string) => 'sdref_' + [id, displayName].map((value) => [...new TextEncoder().encode(value)].map((byte) => byte.toString(16).padStart(2, '0')).join('')).join('_')
const decodedReferenceName = (value: string) => {
  if (!value.startsWith('sdref_')) return undefined
  try {
    const parts = value.slice('sdref_'.length).split('_')
    if (parts.length !== 2 || parts.some((part) => part.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(part))) return undefined
    const decode = (part: string) => new TextDecoder().decode(Uint8Array.from(part.match(/../g)?.map((hex) => Number.parseInt(hex, 16)) ?? []))
    return { id: decode(parts[0]!), name: decode(parts[1]!) }
  } catch {
    return undefined
  }
}
const dbmlType = (type: RelationalDataModel['tables'][number]['columns'][number]['type']) => {
  if (type.kind === 'string') return type.maxLength ? 'varchar(' + type.maxLength + ')' : 'text'
  if (type.kind === 'integer') return type.bits === 16 ? 'smallint' : type.bits === 32 ? 'integer' : 'bigint'
  if (type.kind === 'decimal') return 'decimal(' + type.precision + ',' + type.scale + ')'
  return { number: 'double', boolean: 'boolean', uuid: 'uuid', date: 'date', datetime: 'timestamp', json: 'json', binary: 'binary' }[type.kind]
}
const columnType = (raw: string): RelationalDataModel['tables'][number]['columns'][number]['type'] => {
  const type = raw.toLowerCase().replaceAll(' ', '')
  const varchar = /^(?:var)?char\((\d+)\)$/.exec(type)
  if (varchar) return { kind: 'string', maxLength: Number(varchar[1]) }
  if (['text', 'varchar', 'char', 'string'].includes(type)) return { kind: 'string' }
  if (['smallint', 'int2'].includes(type)) return { kind: 'integer', bits: 16 }
  if (['integer', 'int', 'int4'].includes(type)) return { kind: 'integer', bits: 32 }
  if (['bigint', 'int8'].includes(type)) return { kind: 'integer', bits: 64 }
  const decimal = /^(?:decimal|numeric)\((\d+),(\d+)\)$/.exec(type)
  if (decimal) return { kind: 'decimal', precision: Number(decimal[1]), scale: Number(decimal[2]) }
  if (['float', 'double', 'real'].includes(type)) return { kind: 'number' }
  if (['bool', 'boolean'].includes(type)) return { kind: 'boolean' }
  if (type === 'uuid') return { kind: 'uuid' }
  if (type === 'date') return { kind: 'date' }
  if (['datetime', 'timestamp', 'timestamptz'].includes(type)) return { kind: 'datetime' }
  if (['json', 'jsonb'].includes(type)) return { kind: 'json' }
  if (['binary', 'blob', 'bytea'].includes(type)) return { kind: 'binary' }
  throw new Error('Unsupported DBML column type: ' + raw)
}

/** Validates and exports the lossless relational subset with @dbml/core. */
export function exportDbml(input: RelationalDataModel): string {
  const model = relationalDataModelSchema.parse(input)
  const lines: string[] = []
  for (const table of model.tables) {
    lines.push('Table ' + table.name + ' [note: ' + quoteText(metadata({ sdTableId: table.id, estimatedRows: table.estimatedRows, estimatedRowBytes: table.estimatedRowBytes, primaryKeyId: table.primaryKey.id, primaryKeyName: table.primaryKey.name })) + '] {')
    for (const column of table.columns) {
      const settings = []
      if (table.primaryKey.columnIds.length === 1 && table.primaryKey.columnIds[0] === column.id) settings.push('pk')
      if (!column.nullable) settings.push('not null')
      settings.push('note: ' + quoteText(metadata({ sdColumnId: column.id })))
      lines.push('  ' + column.name + ' ' + dbmlType(column.type) + (settings.length ? ' [' + settings.join(', ') + ']' : ''))
    }
    const compoundPrimary = table.primaryKey.columnIds.length > 1
    const indexes = [...(compoundPrimary ? [{ ...table.primaryKey, unique: true }] : []), ...table.uniqueKeys.map((key) => ({ ...key, unique: true })), ...table.indexes]
    if (indexes.length) {
      lines.push('  indexes {')
      for (const index of indexes) {
        const names = index.columnIds.map((id) => table.columns.find((column) => column.id === id)!.name)
        const indexRole = index.id === table.primaryKey.id ? 'primary' : table.uniqueKeys.some((key) => key.id === index.id) ? 'unique-key' : 'index'
        const indexMetadata = metadata({ sdIndexId: index.id, sdIndexRole: indexRole, kind: 'kind' in index ? index.kind : 'btree', includedColumnIds: 'includedColumnIds' in index ? index.includedColumnIds.join('|') : '' })
        lines.push("    (" + names.join(', ') + ") [name: '" + index.name.replaceAll("'", "\\'") + "'" + (index.id === table.primaryKey.id ? ', pk' : index.unique ? ', unique' : '') + ', note: ' + quoteText(indexMetadata) + ']')
      }
      lines.push('  }')
    }
    lines.push('}', '')
  }
  for (const table of model.tables) for (const key of table.foreignKeys) {
    const target = model.tables.find((candidate) => candidate.id === key.referencedTableId)!
    const sources = key.columnIds.map((id) => table.columns.find((column) => column.id === id)!.name).join(', ')
    const targets = key.referencedColumnIds.map((id) => target.columns.find((column) => column.id === id)!.name).join(', ')
    lines.push('Ref ' + encodedReferenceName(key.id, key.name) + ': ' + table.name + '.(' + sources + ') > ' + target.name + '.(' + targets + ')')
  }
  const source = lines.join('\n')
  Parser.parse(source, 'dbml')
  return source
}

type RawEntry = Record<string, unknown>
const entries = (value: unknown): RawEntry[] => Array.isArray(value) ? value.filter((entry): entry is RawEntry => typeof entry === 'object' && entry !== null) : []
const name = (entry: RawEntry | undefined) => String(entry?.name ?? '')

/** Imports DBML through @dbml/core; capacity estimates remain explicit options. */
export function importDbml(source: string, options: { modelId: string; modelName?: string; ownerNodeId: string; estimatedRows?: number; estimatedRowBytes?: number }): RelationalDataModel {
  const database = Parser.parse(source, 'dbml')
  // Use the library's public model export, keeping @dbml/core internals out of
  // the simulator domain model. Calling exporter also exercises its supported
  // DBML conversion path before mapping.
  exporter.export(source, 'json')
  const raw = database.export() as unknown as RawEntry
  const rawSchemas = entries(raw.schemas)
  const rawTables = rawSchemas.flatMap((schema) => entries(schema.tables))
  if (!rawTables.length) throw new Error('DBML contains no tables.')
  const tables = rawTables.map((table, tableIndex) => {
    const tableId = safeId(metadataValue(table.note, 'sdTableId') ?? name(table), 'table-' + (tableIndex + 1))
    const fields = entries(table.fields)
    const columns = fields.map((field, columnIndex) => { const rawType = typeof field.type === 'object' && field.type !== null ? String((field.type as RawEntry).type_name ?? '') : String(field.type ?? ''); return { id: safeId(metadataValue(field.note, 'sdColumnId') ?? name(field), 'column-' + (columnIndex + 1)), name: name(field), type: columnType(rawType), nullable: !Boolean(field.not_null) } })
    const idByName = new Map(columns.map((column) => [column.name, column.id]))
    const indexes = entries(table.indexes)
    const indexColumns = (index: RawEntry) => entries(index.columns).map((column) => idByName.get(String(column.value ?? column.name)) ?? '').filter(Boolean)
    const primaryIndex = indexes.find((index) => Boolean(index.pk))
    const primaryField = fields.find((field) => Boolean(field.pk))
    const primaryIds = primaryIndex ? indexColumns(primaryIndex) : primaryField ? [idByName.get(name(primaryField))!] : []
    if (!primaryIds.length) throw new Error('Table ' + name(table) + ' needs a primary key for import.')
    const mapped = indexes.filter((index) => index !== primaryIndex).map((index, indexIndex) => ({ id: safeId(metadataValue(index.note, 'sdIndexId') ?? name(index), 'ix-' + tableId + '-' + (indexIndex + 1)), name: name(index) || 'index_' + (indexIndex + 1), columnIds: indexColumns(index), unique: Boolean(index.unique), role: metadataValue(index.note, 'sdIndexRole'), kind: metadataValue(index.note, 'kind') === 'hash' ? 'hash' as const : 'btree' as const, includedColumnIds: (metadataValue(index.note, 'includedColumnIds') ?? '').split('|').filter(Boolean) }))
    const uniqueKeys = mapped.filter((index) => index.unique && index.role !== 'index').map(({ unique: _unique, role: _role, kind: _kind, includedColumnIds: _included, ...index }) => index)
    const secondaryIndexes = mapped.filter((index) => !index.unique || index.role === 'index').map(({ role: _role, ...index }) => index)
    return { id: tableId, name: name(table), columns, primaryKey: { id: safeId(metadataValue(primaryIndex?.note, 'sdIndexId') ?? metadataValue(table.note, 'primaryKeyId') ?? 'pk-' + tableId, 'pk-' + tableId), name: name(primaryIndex) || metadataValue(table.note, 'primaryKeyName') || name(table) + '_pk', columnIds: primaryIds }, uniqueKeys, foreignKeys: [] as RelationalDataModel['tables'][number]['foreignKeys'], indexes: secondaryIndexes, estimatedRows: Number(metadataValue(table.note, 'estimatedRows') ?? options.estimatedRows ?? 1_000), estimatedRowBytes: Number(metadataValue(table.note, 'estimatedRowBytes') ?? options.estimatedRowBytes ?? 256) }
  })
  const tableByName = new Map(tables.map((table) => [table.name, table]))
  const refs = rawSchemas.flatMap((schema) => entries(schema.refs))
  refs.forEach((ref, refIndex) => {
    const endpoints = entries(ref.endpoints)
    if (endpoints.length !== 2) throw new Error('Only binary DBML references are supported.')
    const sourceEndpoint = endpoints[0]!
    const targetEndpoint = endpoints[1]!
    const sourceTable = tableByName.get(String(sourceEndpoint.tableName ?? ''))
    const targetTable = tableByName.get(String(targetEndpoint.tableName ?? ''))
    if (!sourceTable || !targetTable) throw new Error('DBML reference targets an unknown table.')
    const fieldNames = (endpoint: RawEntry) => Array.isArray(endpoint.fieldNames) ? endpoint.fieldNames.map(String) : []
    const ids = (table: typeof sourceTable, names: string[]) => names.map((fieldName) => table.columns.find((column) => column.name === fieldName)?.id ?? fieldName)
    const encoded = decodedReferenceName(name(ref))
    sourceTable.foreignKeys.push({ id: safeId(encoded?.id ?? name(ref), 'fk-' + (refIndex + 1)), name: encoded?.name || name(ref) || 'foreign_key_' + (refIndex + 1), columnIds: ids(sourceTable, fieldNames(sourceEndpoint)), referencedTableId: targetTable.id, referencedColumnIds: ids(targetTable, fieldNames(targetEndpoint)) })
  })
  return relationalDataModelSchema.parse({ id: safeId(options.modelId, 'model'), version: 1, name: options.modelName ?? options.modelId, ownerNodeId: options.ownerNodeId, kind: 'relational', tables })
}
