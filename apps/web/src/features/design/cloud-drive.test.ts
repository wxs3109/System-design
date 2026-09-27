import { describe, expect, it } from 'vitest'
import { cloudDriveDesign, runCloudDrive } from './cloud-drive'
import { productLesson } from './product-lesson'

describe('cloud drive end-to-end product model', () => {
  const safe = cloudDriveDesign.alternatives[0]!.config
  for (const scenario of cloudDriveDesign.scenarios) it(`executes ${scenario.id} with both explicit conflict policies`, () => {
    for (const alternative of cloudDriveDesign.alternatives) {
      const result = runCloudDrive(alternative.config, scenario.script)
      expect(scenario.check(result), JSON.stringify(result)).toSatisfy((checks: { pass: boolean }[]) => checks.every((c) => c.pass))
    }
    if (!['versions', 'create'].includes(scenario.id)) expect(scenario.check(runCloudDrive(cloudDriveDesign.initialConfig, scenario.script)).some((c) => !c.pass)).toBe(true)
  })
  it('isolates lost notifications from idempotency, and early cursor advancement from the server log', () => {
    const gap = cloudDriveDesign.scenarios.find((s) => s.id === 'gap')!
    const missing = runCloudDrive({ ...safe, changefeed: 'split' }, gap.script)
    expect(missing.metrics).toMatchObject({ editEffects: 1, replays: 1, changes: 0, deviceBCurrent: 0 })
    const checkpoint = cloudDriveDesign.scenarios.find((s) => s.id === 'checkpoint')!
    const skipped = runCloudDrive({ ...safe, checkpoint: 'early' }, checkpoint.script)
    expect(skipped.metrics).toMatchObject({ changes: 1, cursorB: 1, deviceBCurrent: 0 })
  })
  it('preserves both concurrent contents as explicit conflict copies', () => {
    const scenario = cloudDriveDesign.scenarios.find((s) => s.id === 'concurrent')!
    const result = runCloudDrive({ ...safe, conflict: 'copy' }, scenario.script)
    expect(result.metrics).toMatchObject({ fileCount: 2, conflictCopies: 1, silentOverwrites: 0, canonicalMatchesA: 1 })
    expect(Object.values(result.state.devices).map((d) => d.edit!.content)).toEqual(['A edit 1', 'B edit 1'])
  })
  it('retains a stable receipt when an older successful operation is retried after a later edit', () => {
    const result = runCloudDrive(safe, ['prepare-a', 'upload-a', 'commit-a', 'sync-b', 'prepare-b', 'upload-b', 'commit-b', 'commit-a'])
    expect(result.metrics).toMatchObject({ replays: 1, editEffects: 2, duplicateEffects: 0 })
    expect(result.state.responses.at(-1)).toEqual({ operationId: 'A-1', status: 'replayed', fileId: 'f1', revision: 2 })
  })
  it('does not mutate folders or grants while the metadata process is crashed', () => {
    const result = runCloudDrive(safe, ['prepare-a', 'upload-a', 'commit-a-gap', 'create-folder', 'share', 'revoke', 'guest-get'])
    expect(result.metrics).toMatchObject({ grants: 0, revocations: 0, guestAllowed: 0, guestDeniedAfterRevoke: 0 })
    expect(Object.keys(result.state.folders)).toHaveLength(2)
  })
  it('cannot reconstruct forgotten trash or prior versions from its observer history', () => {
    const result = runCloudDrive({ ...safe, deletion: 'forget' }, ['prepare-a', 'upload-a', 'commit-a', 'delete', 'restore', 'restore-previous', 'download-previous'])
    expect(result.metrics).toMatchObject({ restores: 0, versionRestores: 0, previousDownloads: 0, canonicalDeleted: 1 })
    expect(result.state.history.length).toBeGreaterThan(0)
    expect(result.state.versionIndex).toHaveLength(0)
  })
  it('requires actual revocation and actual denied downloads, not just a revoke button click', () => {
    const scenario = cloudDriveDesign.scenarios.find((s) => s.id === 'sharing')!
    expect(scenario.check(runCloudDrive(safe, ['share', 'guest-get', 'revoke'])).every((c) => c.pass)).toBe(false)
    expect(runCloudDrive({ ...safe, sharing: 'bearer' }, scenario.script).metrics.leaks).toBe(1)
    expect(scenario.check(runCloudDrive({ ...safe, sharing: 'bearer' }, ['share', 'guest-get', 'revoke', 'delete', 'guest-get'])).every((c) => c.pass)).toBe(false)
  })
  it('does not mistake an ordinary restart or one-device retry for the required failure interleaving', () => {
    const checkpoint = cloudDriveDesign.scenarios.find((s) => s.id === 'checkpoint')!
    expect(checkpoint.check(runCloudDrive(safe, ['crash-b', 'prepare-a', 'upload-a', 'commit-a', 'sync-b', 'download-b'])).every((c) => c.pass)).toBe(false)
    const concurrent = cloudDriveDesign.scenarios.find((s) => s.id === 'concurrent')!
    expect(concurrent.check(runCloudDrive({ ...safe, idempotency: 'append' }, ['prepare-a', 'upload-a', 'commit-a', 'commit-a', 'sync-b', 'download-b'])).every((c) => c.pass)).toBe(false)
  })
  it('validates persisted metadata, byte-read evidence and action vocabulary by replay', () => {
    const lesson = productLesson(cloudDriveDesign)
    const attempt = lesson.runAttempt({ ...lesson.initial(), config: safe, commands: [...cloudDriveDesign.scenarios[0]!.script] })
    expect(lesson.verifyAttempt(attempt)).toBe(true)
    const state = attempt.result.state as ReturnType<typeof runCloudDrive>['state']
    state.downloads = []
    expect(lesson.verifyAttempt(attempt)).toBe(false)
    expect(() => lesson.parseDraft({ ...lesson.initial(), commands: ['delete-everything'] })).toThrow()
  })
})
