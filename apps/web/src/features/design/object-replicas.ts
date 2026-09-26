/** Bounded durable stores. Losing a node erases its bytes; metadata cannot recreate them. */
export class ObjectReplicas {
  private stores = new Map(['A', 'B', 'C'].map((node) => [node, new Map<string, string>()]))
  private online = new Set(['A', 'B', 'C'])
  write(key: string, data: string, copies: number): boolean {
    const targets = [...this.online].slice(0, copies)
    if (targets.length < copies) return false
    for (const node of targets) this.stores.get(node)!.set(key, data)
    return true
  }
  read(key: string): string | undefined {
    for (const node of this.online) { const value = this.stores.get(node)!.get(key); if (value !== undefined) return value }
    return undefined
  }
  lose(node: string) { this.stores.get(node)?.clear(); this.online.delete(node) }
  recover(node: string) { if (this.stores.has(node)) this.online.add(node) }
  copies(key: string) { return [...this.online].filter((node) => this.stores.get(node)!.has(key)).length }
  repair(key: string, copies: number): boolean { const bytes = this.read(key); return bytes !== undefined && this.write(key, bytes, copies) }
  rows(): (string | number)[][] { return [...this.stores].map(([node, values]) => [node, this.online.has(node) ? '在线' : '数据丢失 / 离线', values.size, [...values.keys()].join(', ') || '空']) }
}
export function teachingChecksum(text: string): string {
  let hash = 2166136261
  for (const char of text) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0
  return hash.toString(16)
}
