'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ProjectFile, SimulationProgress } from '@system-design/model'
import type { ProjectRevisionRecord, SimulationRunRecord } from './local-history'
import type { CompletedWorkbenchRun, WorkbenchSession } from './workbench-session'
import { useWorkbenchStore } from './workbench-store-provider'
import { LabStorageError } from '../core/experiments/errors'
import type { BackupPreview } from '../core/experiments/history'

export function useWorkbenchSession(session: WorkbenchSession, onCompleted?: (run: CompletedWorkbenchRun) => void) {
  const project = useWorkbenchStore(state => state.project)
  const setError = useWorkbenchStore(state => state.setError)
  const [ready, setReady] = useState(false)
  const [storage, setStorage] = useState<{ error: string; errorKind: 'load' | 'save' | 'conflict' | null; retained: unknown[] }>({ error: '', errorKind: null, retained: [] })
  const [progress, setProgress] = useState<SimulationProgress | null>(null)
  const [revisions, setRevisions] = useState<ProjectRevisionRecord[]>([])
  const [runs, setRuns] = useState<SimulationRunRecord[]>([])
  const mounted = useRef(false); const lifecycle = useRef(0); const readyRef = useRef(false)
  const readGeneration = useRef(0); const saveGeneration = useRef(0)
  const persistedFingerprint = useRef<string | null>(null)
  const completionRef = useRef(onCompleted)
  useEffect(() => { completionRef.current = onCompleted }, [onCompleted])
  const invalidate = useCallback(() => { lifecycle.current++; readGeneration.current++; saveGeneration.current++ }, [])

  const refreshHistory = useCallback(async (projectId: string) => {
    const token = lifecycle.current; const history = session.history
    if (!history) return
    const [savedRevisions, savedRuns] = await Promise.all([history.listProjectRevisions(projectId), history.listSimulationRuns(projectId)])
    if (mounted.current && token === lifecycle.current && session.store.getState().project.id === projectId) { setRevisions(savedRevisions); setRuns(savedRuns); setStorage(current => ({ ...current, retained: history.retainedRecords?.() ?? [] })) }
  }, [session])

  const restore = useCallback(async (force = false) => {
    const token = ++readGeneration.current; saveGeneration.current++
    readyRef.current = false; setReady(false); session.cancel()
    setStorage({ error: '', errorKind: null, retained: [] })
    const initial = session.store.getState().project
    try {
      if (session.recovered && !force) {
        await refreshHistory(initial.id)
        if (!mounted.current || token !== readGeneration.current) return
        persistedFingerprint.current = session.persistedFingerprint
        readyRef.current = true; setReady(true); return
      }
      const saved = await session.history?.loadActiveProject()
      if (!mounted.current || token !== readGeneration.current) return
      if (saved && session.restoreOnMount && session.store.getState().project === initial) session.store.getState().restoreProject(saved.project)
      await refreshHistory(session.store.getState().project.id)
      if (!mounted.current || token !== readGeneration.current) return
      persistedFingerprint.current = saved ? JSON.stringify(session.restoreOnMount ? session.store.getState().project : saved.project) : null
      session.noteRestored(persistedFingerprint.current)
      readyRef.current = true; setReady(true)
    } catch (cause) {
      if (mounted.current && token === readGeneration.current) setStorage({ error: cause instanceof Error ? cause.message : '无法读取原工作台。', errorKind: 'load', retained: [] })
    }
  }, [session, refreshHistory])

  const save = useCallback(async (snapshot?: ProjectFile) => {
    if (!readyRef.current) return
    const history = session.history
    if (!history) return
    const input = structuredClone(snapshot ?? session.store.getState().project)
    const token = ++saveGeneration.current; const life = lifecycle.current
    try {
      await history.saveProjectRevision(input)
      if (!mounted.current || life !== lifecycle.current || token !== saveGeneration.current) return
      persistedFingerprint.current = JSON.stringify(input)
      session.noteSaved(persistedFingerprint.current)
      setStorage({ error: '', errorKind: null, retained: [] })
      await refreshHistory(session.store.getState().project.id)
    } catch (cause) {
      if (!mounted.current || life !== lifecycle.current || token !== saveGeneration.current) return
      const kind = cause instanceof LabStorageError ? cause.kind : 'save'
      if (kind !== 'save') { readyRef.current = false; setReady(false); session.cancel() }
      setStorage({ error: cause instanceof Error ? cause.message : '无法保存工作台，本页修改仍保留。', errorKind: kind, retained: [] })
    }
  }, [session, refreshHistory])

  useEffect(() => {
    mounted.current = true; lifecycle.current++
    const life = lifecycle.current
    void Promise.resolve().then(() => { if (mounted.current && life === lifecycle.current) return restore() })
    return () => {
      mounted.current = false; invalidate()
      if (readyRef.current) {
        const current = session.store.getState().project
        if (JSON.stringify(current) !== persistedFingerprint.current) void session.history?.saveProjectRevision(current).catch(() => { /* Original data remains protected by the storage transaction. */ })
      }
      readyRef.current = false; session.dispose()
    }
  }, [session, restore, invalidate])

  useEffect(() => {
    if (!ready || !session.history || JSON.stringify(project) === persistedFingerprint.current) return
    const timer = window.setTimeout(() => { void save(project) }, 350)
    return () => window.clearTimeout(timer)
  }, [ready, project, session, save])

  const run = useCallback(async () => {
    if (!readyRef.current) return
    const token = lifecycle.current
    setProgress(null)
    const completed = await session.run(next => { if (mounted.current && token === lifecycle.current) setProgress(next) })
    if (!completed || !mounted.current || token !== lifecycle.current || !readyRef.current) return
    if (completed.persistenceError) setError(`Simulation completed, but saving failed: ${completed.persistenceError}`)
    completionRef.current?.(completed)
    try { await refreshHistory(completed.project.id) }
    catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : 'Could not refresh run history.') }
  }, [session, refreshHistory, setError])

  const recovery = {
    load: () => restore(true), reload: () => restore(true), save: () => save(),
    recoverySnapshot: () => structuredClone({ format: 'system-design-workbench-recovery', version: 1, scope: session.id, capturedAt: new Date().toISOString(), project: session.store.getState().project, result: session.store.getState().result, revisions, runs, persistedSource: session.history?.recoveryData?.() ?? null }),
    exportRecovery: async () => { if (!session.history?.exportBackup) throw new Error('此存储不支持备份。'); return session.history.exportBackup(session.store.getState().project) },
    previewRecovery: async (value: unknown) => { if (!session.history?.previewBackup) throw new Error('此存储不支持备份。'); const preview = await session.history.previewBackup(value); if (session.id !== 'active' && (preview.draft as ProjectFile).id !== session.store.getState().project.id) throw new Error('备份不属于本练习。'); return preview },
    importRecovery: async (preview: BackupPreview) => {
      if (!readyRef.current || !session.history?.importBackup) throw new Error('请先成功读取当前工作台。')
      invalidate(); readyRef.current = false; setReady(false); session.cancel()
      try {
        const project = await session.history.importBackup(preview, session.store.getState().project)
        session.store.getState().restoreProject(project); persistedFingerprint.current = JSON.stringify(project)
        session.noteSaved(persistedFingerprint.current)
        await refreshHistory(project.id); readyRef.current = true; setReady(true)
      } catch (cause) { readyRef.current = true; setReady(true); throw cause }
    },
  }
  return { ready, progress, revisions, runs, refreshHistory, run, storage, recovery }
}
