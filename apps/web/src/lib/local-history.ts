'use client'

import Dexie, { type DexieOptions, type Table } from 'dexie'
import { getActiveExperiment, projectFileV2Schema, type ProjectFileV2, type SimulationResult } from '@system-design/model'

export type ProjectRevisionSource = 'autosave' | 'import' | 'manual' | 'restore'

export interface ProjectRevisionRecord {
  revisionId: string
  projectId: string
  projectName: string
  createdAt: number
  source: ProjectRevisionSource
  fingerprint: string
  project: ProjectFileV2
}

export interface SimulationRunRecord {
  runId: string
  projectId: string
  projectRevisionId: string
  experimentId: string
  createdAt: number
  /** Exact design and experiment used by this run. Legacy v1 records may not have one. */
  projectSnapshot?: ProjectFileV2
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
const fingerprintProject = (project: ProjectFileV2) => JSON.stringify(project)
const nextId = () => globalThis.crypto?.randomUUID?.() ?? `fallback-${Date.now()}-${fallbackId++}`

export class LocalHistoryDatabase extends Dexie {
  projectRevisions!: Table<ProjectRevisionRecord, string>
  simulationRuns!: Table<SimulationRunRecord, string>
  activeWorkspace!: Table<ActiveWorkspaceRecord, string>

  constructor(name = 'system-design-simulator', options?: DexieOptions) {
    super(name, options)
    this.version(1).stores({
      projectRevisions: '&revisionId, projectId, [projectId+createdAt], fingerprint',
      simulationRuns: '&runId, projectId, [projectId+createdAt], projectRevisionId',
      activeWorkspace: '&key, updatedAt',
    })
  }
}

export class LocalHistoryRepository {
  constructor(readonly database = new LocalHistoryDatabase()) {}

  async saveProjectRevision(input: ProjectFileV2 | unknown, source: ProjectRevisionSource = 'autosave'): Promise<ProjectRevisionRecord> {
    const project = projectFileV2Schema.parse(immutableCopy(input))
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
    return { ...immutableCopy(revision), project: projectFileV2Schema.parse(immutableCopy(revision.project)) }
  }

  async listProjectRevisions(projectId: string, limit = MAX_REVISIONS_PER_PROJECT): Promise<ProjectRevisionRecord[]> {
    const records = await this.database.projectRevisions
      .where('[projectId+createdAt]')
      .between([projectId, Dexie.minKey], [projectId, Dexie.maxKey])
      .reverse()
      .limit(limit)
      .toArray()
    return records.map(immutableCopy)
  }

  async loadProjectRevision(revisionId: string): Promise<ProjectRevisionRecord | undefined> {
    const revision = await this.database.projectRevisions.get(revisionId)
    if (!revision) return undefined
    return { ...immutableCopy(revision), project: projectFileV2Schema.parse(immutableCopy(revision.project)) }
  }

  async saveSimulationRun(projectInput: ProjectFileV2 | unknown, result: SimulationResult, projectRevisionId?: string): Promise<SimulationRunRecord> {
    const project = projectFileV2Schema.parse(immutableCopy(projectInput))
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
    return records.map(immutableCopy)
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
