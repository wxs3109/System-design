export interface WaterfallDatum {
  kind: 'span' | 'marker'
  value: [number, number, number, number, number]
  spanId?: string
  label: string
  queueDurationMs?: number
  serviceDurationMs?: number
  failed?: boolean
  markerKind?: 'fault' | 'policy'
}

interface WaterfallRenderApi {
  value: (dimension: number) => unknown
  coord: (value: [number, number]) => number[]
  size?: (value: [number, number]) => number[]
}

const asNumber = (value: unknown) => typeof value === 'number' ? value : Number(value ?? 0)

export function renderTraceWaterfallItem(
  datum: WaterfallDatum | undefined,
  api: WaterfallRenderApi,
  colors: { queue: string; service: string; failed: string; selected: string; marker: string },
  selectedSpanId?: string,
) {
  if (!datum) return undefined
  const dataIndex = asNumber(api.value(0))
  const start = asNumber(api.value(1))
  const startPoint = api.coord([start, dataIndex])
  const startX = startPoint[0] ?? 0
  const startY = startPoint[1] ?? 0
  const rowHeight = Math.max(11, Math.min(18, (api.size?.([0, 1])?.[1] ?? 22) * 0.58))
  if (datum.kind === 'marker') return {
    type: 'line' as const, shape: { x1: startX, y1: startY - rowHeight / 1.15, x2: startX, y2: startY + rowHeight / 1.15 },
    style: { stroke: datum.markerKind === 'fault' ? colors.failed : colors.marker, lineWidth: 2 },
  }
  const duration = asNumber(api.value(2))
  const queue = asNumber(api.value(3))
  const endPoint = api.coord([start + duration, dataIndex])
  const queueEndPoint = api.coord([start + queue, dataIndex])
  const endX = endPoint[0] ?? startX
  const queueEndX = queueEndPoint[0] ?? startX
  const selected = datum.spanId === selectedSpanId
  const children: Array<Record<string, unknown>> = []
  if (queue > 0) children.push({ type: 'rect', shape: { x: startX, y: startY - rowHeight / 2, width: Math.max(1, queueEndX - startX), height: rowHeight, r: 2 }, style: { fill: colors.queue } })
  children.push({ type: 'rect', shape: { x: queueEndX, y: startY - rowHeight / 2, width: Math.max(1, endX - queueEndX), height: rowHeight, r: 2 }, style: { fill: datum.failed ? colors.failed : colors.service, stroke: selected ? colors.selected : 'transparent', lineWidth: selected ? 2 : 0 } })
  return { type: 'group' as const, children }
}
