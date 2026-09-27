interface ReplicaSnapshot { id: string; online: boolean; objects: { key: string; data: string }[] }
export const replicaCopies = (nodes: readonly ReplicaSnapshot[], key: string) => nodes.filter((node) => node.online && node.objects.some((object) => object.key === key)).length
export const replicaRows = (nodes: readonly ReplicaSnapshot[]): (string | number)[][] => nodes.map((node) => [node.id, node.online ? '在线' : '数据丢失 / 离线', node.objects.length, node.objects.map((object) => object.key).join(', ') || '空'])
