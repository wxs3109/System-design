'use client'

import { useEffect, useRef } from 'react'
import * as echarts from 'echarts/core'
import { CustomChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { TraceMarker, WaterfallLane } from './trace-explorer-model'
import { renderTraceWaterfallItem, type WaterfallDatum } from './trace-waterfall-renderer'

echarts.use([GridComponent, TooltipComponent, CustomChart, CanvasRenderer])

interface TraceWaterfallChartProps {
  lanes: WaterfallLane[]
  markers: TraceMarker[]
  durationMs: number
  selectedSpanId: string | undefined
  onSelectSpan: (spanId: string) => void
}

interface WaterfallRenderApi {
  value: (dimension: number) => unknown
  coord: (value: [number, number]) => number[]
  size?: (value: [number, number]) => number[]
}

const asNumber = (value: unknown) => typeof value === 'number' ? value : Number(value ?? 0)

export function TraceWaterfallChart({ lanes, markers, durationMs, selectedSpanId, onSelectSpan }: TraceWaterfallChartProps) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!hostRef.current) return
    const styles = getComputedStyle(document.documentElement)
    const color = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback
    const queueColor = '#7c3aed'
    const serviceColor = color('--cyan-deep', '#0891b2')
    const failedColor = color('--danger', '#fb7185')
    const selectedColor = color('--cyan', '#67e8f9')
    const markerColor = '#fbbf24'
    const borderColor = color('--border-bright', '#304056')
    const textColor = color('--muted-bright', '#a8b4c7')
    const data: WaterfallDatum[] = [
      ...lanes.map((lane, index): WaterfallDatum => ({
        kind: 'span', value: [index, lane.startOffsetMs, lane.span.durationMs, lane.queueDurationMs, lane.serviceDurationMs],
        spanId: lane.span.spanId, label: lane.label, queueDurationMs: lane.queueDurationMs, serviceDurationMs: lane.serviceDurationMs, failed: lane.span.status === 'error',
      })),
      ...markers.map((marker): WaterfallDatum => ({
        kind: 'marker', value: [marker.laneIndex, marker.offsetMs, 0, 0, 0], label: `${marker.event.type.replaceAll('-', ' ')} · ${marker.event.reason.replaceAll('_', ' ')}`, markerKind: marker.kind,
      })),
    ]
    const chart = echarts.init(hostRef.current, undefined, { renderer: 'canvas' })
    chart.setOption({
      animation: false,
      grid: { top: 9, right: 12, bottom: 24, left: 145 },
      tooltip: {
        trigger: 'item', backgroundColor: '#111827', borderColor, textStyle: { color: '#e5e7eb', fontSize: 10 },
        formatter: (params: { data?: WaterfallDatum }) => {
          const datum = params.data
          if (!datum) return ''
          if (datum.kind === 'marker') return `${datum.label}<br/>at ${asNumber(datum.value[1]).toFixed(2)} ms`
          return `${datum.label}<br/>total ${asNumber(datum.value[2]).toFixed(2)} ms<br/>queue ${asNumber(datum.queueDurationMs).toFixed(2)} ms · service ${asNumber(datum.serviceDurationMs).toFixed(2)} ms`
        },
      },
      xAxis: {
        type: 'value', min: 0, max: Math.max(0.001, durationMs),
        axisLabel: { color: textColor, fontSize: 9, formatter: (value: number) => `${Number(value.toFixed(1))} ms` },
        axisLine: { lineStyle: { color: borderColor } }, axisTick: { show: false }, splitLine: { lineStyle: { color: '#182333' } },
      },
      yAxis: {
        type: 'category', inverse: true, data: lanes.map((lane) => lane.label), axisTick: { show: false },
        axisLine: { lineStyle: { color: borderColor } }, axisLabel: { color: textColor, fontSize: 9, width: 132, overflow: 'truncate' },
      },
      series: [{
        type: 'custom',
        dimensions: ['lane', 'start', 'duration', 'queue', 'service'],
        encode: { x: [1, 2], y: 0 },
        data,
        renderItem: (params: { dataIndex: number }, api: WaterfallRenderApi) => renderTraceWaterfallItem(data[params.dataIndex], api, { queue: queueColor, service: serviceColor, failed: failedColor, selected: selectedColor, marker: markerColor }, selectedSpanId),
      }],
    })
    chart.on('click', (params) => {
      const datum = params.data as WaterfallDatum | undefined
      if (datum?.kind === 'span' && datum.spanId) onSelectSpan(datum.spanId)
    })
    const observer = new ResizeObserver(() => chart.resize())
    observer.observe(hostRef.current)
    return () => { observer.disconnect(); chart.dispose() }
  }, [durationMs, lanes, markers, onSelectSpan, selectedSpanId])

  return <div ref={hostRef} className="trace-waterfall-chart" role="img" aria-label={`Dependency waterfall with ${lanes.length} spans and ${markers.length} policy or fault markers`} />
}
