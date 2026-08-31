'use client'

import { useEffect, useRef } from 'react'
import * as echarts from 'echarts/core'
import { GridComponent, MarkAreaComponent, TooltipComponent } from 'echarts/components'
import { LineChart } from 'echarts/charts'
import { CanvasRenderer } from 'echarts/renderers'
import type { RuntimeEvent, TimeSeriesPoint } from '@system-design/model'
import { runtimeFaultWindows } from './fault-windows'
import { useI18n } from '@/lib/i18n'

echarts.use([GridComponent, MarkAreaComponent, TooltipComponent, LineChart, CanvasRenderer])

const transparent = (value: string, opacity: number) => {
  const hex = value.trim()
  if (/^#[0-9a-f]{6}$/i.test(hex)) {
    const red = Number.parseInt(hex.slice(1, 3), 16)
    const green = Number.parseInt(hex.slice(3, 5), 16)
    const blue = Number.parseInt(hex.slice(5, 7), 16)
    return `rgba(${red}, ${green}, ${blue}, ${opacity})`
  }
  return value
}

export function MetricChart({ points, events, simulatedDurationMs, theme }: { points: TimeSeriesPoint[]; events: RuntimeEvent[]; simulatedDurationMs: number; theme?: string | undefined }) {
  const { t } = useI18n()
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!hostRef.current) return
    const styles = getComputedStyle(document.documentElement)
    const color = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback
    const textColor = color('--muted', '#78859a')
    const borderColor = color('--border-bright', '#334155')
    const splitColor = color('--border', '#1b2535')
    const tooltipBackground = color('--panel-raised', '#111827')
    const tooltipText = color('--text', '#e5e7eb')
    const seriesColor = color('--cyan', '#67e8f9')
    const dangerColor = color('--danger', '#fb7185')
    const faultWindows = runtimeFaultWindows(events, simulatedDurationMs)
    const chart = echarts.init(hostRef.current, undefined, { renderer: 'canvas' })
    chart.setOption({
      animation: false,
      backgroundColor: 'transparent',
      grid: { top: 12, right: 8, bottom: 24, left: 38 },
      tooltip: { trigger: 'axis', backgroundColor: tooltipBackground, borderColor, textStyle: { color: tooltipText } },
      xAxis: {
        type: 'value', min: 0, max: simulatedDurationMs / 1_000,
        axisLabel: { color: textColor, fontSize: 10 }, axisLine: { lineStyle: { color: borderColor } }, axisTick: { show: false },
      },
      yAxis: {
        type: 'value', axisLabel: { color: textColor, fontSize: 10 }, splitLine: { lineStyle: { color: splitColor } },
      },
      series: [{
        name: t('Throughput'), type: 'line', smooth: true, showSymbol: false, data: points.map((point) => [point.timeSeconds, point.throughputPerSecond]),
        lineStyle: { width: 2, color: seriesColor }, areaStyle: { color: transparent(seriesColor, 0.08) },
        markArea: {
          silent: true, label: { show: false }, itemStyle: { color: transparent(dangerColor, 0.12) },
          data: faultWindows.map((window) => [{ name: `${window.reason} · ${window.target}`, xAxis: window.startSeconds }, { xAxis: window.endSeconds }]),
        },
      }],
    })
    const observer = new ResizeObserver(() => chart.resize())
    observer.observe(hostRef.current)
    return () => { observer.disconnect(); chart.dispose() }
  }, [events, points, simulatedDurationMs, t, theme])

  const faultCount = runtimeFaultWindows(events, simulatedDurationMs).length
  return <div ref={hostRef} className="metric-chart" role="img" aria-label={t('Throughput over simulated time with {count} fault windows', { count: faultCount })} />
}
