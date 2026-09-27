export interface AttemptIdentity { id: string; createdAt: number }
export interface LabContract<D, A extends AttemptIdentity> {
  initial: () => D
  parseDraft: (value: unknown) => D
  runAttempt: (draft: D) => A
  verifyAttempt: (value: unknown) => value is A
}

/** Storage implementations own transactions; the session only depends on this port. */
export interface ExperimentRepository<D, A extends AttemptIdentity> {
  readonly scope: string
  readonly contract: LabContract<D, A>
  load(): Promise<{ draft: D | null; activeAttemptId: string | null; attempts: A[]; rejected: number }>
  save(draft: D, activeAttemptId: string | null, attempts: A[]): Promise<unknown>
}
