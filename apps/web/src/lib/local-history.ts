'use client'

import Dexie, { type DexieOptions, type Table } from 'dexie'
import { getActiveExperiment, parseProjectFile, type ProjectFile, type SimulationResult } from '@system-design/model'
import { LabStorageError } from '../core/experiments/errors'
import { checkBackupSize, recoveryObject, type BackupPreview } from '../core/experiments/history'

export type ProjectRevisionSource = 'autosave' | 'import' | 'manual' | 'restore'

export interface SaveProjectRevisionOptions {
  /** Update this repository's restore pointer. Snapshot-only saves can opt out. */
  activate?: boolean
}

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
  imported?: boolean
  recordVersion?: 2
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
  key: string
  projectId: string
  projectRevisionId: string
  updatedAt: number
}
interface WorkspaceHead extends ActiveWorkspaceRecord { version: 1; revision: number }
const writeQueues = new Map<string, Promise<unknown>>()
function headRevision(head: WorkspaceHead | undefined): number {
  if (!head) return 0
  if (head.version !== 1 || !Number.isSafeInteger(head.revision) || head.revision < 0 || head.revision >= Number.MAX_SAFE_INTEGER) throw new LabStorageError('load', '工作台保存版本未知，已有记录已保留。')
  return head.revision
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
const normalizeRun = (run: SimulationRunRecord): SimulationRunRecord => {
  const r = run.result
  if ((run.recordVersion !== undefined && run.recordVersion !== 2) || !r || (r.engineVersion !== undefined && r.engineVersion !== 1)) throw new Error('Unsupported run or engine version.')
  if (typeof run.runId !== 'string' || typeof run.projectId !== 'string' || !Number.isFinite(run.createdAt) || r.runId !== run.runId || r.scenarioId !== run.projectId || typeof r.seed !== 'string'
    || !r.summary || [r.summary.generatedRequests, r.summary.completedRequests, r.summary.failedRequests, r.summary.throughputPerSecond, r.summary.errorRate, r.summary.latencyP50Ms, r.summary.latencyP95Ms, r.summary.latencyP99Ms, r.simulatedDurationMs, r.wallClockDurationMs].some(value => typeof value !== 'number' || !Number.isFinite(value))
    || ![r.nodes, r.events, r.spans, r.traces, r.timeSeries, r.operations, r.actions, r.warnings].every(Array.isArray)
    || [r.nodes, r.events, r.spans, r.traces, r.timeSeries, r.operations, r.actions].some(array => array.some(item => !item || typeof item !== 'object' || Array.isArray(item)))
    || r.nodes.some(node => typeof node.nodeId !== 'string') || r.events.some(event => typeof event.type !== 'string' || !event.attributes || !Number.isFinite(event.timestampMs))) throw new Error('Malformed saved run.')
  return { ...immutableCopy(run), ...(run.projectSnapshot ? { projectSnapshot: parseProjectFile(immutableCopy(run.projectSnapshot)) } : {}) }
}

export class LocalHistoryDatabase extends Dexie {
  projectRevisions!: Table<ProjectRevisionRecord, string>
  simulationRuns!: Table<SimulationRunRecord, string>
  activeWorkspace!: Table<ActiveWorkspaceRecord, string>
  workspaceHeads!: Table<WorkspaceHead, string>

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
    // Keep legacy pointers: old open clients can write there without replacing current heads.
    this.version(3).stores({ ...stores, workspaceHeads: '&key, updatedAt' }).upgrade(async transaction => {
      const old = await transaction.table('activeWorkspace').toArray() as ActiveWorkspaceRecord[]
      await transaction.table('workspaceHeads').bulkPut(old.map(head => ({ ...head, version: 1, revision: 0 })))
    })
  }
}

export class LocalHistoryRepository {
  private expectedRevision: number | undefined
  private loadFailed = false
  private legacyFingerprint: string | undefined
  private loadedSource: unknown = null
  private readGeneration = 0
  private retained = new Map<string, unknown>()
  /** Scopes isolate restore pointers; callers still own globally distinct project IDs. */
  constructor(readonly database = new LocalHistoryDatabase(), readonly workspaceKey = 'active') {}

  async saveProjectRevision(input: ProjectFile | unknown, source: ProjectRevisionSource = 'autosave', options: SaveProjectRevisionOptions = {}): Promise<ProjectRevisionRecord> {
    const project = parseProjectFile(immutableCopy(input)); const fingerprint = fingerprintProject(project)
    const activate = options.activate !== false
    const queueKey = this.database.name + ':' + this.workspaceKey
    const save = (writeQueues.get(queueKey) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      if (this.loadFailed) throw new LabStorageError('load', '尚未成功读取原工作台，已阻止写入。')
      let nextHeadRevision: number | undefined
      const revision = await this.database.transaction('rw', this.database.projectRevisions, this.database.simulationRuns, this.database.activeWorkspace, this.database.workspaceHeads, async () => {
        const head = await this.database.workspaceHeads.get(this.workspaceKey)
        const legacy = head ? undefined : await this.database.activeWorkspace.get(this.workspaceKey)
        const actual = headRevision(head)
        const activeRevision = head ? await this.database.projectRevisions.get(head.projectRevisionId) : undefined
        const identical = activeRevision?.fingerprint === fingerprint
        if (activate) {
          if (this.expectedRevision === undefined && (head || legacy) && !identical) throw new LabStorageError('load', '已有工作台尚未读取，不能覆盖。')
          if (this.expectedRevision !== undefined && actual !== this.expectedRevision && !identical) throw new LabStorageError('conflict', '另一个标签页已更新工作台。本页修改仍保留，未覆盖其他标签页的记录。')
          if (!head && legacy && this.legacyFingerprint !== JSON.stringify(legacy)) throw new LabStorageError('conflict', '旧版标签页已更新工作台，请重新读取。')
        }
        const latest = await this.latestRevisionForProject(project.id)
        let stored = latest?.fingerprint === fingerprint ? latest : undefined
        if (!stored) {
          const createdAt = Math.max(Date.now(), (latest?.createdAt ?? -1) + 1)
          stored = { revisionId: project.id + ':' + createdAt + ':' + nextId(), projectId: project.id, projectName: project.name, createdAt, source, fingerprint, project }
          await this.database.projectRevisions.add(stored)
        }
        if (activate) {
          nextHeadRevision = identical ? actual : actual + 1
          if (!identical) await this.database.workspaceHeads.put({ key: this.workspaceKey, version: 1, revision: nextHeadRevision, projectId: project.id, projectRevisionId: stored.revisionId, updatedAt: Date.now() })
        }
        await this.pruneRevisions(project.id)
        return immutableCopy(stored)
      })
      if (nextHeadRevision !== undefined) { this.expectedRevision = nextHeadRevision; this.legacyFingerprint = undefined }
      return revision
    })
    writeQueues.set(queueKey, save)
    return save
  }

  async loadActiveProject(): Promise<ProjectRevisionRecord | undefined> {
    const generation = ++this.readGeneration
    await writeQueues.get(this.database.name + ':' + this.workspaceKey)?.catch(() => undefined)
    this.loadFailed = true; this.expectedRevision = undefined
    const loaded = await this.database.transaction('r', this.database.workspaceHeads, this.database.activeWorkspace, this.database.projectRevisions, async () => {
      const head = await this.database.workspaceHeads.get(this.workspaceKey)
      const legacy = head ? undefined : await this.database.activeWorkspace.get(this.workspaceKey)
      const active = head ?? legacy
      if (generation === this.readGeneration) this.loadedSource = immutableCopy({ head, legacy })
      if (active && (typeof active.projectId !== 'string' || typeof active.projectRevisionId !== 'string')) throw new LabStorageError('load', '保存的工作台身份无效，原记录已保留。')
      const revision = active ? await this.database.projectRevisions.get(active.projectRevisionId) : undefined
      return { head, legacy, revision }
    })
    if (generation === this.readGeneration) this.loadedSource = immutableCopy(loaded)
    const revisionNumber = headRevision(loaded.head)
    if ((loaded.head || loaded.legacy) && !loaded.revision) throw new LabStorageError('load', '工作台指向的版本缺失，原保存指针已保留。')
    const revision = loaded.revision ? normalizeRevision(loaded.revision) : undefined
    if (revision && revision.projectId !== (loaded.head ?? loaded.legacy)?.projectId) throw new LabStorageError('load', '工作台指针和项目版本身份不一致，原记录已保留。')
    if (generation === this.readGeneration) {
      this.expectedRevision = revisionNumber
      this.legacyFingerprint = loaded.head ? undefined : JSON.stringify(loaded.legacy ?? null)
      this.loadFailed = false
    }
    return revision
  }

  recoveryData() { return immutableCopy({ active: this.loadedSource, retained: [...this.retained.values()] }) }
  retainedRecords() { return immutableCopy([...this.retained.values()]) }

  async exportBackup(project: ProjectFile) {
    const [revisions, runs] = await Promise.all([this.database.projectRevisions.where('projectId').equals(project.id).toArray(), this.database.simulationRuns.where('projectId').equals(project.id).toArray()])
    return { format: 'system-design-workbench-recovery', version: 2, scope: this.workspaceKey, capturedAt: new Date().toISOString(), project: immutableCopy(project), revisions, runs, persistedSource: this.recoveryData() }
  }
  async previewBackup(value: unknown): Promise<BackupPreview> {
    checkBackupSize(value); const data = recoveryObject(value)
    if (data.format !== 'system-design-workbench-recovery' || ![1, 2].includes(data.version as number) || data.scope !== this.workspaceKey) throw new Error('工作台备份的范围或版本不匹配。')
    const project = parseProjectFile(data.project)
    if (!Array.isArray(data.revisions) || !Array.isArray(data.runs) || data.revisions.length + data.runs.length > 10000) throw new Error('工作台历史格式或数量无效。')
    const revisions = data.revisions.map(row => normalizeRevision(row as ProjectRevisionRecord))
    if (revisions.some(row => typeof row.revisionId !== 'string' || !row.revisionId || !Number.isFinite(row.createdAt) || row.projectId !== project.id)) throw new Error('备份包含其他项目的版本。')
    const byId = new Map(revisions.map(row => [row.revisionId, row]))
    if (byId.size !== revisions.length) throw new Error('备份内存在重复项目版本。')
    let retained = 0
    const seen = new Set<string>()
    const runs = data.runs.map(raw => {
      const row = recoveryObject(raw) as unknown as SimulationRunRecord
      if (typeof row.runId !== 'string' || !row.runId || seen.has(row.runId) || row.projectId !== project.id || !Number.isFinite(row.createdAt)) throw new Error('备份运行身份无效或重复。')
      seen.add(row.runId)
      let run: SimulationRunRecord
      try { run = normalizeRun(row) } catch { retained++; return immutableCopy({ ...row, imported: true }) }
      const snapshot = run.projectSnapshot ?? byId.get(run.projectRevisionId)?.project
      if (!snapshot || snapshot.id !== project.id || run.result.seed !== getActiveExperiment(snapshot).seed || run.experimentId !== getActiveExperiment(snapshot).id) throw new Error('运行结果与项目快照不匹配。')
      return { ...run, imported: true }
    })
    return { records: revisions.length + runs.length, retained, draft: project, data: { ...data, project, revisions, runs } }
  }
  async importBackup(preview: BackupPreview, currentProject: ProjectFile) {
    const checked = await this.previewBackup(preview.data)
    const data = checked.data as { project: ProjectFile; revisions: ProjectRevisionRecord[]; runs: SimulationRunRecord[] }
    const prior = parseProjectFile(immutableCopy(currentProject))
    const queueKey = this.database.name + ':' + this.workspaceKey
    const save = (writeQueues.get(queueKey) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      if (this.loadFailed || this.expectedRevision === undefined) throw new LabStorageError('load', '成功读取工作台后才能导入。')
      const revision = await this.database.transaction('rw', this.database.projectRevisions, this.database.simulationRuns, this.database.workspaceHeads, this.database.activeWorkspace, async () => {
        const head = await this.database.workspaceHeads.get(this.workspaceKey)
        const legacy = head ? undefined : await this.database.activeWorkspace.get(this.workspaceKey)
        if (headRevision(head) !== this.expectedRevision || !head && this.legacyFingerprint !== JSON.stringify(legacy ?? null)) throw new LabStorageError('conflict', '其他标签页已更新工作台，导入未写入。')
        for (const row of data.revisions) {
          const existing = await this.database.projectRevisions.get(row.revisionId)
          if (existing && JSON.stringify(existing) !== JSON.stringify(row)) throw new Error('同名项目版本内容不同，原记录未变。')
          if (!existing) await this.database.projectRevisions.add(row)
        }
        for (const row of data.runs) {
          const existing = await this.database.simulationRuns.get(row.runId)
          if (existing && JSON.stringify({ ...existing, imported: true }) !== JSON.stringify(row)) throw new Error('同名运行历史内容不同，原记录未变。')
          if (!existing) await this.database.simulationRuns.add(row)
        }
        for (const [index, project] of [prior, data.project].entries()) {
          const createdAt = Date.now() + index
          const record: ProjectRevisionRecord = { revisionId: `${project.id}:${nextId()}`, projectId: project.id, projectName: project.name, createdAt, source: index ? 'import' : 'manual', fingerprint: fingerprintProject(project), project }
          await this.database.projectRevisions.add(record)
          if (index) await this.database.workspaceHeads.put({ key: this.workspaceKey, version: 1, revision: this.expectedRevision! + 1, projectId: project.id, projectRevisionId: record.revisionId, updatedAt: createdAt })
        }
        return this.expectedRevision! + 1
      })
      this.expectedRevision = revision; this.legacyFingerprint = undefined
    })
    writeQueues.set(queueKey, save); await save
    return data.project
  }

  async listProjectRevisions(projectId: string, limit = MAX_REVISIONS_PER_PROJECT): Promise<ProjectRevisionRecord[]> {
    const records = await this.database.projectRevisions
      .where('[projectId+createdAt]')
      .between([projectId, Dexie.minKey], [projectId, Dexie.maxKey])
      .reverse()
      .limit(limit)
      .toArray()
    return records.flatMap(record => { try { const normalized = normalizeRevision(record); this.retained.delete(record.revisionId); return [normalized] } catch { this.retained.set(record.revisionId, immutableCopy(record)); return [] } })
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
      : await this.saveProjectRevision(project, 'autosave', { activate: false })
    if (!revision || revision.projectId !== project.id) throw new Error('The simulation run must reference a revision of the same project.')
    if (revision.fingerprint !== fingerprintProject(project)) throw new Error('The simulation run must reference the exact project revision that was simulated.')
    if (result.scenarioId !== project.id || result.seed !== experiment.seed) throw new Error('The simulation result does not match the project and experiment snapshot.')

    const record: SimulationRunRecord = {
      recordVersion: 2,
      runId: result.runId,
      projectId: project.id,
      projectRevisionId: revision.revisionId,
      experimentId: experiment.id,
      createdAt: Date.now(),
      projectSnapshot: immutableCopy(project),
      result: immutableCopy(result),
    }
    normalizeRun(record)

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
    return records.flatMap(record => { try { const normalized = normalizeRun(record); this.retained.delete(record.runId); return [normalized] } catch { this.retained.set(record.runId, immutableCopy(record)); return [] } })
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
    for (const workspace of [...await this.database.activeWorkspace.toArray(), ...await this.database.workspaceHeads.toArray()]) {
      referenced.add(workspace.projectRevisionId)
    }
    const removable = []
    for (const id of candidates.filter(id => !referenced.has(id))) { const record = await this.database.projectRevisions.get(id); try { if (record) { normalizeRevision(record); removable.push(id) } } catch { this.retained.set(id, record) } }
    await this.database.projectRevisions.bulkDelete(removable)
  }

  private async pruneRuns(projectId: string) {
    const staleKeys = await this.database.simulationRuns
      .where('[projectId+createdAt]')
      .between([projectId, Dexie.minKey], [projectId, Dexie.maxKey])
      .reverse()
      .offset(MAX_RUNS_PER_PROJECT)
      .primaryKeys()
    const removable = []
    for (const id of staleKeys) { const record = await this.database.simulationRuns.get(id); try { if (record) { normalizeRun(record); removable.push(id) } } catch { this.retained.set(id, record) } }
    await this.database.simulationRuns.bulkDelete(removable)
  }
}

let sharedDatabase: LocalHistoryDatabase | undefined
const repositories = new Map<string, LocalHistoryRepository>()
export const getLocalHistoryRepository = (workspaceKey = 'active') => {
  let repository = repositories.get(workspaceKey)
  if (!repository) {
    sharedDatabase ??= new LocalHistoryDatabase()
    repository = new LocalHistoryRepository(sharedDatabase, workspaceKey)
    repositories.set(workspaceKey, repository)
  }
  return repository
}

/** A writer belongs to a session; sharing a database must not share its CAS cursor. */
export const createLocalHistoryRepository = (workspaceKey: string) => { sharedDatabase ??= new LocalHistoryDatabase(); return new LocalHistoryRepository(sharedDatabase, workspaceKey) }
