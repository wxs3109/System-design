'use client'
import { useEffect, useSyncExternalStore } from 'react'
import type { AttemptIdentity } from '../../core/experiments/contracts'
import type { LabSession } from '../../core/experiments/session'
import { useRecoveryResource } from './recovery-boundary'

/** React owns mounting; execution, persistence and recovery remain in the session. */
export function useExperiment<D, A extends AttemptIdentity & { draft: D }>(create: () => LabSession<D, A>, key = 'experiment') {
  const session = useRecoveryResource(key, create, session => ({ scope: session.repository.scope, label: key === 'notes' ? '设计笔记' : '实验输入', snapshot: () => session.recoverySnapshot(), export: () => session.exportRecovery(), reload: () => session.reload(), cancel: () => session.cancel() }))
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot)
  useEffect(() => { void session.load(); return () => session.cancel() }, [session])
  return { session, state }
}
