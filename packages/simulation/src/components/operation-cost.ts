import type { KeyDistribution, ValueSizeDistribution } from '@system-design/model'
import type { CompiledDataAccess, CompiledOperationAction } from '../compiler/operation-plan'

export interface OperationCost { serviceTimeMs: number; recordsExamined: number; bytesProcessed: number; explanation: string }

const boundedRows = (value: number, cardinality: number) => Math.max(1, Math.min(cardinality, value))
const treeDepth = (cardinality: number) => Math.max(1, Math.ceil(Math.log2(Math.max(2, cardinality))))

/** Explainable system-design approximation, intentionally not a query optimizer. */
export const estimateDataAccessCost = (access: CompiledDataAccess, baseQueryTimeMs: number): OperationCost => {
  const rows = boundedRows(access.estimatedRows, access.cardinality)
  let recordsExamined: number
  let multiplier: number
  let explanation: string
  switch (access.operation) {
    case 'point-read':
      recordsExamined = 1; multiplier = 0.65; explanation = 'Point lookup touches one record.'; break
    case 'index-read': {
      const depth = access.indexKind === 'hash' ? 1 : treeDepth(access.cardinality)
      recordsExamined = Math.min(access.cardinality, depth + rows)
      multiplier = 0.75 + depth * 0.035 + rows * 0.004
      explanation = `${access.indexKind === 'hash' ? 'Hash' : 'B-tree'} index lookup examines ${recordsExamined} record/index entries.`
      break
    }
    case 'range-read': {
      const depth = treeDepth(access.cardinality)
      recordsExamined = Math.min(access.cardinality, depth + rows)
      multiplier = 0.9 + depth * 0.04 + rows * 0.006
      explanation = `Range lookup walks an index and returns about ${rows} records.`
      break
    }
    case 'scan':
      recordsExamined = access.cardinality; multiplier = 1 + Math.log10(access.cardinality + 1) * 0.35 + access.cardinality / 25_000; explanation = `Scan examines all ${access.cardinality} records.`; break
    case 'insert':
      recordsExamined = 1; multiplier = 1.25; explanation = 'Insert writes one record and its declared indexes.'; break
    case 'update':
      recordsExamined = rows; multiplier = 1.15 + rows * 0.01; explanation = `Update reads and writes about ${rows} records.`; break
    case 'delete':
      recordsExamined = rows; multiplier = 1.05 + rows * 0.009; explanation = `Delete removes about ${rows} records and index entries.`; break
  }
  const bytesProcessed = Math.max(access.recordBytes, Math.round(recordsExamined * access.recordBytes))
  const bytePenaltyMs = bytesProcessed / 262_144
  return { serviceTimeMs: Math.max(0.001, baseQueryTimeMs * multiplier + bytePenaltyMs), recordsExamined, bytesProcessed, explanation }
}

export const sampleKey = (distribution: KeyDistribution | undefined, random: () => number, requestId: number) => {
  if (!distribution) return `operation-key:${requestId}`
  if (distribution.kind === 'uniform') return `key:${Math.floor(random() * distribution.keySpaceSize)}`
  if (distribution.kind === 'hotspot') {
    const hot = random() < distribution.hotTrafficFraction
    const range = hot ? distribution.hotKeyCount : Math.max(1, distribution.keySpaceSize - distribution.hotKeyCount)
    const offset = hot ? 0 : distribution.hotKeyCount
    return `key:${offset + Math.floor(random() * range)}`
  }
  const rank = Math.max(1, Math.min(distribution.keySpaceSize, Math.floor(Math.pow(Math.max(Number.EPSILON, random()), -1 / distribution.exponent))))
  return `key:${rank - 1}`
}

export const sampleValueBytes = (distribution: ValueSizeDistribution | undefined, fallback: number, random: () => number) => {
  if (!distribution) return fallback
  if (distribution.kind === 'fixed') return distribution.bytes
  return Math.round(distribution.minBytes + random() * (distribution.maxBytes - distribution.minBytes))
}

export const actionAttributes = (action: CompiledOperationAction) => ({
  actionId: action.id, actionKind: action.kind,
  ...(action.operationId === undefined ? {} : { operationId: action.operationId }),
  ...(action.requestBytes === undefined ? {} : { requestBytes: action.requestBytes }),
  ...(action.responseBytes === undefined ? {} : { responseBytes: action.responseBytes }),
  ...(action.data === undefined ? {} : { dataOperation: action.data.operation, dataObjectId: action.data.objectId, modelId: action.data.modelId }),
  ...(action.cache === undefined ? {} : { cacheOperation: action.cache.operation, cacheKeyId: action.cache.keyId }),
  ...(action.event === undefined ? {} : { eventOperation: action.event.operation, eventId: action.event.eventId }),
  ...(action.realtime === undefined ? {} : { realtimeOperation: action.realtime.operation, realtimeConnectionPattern: action.realtime.connectionPattern, realtimeChannelPattern: action.realtime.channelPattern, ...(action.realtime.messageBytes === undefined ? {} : { realtimeMessageBytes: action.realtime.messageBytes }) }),
})
