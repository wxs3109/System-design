export const methods = ['modulo', 'ring', 'vnodes'] as const
export type Method = typeof methods[number]
export const methodLabels: Record<Method, string> = { modulo: '取模', ring: '单 token 环', vnodes: '虚拟节点环' }
export interface DistributionInput {
  modelVersion: 'distribution-v1'
  generatorVersion: 'keys-v1'
  datasetSeed: string
  keys: string[]
  nodes: string[]
  method: Method
  virtualNodes: number
}
export interface Token { hash: number; nodeId: string; index: number }
export interface Assignment { key: string; hash: number; owner: string; token: Token | null }
export interface DistributionResult {
  input: DistributionInput
  tokens: Token[]
  assignments: Assignment[]
  counts: { nodeId: string; count: number }[]
  min: number
  mean: number
  maxShare: number
  maxToMean: number
}
export interface Comparison {
  kind: 'membership' | 'algorithm' | 'virtualNodes' | 'combined' | 'unchanged'
  remapped: number
  fraction: number
  transfers: { from: string; to: string; count: number }[]
}
export const asciiCompare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
import { same } from '../../../core/experiments/equality'
export { same } from '../../../core/experiments/equality'
const rotate = (n: number, bits: number) => (n << bits) | (n >>> (32 - bits))

/** MurmurHash3 x86_32, seed 0, UTF-8 and little-endian blocks.
 * Adapted from Austin Appleby's public-domain SMHasher MurmurHash3.cpp.
 * https://github.com/aappleby/smhasher/blob/07bb4de10a63e8cc2e1724865454eba635742383/src/MurmurHash3.cpp
 * Source and independent vectors are recorded in model.test.ts and the roadmap.
 */
export function hashV1(text: string): number {
  const bytes = new TextEncoder().encode(text)
  const view = new DataView(bytes.buffer)
  let hash = 0
  const mix = (word: number) => Math.imul(rotate(Math.imul(word, 0xcc9e2d51), 15), 0x1b873593)
  const end = bytes.length - bytes.length % 4
  for (let offset = 0; offset < end; offset += 4) {
    hash = (Math.imul(rotate(hash ^ mix(view.getUint32(offset, true)), 13), 5) + 0xe6546b64) | 0
  }
  let tail = 0
  for (let offset = end; offset < bytes.length; offset++) tail |= bytes[offset]! << (8 * (offset - end))
  if (end !== bytes.length) hash ^= mix(tail)
  hash ^= bytes.length
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b)
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35)
  return (hash ^ (hash >>> 16)) >>> 0
}

export function makeInput(seed = 'hash-lab', count = 1024): DistributionInput {
  return parseInput({ modelVersion: 'distribution-v1', generatorVersion: 'keys-v1', datasetSeed: seed,
    keys: Array.from({ length: count }, (_, index) => `${seed}:${String(index).padStart(4, '0')}`),
    nodes: ['node-a', 'node-b', 'node-c', 'node-d'], method: 'modulo', virtualNodes: 1 })
}

/** Validate persisted data before any model execution. Canonical order is locale independent. */
export function parseInput(value: unknown): DistributionInput {
  if (!value || typeof value !== 'object') throw new Error('实验输入缺失。')
  const input = value as DistributionInput
  const strings = (items: unknown): items is string[] => Array.isArray(items) && items.every((item) => typeof item === 'string' && item.length > 0 && item.length <= 200) && new Set(items).size === items.length
  if (input.modelVersion !== 'distribution-v1' || input.generatorVersion !== 'keys-v1') throw new Error('未知模型或数据集版本，无法验证。')
  if (typeof input.datasetSeed !== 'string' || input.datasetSeed.length < 1 || input.datasetSeed.length > 80) throw new Error('Seed 需要 1–80 个字符。')
  if (!strings(input.nodes) || input.nodes.length < 1 || input.nodes.length > 12 || input.nodes.some((id) => !/^[\x20-\x7e]+$/.test(id))) throw new Error('需要 1–12 个不重复的 ASCII 节点 ID。')
  if (!strings(input.keys) || ![256, 1024, 4096].includes(input.keys.length)) throw new Error('需要 256、1024 或 4096 个唯一 key。')
  if (!methods.includes(input.method) || ![1, 8, 32, 128].includes(input.virtualNodes)) throw new Error('分配方法或 token 数无效。')
  return { modelVersion: input.modelVersion, generatorVersion: input.generatorVersion, datasetSeed: input.datasetSeed,
    keys: [...input.keys].sort(asciiCompare), nodes: [...input.nodes].sort(asciiCompare), method: input.method,
    virtualNodes: input.method === 'vnodes' ? input.virtualNodes : 1 }
}
export const fingerprint = (input: DistributionInput) => JSON.stringify(parseInput(input))
export const tokenCompare = (a: Token, b: Token) => a.hash - b.hash || asciiCompare(a.nodeId, b.nodeId) || a.index - b.index

/** First token >= hash; ties keep every token and use the total order above. */
export function successor(tokens: readonly Token[], hash: number): Token {
  if (!tokens.length) throw new Error('哈希环不能为空。')
  let low = 0
  let high = tokens.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (tokens[middle]!.hash < hash) low = middle + 1
    else high = middle
  }
  return tokens[low % tokens.length]!
}

// Hash injection is a test seam for collisions; production callers use hashV1.
export function distribute(value: DistributionInput, hash = hashV1): DistributionResult {
  const input = parseInput(value)
  const tokens = input.method === 'modulo' ? [] : input.nodes.flatMap((nodeId) => Array.from({ length: input.virtualNodes }, (_, index) => ({ nodeId, index, hash: hash(JSON.stringify(['token', nodeId, index])) }))).sort(tokenCompare)
  const counts = input.nodes.map((nodeId) => ({ nodeId, count: 0 }))
  const countByNode = new Map(counts.map((item) => [item.nodeId, item]))
  const assignments = input.keys.map((key) => {
    const position = hash(JSON.stringify(['key', key]))
    const token = input.method === 'modulo' ? null : successor(tokens, position)
    const owner = token?.nodeId ?? input.nodes[position % input.nodes.length]!
    countByNode.get(owner)!.count++
    return { key, hash: position, owner, token }
  })
  const maximum = Math.max(...counts.map((item) => item.count))
  const mean = input.keys.length / input.nodes.length
  return { input, tokens, assignments, counts, min: Math.min(...counts.map((item) => item.count)), mean, maxShare: maximum / input.keys.length, maxToMean: maximum / mean }
}

/** Different corpora/versions have no meaningful owner-remapping denominator. */
export function compare(before: DistributionResult, after: DistributionResult): Comparison | null {
  const a = before.input
  const b = after.input
  if (a.modelVersion !== b.modelVersion || a.generatorVersion !== b.generatorVersion || a.datasetSeed !== b.datasetSeed || !same(a.keys, b.keys)) return null
  const changes = [!same(a.nodes, b.nodes), a.method !== b.method, a.method === b.method && a.virtualNodes !== b.virtualNodes]
  const count = changes.filter(Boolean).length
  const kind = count > 1 ? 'combined' : changes[0] ? 'membership' : changes[1] ? 'algorithm' : changes[2] ? 'virtualNodes' : 'unchanged'
  const transfers = new Map<string, { from: string; to: string; count: number }>()
  let remapped = 0
  const owners = new Map(before.assignments.map((item) => [item.key, item.owner]))
  for (const item of after.assignments) {
    const from = owners.get(item.key)!
    if (from !== item.owner) remapped++
    const key = JSON.stringify([from, item.owner])
    const transfer = transfers.get(key) ?? { from, to: item.owner, count: 0 }
    transfer.count++
    transfers.set(key, transfer)
  }
  return { kind, remapped, fraction: remapped / b.keys.length, transfers: [...transfers.values()].sort((x, y) => asciiCompare(x.from, y.from) || asciiCompare(x.to, y.to)) }
}
