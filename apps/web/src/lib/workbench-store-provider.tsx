'use client'

import { createContext, useContext, type ReactNode } from 'react'
import { useStore } from 'zustand'
import type { WorkbenchState, WorkbenchStore } from './store'

const WorkbenchStoreContext = createContext<WorkbenchStore | null>(null)

export function WorkbenchStoreProvider({ store, children }: { store: WorkbenchStore; children: ReactNode }) {
  return <WorkbenchStoreContext.Provider value={store}>{children}</WorkbenchStoreContext.Provider>
}

export function useWorkbenchStoreApi(): WorkbenchStore {
  const store = useContext(WorkbenchStoreContext)
  if (!store) throw new Error('Workbench components must be rendered inside a WorkbenchStoreProvider.')
  return store
}

const selectState = (state: WorkbenchState) => state

export function useWorkbenchStore(): WorkbenchState
export function useWorkbenchStore<T>(selector: (state: WorkbenchState) => T): T
export function useWorkbenchStore<T>(selector?: (state: WorkbenchState) => T): T | WorkbenchState {
  return useStore<WorkbenchStore, T | WorkbenchState>(useWorkbenchStoreApi(), selector ?? selectState)
}

export const useCanUndo = () => useStore(useWorkbenchStoreApi().temporal, (state) => state.pastStates.length > 0)
export const useCanRedo = () => useStore(useWorkbenchStoreApi().temporal, (state) => state.futureStates.length > 0)
