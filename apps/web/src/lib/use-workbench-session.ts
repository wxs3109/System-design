'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { SimulationProgress } from '@system-design/model'
import type { ProjectRevisionRecord, SimulationRunRecord } from './local-history'
import type { CompletedWorkbenchRun, WorkbenchSession } from './workbench-session'
import { useWorkbenchStore } from './workbench-store-provider'

export function useWorkbenchSession(session: WorkbenchSession, onCompleted?: (run: CompletedWorkbenchRun) => void) {
  const project = useWorkbenchStore((state) => state.project)
  const setError = useWorkbenchStore((state) => state.setError)
  const [ready, setReady] = useState(false)
  const [progress, setProgress] = useState<SimulationProgress | null>(null)
  const [revisions, setRevisions] = useState<ProjectRevisionRecord[]>([])
  const [runs, setRuns] = useState<SimulationRunRecord[]>([])
  const mounted = useRef(false)
  const lifecycle = useRef(0)
  const readyRef = useRef(false)
  const completionRef = useRef(onCompleted)
  useEffect(() => { completionRef.current = onCompleted }, [onCompleted])

  const refreshHistory = useCallback(async (projectId: string) => {
    const currentLifecycle = lifecycle.current
    const history = session.history
    if (!history) return
    const [savedRevisions, savedRuns] = await Promise.all([history.listProjectRevisions(projectId), history.listSimulationRuns(projectId)])
    if (mounted.current && currentLifecycle === lifecycle.current && session.store.getState().project.id === projectId) {
      setRevisions(savedRevisions)
      setRuns(savedRuns)
    }
  }, [session])

  useEffect(() => {
    let active = true
    mounted.current = true
    lifecycle.current += 1
    readyRef.current = false
    const initial = session.store.getState().project
    void (async () => {
      try {
        const history = session.history
        const saved = session.restoreOnMount ? await history?.loadActiveProject() : undefined
        if (!active) return
        if (saved && session.store.getState().project === initial) session.store.getState().restoreProject(saved.project)
        await refreshHistory(session.store.getState().project.id)
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Could not restore local project.')
      } finally {
        if (active) { readyRef.current = true; setReady(true) }
      }
    })()
    return () => {
      active = false
      mounted.current = false
      lifecycle.current += 1
      if (readyRef.current) {
        // Flush the last edit on navigation, even inside the autosave debounce.
        void session.history?.saveProjectRevision(session.store.getState().project).catch(() => { /* The closed view cannot report a save error. */ })
      }
      readyRef.current = false
      session.dispose()
    }
  }, [session, refreshHistory, setError])

  useEffect(() => {
    if (!ready || !session.history) return
    const timer = window.setTimeout(() => {
      void session.history?.saveProjectRevision(project).then(() => refreshHistory(project.id))
        .catch((cause) => { if (mounted.current) setError(cause instanceof Error ? `Could not save local revision: ${cause.message}` : 'Could not save local revision.') })
    }, 350)
    return () => window.clearTimeout(timer)
  }, [ready, project, session, refreshHistory, setError])

  const run = useCallback(async () => {
    const currentLifecycle = lifecycle.current
    setProgress(null)
    const completed = await session.run((next) => { if (mounted.current) setProgress(next) })
    if (!completed || !mounted.current || currentLifecycle !== lifecycle.current) return
    if (completed.persistenceError) setError(`Simulation completed, but saving failed: ${completed.persistenceError}`)
    completionRef.current?.(completed)
    try { await refreshHistory(completed.project.id) }
    catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : 'Could not refresh run history.') }
  }, [session, refreshHistory, setError])

  return { ready, progress, revisions, runs, refreshHistory, run }
}
