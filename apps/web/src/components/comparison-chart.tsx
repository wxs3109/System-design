'use client'

import { useEffect, useRef } from 'react'
import * as echarts from 'echarts/core'
import { GridComponent, LegendComponent, MarkAreaComponent, TooltipComponent } from 'echarts/components'
import { LineChart } from 'echarts/charts'
import { CanvasRenderer } from 'echarts/renderers'
import type { RuntimeEvent } from '@system-design/model'
import { runtimeFaultWindows } from './fault-windows'

echarts.use([GridComponent, LegendComponent, MarkAreaComponent, TooltipComponent, LineChart, CanvasRenderer])

export interface ComparisonChartPoint {
  timeSeconds: number
  baseline: number
  candidate: number
  delta: number
}

interface ComparisonChartProps {
  points: ComparisonChartPoint[]
  metricLabel?: string
  unit?: string
  events?: RuntimeEvent[]
  simulatedDurationMs?: number
  theme?: string | undefined
}

export function ComparisonChart({ points, metricLabel = 'Throughput', unit = 'req/s', events = [], simulatedDurationMs = 0, theme }: ComparisonChartProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!hostRef.current) return
    const styles = getComputedStyle(document.documentElement)
    const color = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback
    const textColor = color('--muted-bright', '#a8b4c7')
    const axisColor = color('--border-bright', '#334155')
    const splitColor = color('--border', '#1b2535')
    const tooltipBackground = color('--panel-raised', '#111827')
    const tooltipText = color('--text', '#e5e7eb')
    const baselineColor = color('--cyan', '#67e8f9')
    const dangerColor = color('--danger', '#fb7185')
    const faultWindows = runtimeFaultWindows(events, simulatedDurationMs)
    const chart = echarts.init(hostRef.current, undefined, { renderer: 'canvas' })
    chart.setOption({
      animation: false, backgroundColor: 'transparent',
      grid: { top: 30, right: 10, bottom: 28, left: 42 },
      legend: { top: 0, textStyle: { color: textColor, fontSize: 9 }, data: ['Baseline', 'Candidate', 'Delta'] },
      tooltip: { trigger: 'axis', backgroundColor: tooltipBackground, borderColor: axisColor, textStyle: { color: tooltipText } },
      xAxis: { type: 'value', name: 's', axisLabel: { color: textColor, fontSize: 9 }, axisLine: { lineStyle: { color: axisColor } }, splitLine: { show: false } },
      yAxis: { type: 'value', name: unit, axisLabel: { color: textColor, fontSize: 9 }, splitLine: { lineStyle: { color: splitColor } } },
      series: [
        {
          name: 'Baseline', type: 'line', showSymbol: false, data: points.map((point) => [point.timeSeconds, point.baseline]), lineStyle: { color: baselineColor, width: 2 },
          markArea: {
            silent: true, label: { show: false }, itemStyle: { color: dangerColor, opacity: 0.1 },
            data: faultWindows.map((window) => [{ name: `${window.reason} · ${window.target}`, xAxis: window.startSeconds }, { xAxis: window.endSeconds }]),
          },
        },
        { name: 'Candidate', type: 'line', showSymbol: false, data: points.map((point) => [point.timeSeconds, point.candidate]), lineStyle: { color: '#a78bfa', width: 2 } },
        { name: 'Delta', type: 'line', showSymbol: false, data: points.map((point) => [point.timeSeconds, point.delta]), lineStyle: { color: '#fbbf24', width: 1, type: 'dashed' } },
      ],
    })
    const observer = new ResizeObserver(() => chart.resize())
    observer.observe(hostRef.current)
    return () => { observer.disconnect(); chart.dispose() }
  }, [events, points, simulatedDurationMs, theme, unit])
  return <div ref={hostRef} className="comparison-chart" style={{ width: '100%', height: 230 }} role="img" aria-label={`Aligned baseline, candidate and ${metricLabel} delta over virtual time with ${runtimeFaultWindows(events, simulatedDurationMs).length} fault windows`} />
}
