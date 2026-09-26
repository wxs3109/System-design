export interface AttemptIdentity { id: string; createdAt: number }
export interface LabContract<D, A extends AttemptIdentity> {
  initial: () => D
  parseDraft: (value: unknown) => D
  runAttempt: (draft: D) => A
  verifyAttempt: (value: unknown) => value is A
}
