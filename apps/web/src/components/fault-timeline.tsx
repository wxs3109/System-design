'use client'

import { useEffect, useMemo, useRef } from 'react'
import type { Experiment, ProjectFileV2 } from '@system-design/model'
import { DataSet } from 'vis-data'
import { Timeline, type DataItem, type TimelineItem, type TimelineOptions } from 'vis-timeline'
import { faultTargetName, faultTypeLabels } from './fault-topology'

const virtualEpoch = Date.UTC(2000, 0, 1)
const secondsToDate = (seconds: number) => new Date(virtualEpoch + seconds * 1_000)
const dateToSeconds = (value: TimelineItem['start']) => Math.max(0, (new Date(value).getTime() - virtualEpoch) / 1_000)
const timelineValueMs = (value: { valueOf: () => unknown }) => Number(value.valueOf())

interface FaultTimelineProps {
  experiment: Experiment
  project: ProjectFileV2
  selectedFaultId: string | null
  onSelect: (faultId: string | null) => void
  onMove: (faultId: string, startAtSeconds: number, durationSeconds: number) => void
}

export function FaultTimeline({ experiment, project, selectedFaultId, onSelect, onMove }: FaultTimelineProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const timelineRef = useRef<Timeline | null>(null)
  const itemsRef = useRef(new DataSet<DataItem, 'id'>())
  const onMoveRef = useRef(onMove)

  useEffect(() => { onMoveRef.current = onMove }, [onMove])

  const items = useMemo<DataItem[]>(() => experiment.faults.map((fault) => ({
    id: fault.id,
    content: fault.name ?? faultTypeLabels[fault.type],
    title: `${faultTypeLabels[fault.type]} · ${faultTargetName(fault, project)} · ${fault.startAtSeconds}s–${fault.startAtSeconds + fault.durationSeconds}s`,
    start: secondsToDate(fault.startAtSeconds),
    end: secondsToDate(fault.startAtSeconds + fault.durationSeconds),
    type: 'range',
    editable: fault.enabled,
    className: `fault-range fault-${fault.type}${fault.enabled ? '' : ' is-disabled'}`,
  })), [experiment.faults, project])

  useEffect(() => {
    if (!containerRef.current) return
    const options: TimelineOptions = {
      width: '100%', height: 112, minHeight: 112, maxHeight: 112,
      min: secondsToDate(0), max: secondsToDate(experiment.simulation.durationSeconds),
      start: secondsToDate(0), end: secondsToDate(experiment.simulation.durationSeconds),
      editable: { updateTime: true, remove: false, add: false, updateGroup: false },
      itemsAlwaysDraggable: true, moveable: false, zoomable: false, stack: true,
      showCurrentTime: false, showMajorLabels: false, orientation: { axis: 'bottom', item: 'top' },
      margin: { axis: 4, item: { horizontal: 2, vertical: 5 } },
      format: { minorLabels: (date) => `${Math.max(0, (timelineValueMs(date) - virtualEpoch) / 1_000)}s` },
      snap: (date) => secondsToDate(Math.round((timelineValueMs(date) - virtualEpoch) / 1_000 * 10) / 10),
      onMove: (item, callback) => {
        const startAtSeconds = dateToSeconds(item.start)
        const endAtSeconds = item.end === undefined ? startAtSeconds + 0.1 : dateToSeconds(item.end)
        const durationSeconds = Math.max(0.1, endAtSeconds - startAtSeconds)
        if (startAtSeconds + durationSeconds > experiment.simulation.durationSeconds) { callback(null); return }
        onMoveRef.current(String(item.id), startAtSeconds, durationSeconds)
        callback(item)
      },
    }
    const timeline = new Timeline(containerRef.current, itemsRef.current, options)
    const select = (properties?: { items?: Array<string | number> }) => onSelect(properties?.items?.[0] === undefined ? null : String(properties.items[0]))
    timeline.on('select', select)
    timelineRef.current = timeline
    return () => { timeline.off('select', select); timeline.destroy(); timelineRef.current = null }
  // The timeline is recreated when the virtual-time domain changes.
  }, [experiment.simulation.durationSeconds, onSelect])

  useEffect(() => {
    itemsRef.current.clear()
    itemsRef.current.add(items)
  }, [items])

  useEffect(() => {
    timelineRef.current?.setSelection(selectedFaultId ? [selectedFaultId] : [])
  }, [selectedFaultId])

  return (
    <div className="fault-timeline">
      <div ref={containerRef} aria-hidden="true" />
      {experiment.faults.length === 0 ? <p className="fault-timeline__empty">No faults scheduled. Add one to break this design during virtual time.</p> : null}
    </div>
  )
}
