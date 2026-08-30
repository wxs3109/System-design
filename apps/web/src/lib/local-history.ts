'use client'

import Dexie, { type DexieOptions, type Table } from 'dexie'
import { getActiveExperiment, parseProjectFile, type ProjectFile, type SimulationResult } from '@system-design/model'

export type ProjectRevisionSource = 'autosave' | 'import' | 'manual' | 'restore'

export interface ProjectRevisionRecord {
  revisionId: string
  projectId: string
  projectName: string
  createdAt: number
  source: ProjectRevisionSource
  fingerprint: string
  project: ProjectFile
}

export interface SimulationRunRecord {
  runId: string
  projectId: string
  projectRevisionId: string
  experimentId: string
  createdAt: number
  /** Exact design and experiment used by this run. Legacy v1 records may not have one. */
  projectSnapshot?: ProjectFile
  result: SimulationResult
}

interface ActiveWorkspaceRecord {
  key: 'active'
  projectId: string
  projectRevisionId: string
  updatedAt: number
}

const MAX_REVISIONS_PER_PROJECT = 50
const MAX_RUNS_PER_PROJECT = 25
let fallbackId = 0

const immutableCopy = <T>(value: T): T => structuredClone(value)
const fingerprintProject = (project: ProjectFile) => JSON.stringify(project)
const nextId = () => globalThis.crypto?.randomUUID?.() ?? `fallback-${Date.now()}-${fallbackId++}`
const normalizeRevision = (revision: ProjectRevisionRecord): ProjectRevisionRecord => {
  const project = parseProjectFile(immutableCopy(revision.project))
  return {
    ...immutableCopy(revision),
    projectId: project.id,
    projectName: project.name,
    fingerprint: fingerprintProject(project),
    project,
  }
}
const normalizeRun = (run: SimulationRunRecord): SimulationRunRecord => ({
  ...immutableCopy(run),
  ...(run.projectSnapshot ? { projectSnapshot: parseProjectFile(immutableCopy(run.projectSnapshot)) } : {}),
})

export class LocalHistoryDatabase extends Dexie {
  projectRevisions!: Table<ProjectRevisionRecord, string>
  simulationRuns!: Table<SimulationRunRecord, string>
  activeWorkspace!: Table<ActiveWorkspaceRecord, string>

  constructor(name = 'system-design-simulator', options?: DexieOptions) {
    super(name, options)
    const stores = {
      projectRevisions: '&revisionId, projectId, [projectId+createdAt], fingerprint',
      simulationRuns: '&runId, projectId, [projectId+createdAt], projectRevisionId',
      activeWorkspace: '&key, updatedAt',
    }
    this.version(1).stores(stores)
    this.version(2).stores(stores).upgrade(async (transaction) => {
      await transaction.table<ProjectRevisionRecord>('projectRevisions').toCollection().modify((revision) => {
        const project = parseProjectFile(revision.project)
        revision.project = project
        revision.projectId = project.id
        revision.projectName = project.name
        revision.fingerprint = fingerprintProject(project)
      })
      await transaction.table<SimulationRunRecord>('simulationRuns').toCollection().modify((run) => {
        if (run.projectSnapshot) run.projectSnapshot = parseProjectFile(run.projectSnapshot)
      })
    })
  }
}

export class LocalHistoryRepository {
  constructor(readonly database = new LocalHistoryDatabase()) {}

  async saveProjectRevision(input: ProjectFile | unknown, source: ProjectRevisionSource = 'autosave'): Promise<ProjectRevisionRecord> {
    const project = parseProjectFile(immutableCopy(input))
    const fingerprint = fingerprintProject(project)

    return this.database.transaction('rw', this.database.projectRevisions, this.database.simulationRuns, this.database.activeWorkspace, async () => {
      const latest = await this.latestRevisionForProject(project.id)
      if (latest?.fingerprint === fingerprint) {
        await this.database.activeWorkspace.put({
          key: 'active', projectId: project.id, projectRevisionId: latest.revisionId, updatedAt: Date.now(),
        })
        return immutableCopy(latest)
      }

      const createdAt = Math.max(Date.now(), (latest?.createdAt ?? -1) + 1)
      const revision: ProjectRevisionRecord = {
        revisionId: `${project.id}:${createdAt}:${nextId()}`,
        projectId: project.id,
        projectName: project.name,
        createdAt,
        source,
        fingerprint,
        project: immutableCopy(project),
      }
      await this.database.projectRevisions.add(revision)
      await this.database.activeWorkspace.put({
        key: 'active', projectId: project.id, projectRevisionId: revision.revisionId, updatedAt: createdAt,
      })
      await this.pruneRevisions(project.id)
      return immutableCopy(revision)
    })
  }

  async loadActiveProject(): Promise<ProjectRevisionRecord | undefined> {
    const active = await this.database.activeWorkspace.get('active')
    if (!active) return undefined
    const revision = await this.database.projectRevisions.get(active.projectRevisionId)
    if (!revision) return undefined
    return normalizeRevision(revision)
  }

  async listProjectRevisions(projectId: string, limit = MAX_REVISIONS_PER_PROJECT): Promise<ProjectRevisionRecord[]> {
    const records = await this.database.projectRevisions
      .where('[projectId+createdAt]')
      .between([projectId, Dexie.minKey], [projectId, Dexie.maxKey])
      .reverse()
      .limit(limit)
      .toArray()
    return records.map(normalizeRevision)
  }

  async loadProjectRevision(revisionId: string): Promise<ProjectRevisionRecord | undefined> {
    const revision = await this.database.projectRevisions.get(revisionId)
    if (!revision) return undefined
    return normalizeRevision(revision)
  }

  async saveSimulationRun(projectInput: ProjectFile | unknown, result: SimulationResult, projectRevisionId?: string): Promise<SimulationRunRecord> {
    const project = parseProjectFile(immutableCopy(projectInput))
    const experiment = getActiveExperiment(project)
    const revision = projectRevisionId
      ? await this.database.projectRevisions.get(projectRevisionId)
      : await this.saveProjectRevision(project, 'autosave')
    if (!revision || revision.projectId !== project.id) throw new Error('The simulation run must reference a revision of the same project.')
    if (revision.fingerprint !== fingerprintProject(project)) throw new Error('The simulation run must reference the exact project revision that was simulated.')
    if (result.scenarioId !== project.id || result.seed !== experiment.seed) throw new Error('The simulation result does not match the project and experiment snapshot.')

    const record: SimulationRunRecord = {
      runId: result.runId,
      projectId: project.id,
      projectRevisionId: revision.revisionId,
      experimentId: experiment.id,
      createdAt: Date.now(),
      projectSnapshot: immutableCopy(project),
      result: immutableCopy(result),
    }

    await this.database.transaction('rw', this.database.simulationRuns, async () => {
      await this.database.simulationRuns.add(record)
      await this.pruneRuns(project.id)
    })
    return immutableCopy(record)
  }

  async listSimulationRuns(projectId: string, limit = MAX_RUNS_PER_PROJECT): Promise<SimulationRunRecord[]> {
    const records = await this.database.simulationRuns
      .where('[projectId+createdAt]')
      .between([projectId, Dexie.minKey], [projectId, Dexie.maxKey])
      .reverse()
      .limit(limit)
      .toArray()
    return records.map(normalizeRun)
  }

  private latestRevisionForProject(projectId: string) {
    return this.database.projectRevisions
      .where('[projectId+createdAt]')
      .between([projectId, Dexie.minKey], [projectId, Dexie.maxKey])
      .reverse()
      .first()
  }

  private async pruneRevisions(projectId: string) {
    const candidates = await this.database.projectRevisions
      .where('[projectId+createdAt]')
      .between([projectId, Dexie.minKey], [projectId, Dexie.maxKey])
      .reverse()
      .offset(MAX_REVISIONS_PER_PROJECT)
      .primaryKeys()
    const referenced = new Set((await this.database.simulationRuns.where('projectId').equals(projectId).toArray()).map((run) => run.projectRevisionId))
    await this.database.projectRevisions.bulkDelete(candidates.filter((revisionId) => !referenced.has(revisionId)))
  }

  private async pruneRuns(projectId: string) {
    const staleKeys = await this.database.simulationRuns
      .where('[projectId+createdAt]')
      .between([projectId, Dexie.minKey], [projectId, Dexie.maxKey])
      .reverse()
      .offset(MAX_RUNS_PER_PROJECT)
      .primaryKeys()
    await this.database.simulationRuns.bulkDelete(staleKeys)
  }
}

let repository: LocalHistoryRepository | undefined
export const getLocalHistoryRepository = () => repository ??= new LocalHistoryRepository()
