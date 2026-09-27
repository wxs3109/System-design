import { componentPresetRegistry, componentRegistry } from '@system-design/components'
import type { ProjectFile, SimulationProgress, SimulationResult } from '@system-design/model'
import { validateScenarioForSimulation } from '@system-design/simulation'
import { SimulationWorkerClient } from '@system-design/simulation/client'
import { createLocalHistoryRepository, type LocalHistoryRepository } from './local-history'
import { ExecutionCoordinator } from '../core/experiments/execution'
import { createWorkbenchStore } from './store'

export type WorkbenchHistory = Pick<LocalHistoryRepository,
  'saveProjectRevision' | 'loadActiveProject' | 'listProjectRevisions' | 'loadProjectRevision' | 'saveSimulationRun' | 'listSimulationRuns'> & Partial<Pick<LocalHistoryRepository, 'recoveryData' | 'retainedRecords' | 'exportBackup' | 'previewBackup' | 'importBackup'>>

export interface CompletedWorkbenchRun {
  project: ProjectFile
  result: SimulationResult
  persistenceError?: string
}

interface WorkbenchRunner {
  run: SimulationWorkerClient['run']
  cancelActive: SimulationWorkerClient['cancelActive']
  dispose: SimulationWorkerClient['dispose']
}

export interface WorkbenchSessionOptions {
  id: string
  initialProject?: ProjectFile
  restoreOnMount?: boolean
  history?: WorkbenchHistory | null
  createRunner?: () => WorkbenchRunner
}

/** One editable experiment and its runner. Course/assessment state stays outside. */
export class WorkbenchSession {
  readonly store
  readonly id: string
  readonly restoreOnMount: boolean
  /** Survives a rendering retry together with the writer's conflict cursor. */
  private restored = false
  private savedFingerprint: string | null = null
  get recovered() { return this.restored }
  get persistedFingerprint() { return this.savedFingerprint }
  noteRestored(fingerprint: string | null) { this.restored = true; this.savedFingerprint = fingerprint }
  noteSaved(fingerprint: string) { this.savedFingerprint = fingerprint }
  private readonly initialProject: ProjectFile
  private readonly historyOverride: WorkbenchHistory | null | undefined
  private readonly createRunner: () => WorkbenchRunner
  private runner: WorkbenchRunner | null = null
  private readonly execution = new ExecutionCoordinator()
  private defaultHistory: WorkbenchHistory | undefined

  constructor(options: WorkbenchSessionOptions) {
    if (!options.id.trim()) throw new Error('A workbench session needs an ID.')
    this.id = options.id
    this.store = createWorkbenchStore(options.initialProject)
    this.initialProject = structuredClone(this.store.getState().project)
    this.restoreOnMount = options.restoreOnMount ?? true
    this.historyOverride = options.history
    this.createRunner = options.createRunner ?? (() => new SimulationWorkerClient())
  }

  get history(): WorkbenchHistory | null {
    return this.historyOverride === undefined ? this.defaultHistory ??= createLocalHistoryRepository(this.id) : this.historyOverride
  }

  reset() {
    this.cancel()
    this.store.getState().restoreProject(structuredClone(this.initialProject))
  }

  cancel() {
    this.execution.cancel()
    this.runner?.cancelActive()
    this.store.getState().setRunning(false)
  }

  /** Release browser resources. A remounted view can lazily create a new runner. */
  dispose() {
    this.cancel()
    this.runner?.dispose()
    this.runner = null
  }

  async run(onProgress?: (progress: SimulationProgress) => void): Promise<CompletedWorkbenchRun | undefined> {
    this.cancel()
    const state = this.store.getState()
    let project: ProjectFile
    try {
      project = componentRegistry.validateProject(structuredClone(state.project), componentPresetRegistry)
      const validation = validateScenarioForSimulation(project)
      if (validation.errors.length > 0) throw new Error(validation.errors.join(' '))
    } catch (cause) {
      state.setError(cause instanceof Error ? cause.message : 'The project cannot be simulated.')
      return undefined
    }
    const fingerprint = JSON.stringify(project)
    const lease = this.execution.begin(() => JSON.stringify(this.store.getState().project) === fingerprint)
    const isCurrent = lease.isCurrent
    state.setRunning(true)
    state.setError(null)
    state.setResult(null)
    const unsubscribe = this.store.subscribe((current, previous) => {
      if (!lease.signal.aborted && current.project !== previous.project && !isCurrent()) this.cancel()
    })
    try {
      this.runner ??= this.createRunner()
      const result = await this.runner.run(project, {
        ...(onProgress ? { onProgress: (progress: SimulationProgress) => { if (isCurrent()) onProgress(progress) } } : {}),
      })
      if (!isCurrent()) return undefined
      const completed: CompletedWorkbenchRun = { project: structuredClone(project), result: structuredClone(result) }
      this.store.getState().setResult(result)
      try {
        const history = this.history
        if (history) {
          const revision = await history.saveProjectRevision(project, 'autosave', { activate: false })
          await history.saveSimulationRun(project, result, revision.revisionId)
        }
      } catch (cause) {
        completed.persistenceError = cause instanceof Error ? cause.message : 'Could not save simulation run.'
      }
      return isCurrent() ? completed : undefined
    } catch (cause) {
      if (isCurrent() && !(cause instanceof DOMException && cause.name === 'AbortError')) {
        this.store.getState().setError(cause instanceof Error ? cause.message : 'Simulation failed.')
      }
      return undefined
    } finally {
      unsubscribe()
      if (lease.owns()) this.store.getState().setRunning(false)
      lease.finish()
    }
  }
}

export const createWorkbenchSession = (options: WorkbenchSessionOptions) => new WorkbenchSession(options)
