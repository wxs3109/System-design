import type { ExperimentVersions } from './versions'
export interface AttemptIdentity { id: string; createdAt: number }
export interface LabContract<D, A extends AttemptIdentity> {
  versions?: ExperimentVersions
  draftVersion?: number
  /** Each key upgrades that schema version to the next; migrations must be explicit. */
  draftMigrations?: Readonly<Record<number, (value: unknown) => unknown>>
  initial: () => D
  parseDraft: (value: unknown) => D
  runAttempt: (draft: D) => A
  verifyAttempt: (value: unknown) => value is A
}

/** Storage implementations own transactions; the session only depends on this port. */
export interface ExperimentRepository<D, A extends AttemptIdentity> {
  readonly scope: string
  readonly contract: LabContract<D, A>
  load(): Promise<{ draft: D | null; activeAttemptId: string | null; attempts: A[]; rejected: number; retained?: unknown[] }>
  save(draft: D, activeAttemptId: string | null, attempts: A[]): Promise<unknown>
  recoveryData?(): unknown
}
