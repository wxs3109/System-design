'use client'
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { AttemptIdentity } from '../../core/experiments/contracts'
import type { LabSession } from '../../core/experiments/session'

/** React owns mounting; execution, persistence and recovery remain in the session. */
export function useExperiment<D, A extends AttemptIdentity & { draft: D }>(create: () => LabSession<D, A>) {
  const [session] = useState(create)
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot)
  useEffect(() => { void session.load(); return () => session.cancel() }, [session])
  return { session, state }
}
