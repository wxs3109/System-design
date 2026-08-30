'use client'

import { useEffect, useRef } from 'react'
import * as echarts from 'echarts/core'
import { GridComponent, MarkAreaComponent, TooltipComponent } from 'echarts/components'
import { LineChart } from 'echarts/charts'
import { CanvasRenderer } from 'echarts/renderers'
import type { RuntimeEvent, TimeSeriesPoint } from '@system-design/model'
import { runtimeFaultWindows } from './fault-windows'

echarts.use([GridComponent, MarkAreaComponent, TooltipComponent, LineChart, CanvasRenderer])

export function MetricChart({ points, events, simulatedDurationMs }: { points: TimeSeriesPoint[]; events: RuntimeEvent[]; simulatedDurationMs: number }) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!hostRef.current) return
    const faultWindows = runtimeFaultWindows(events, simulatedDurationMs)
    const chart = echarts.init(hostRef.current, undefined, { renderer: 'canvas' })
    chart.setOption({
      animation: false,
      backgroundColor: 'transparent',
      grid: { top: 12, right: 8, bottom: 24, left: 38 },
      tooltip: { trigger: 'axis', backgroundColor: '#111827', borderColor: '#334155', textStyle: { color: '#e5e7eb' } },
      xAxis: {
        type: 'value', min: 0, max: simulatedDurationMs / 1_000,
        axisLabel: { color: '#78859a', fontSize: 10 }, axisLine: { lineStyle: { color: '#273244' } }, axisTick: { show: false },
      },
      yAxis: {
        type: 'value', axisLabel: { color: '#78859a', fontSize: 10 }, splitLine: { lineStyle: { color: '#1b2535' } },
      },
      series: [{
        name: 'Throughput', type: 'line', smooth: true, showSymbol: false, data: points.map((point) => [point.timeSeconds, point.throughputPerSecond]),
        lineStyle: { width: 2, color: '#67e8f9' }, areaStyle: { color: 'rgba(103, 232, 249, .08)' },
        markArea: {
          silent: true, label: { show: false }, itemStyle: { color: 'rgba(251, 113, 133, .12)' },
          data: faultWindows.map((window) => [{ name: `${window.reason} · ${window.target}`, xAxis: window.startSeconds }, { xAxis: window.endSeconds }]),
        },
      }],
    })
    const observer = new ResizeObserver(() => chart.resize())
    observer.observe(hostRef.current)
    return () => { observer.disconnect(); chart.dispose() }
  }, [events, points, simulatedDurationMs])

  const faultCount = runtimeFaultWindows(events, simulatedDurationMs).length
  return <div ref={hostRef} className="metric-chart" role="img" aria-label={`Throughput over simulated time with ${faultCount} fault window${faultCount === 1 ? '' : 's'}`} />
}
