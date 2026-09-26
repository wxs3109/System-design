import { expect, it } from 'vitest'
import { defaultConfig, runModel, type Command } from './model'
import { lesson, scenarioCommands } from './lesson'
it.each(['ack-loss', 'uncommitted', 'checkpoint', 'point-in-time', 'damaged-archive'])('recovers from actual persisted inputs for %s', (scenario) => {
  const d = lesson.initial(); d.config.acknowledgement = 'wal'; d.scenario = scenario; d.commands = scenarioCommands(d.config, scenario)
  const a = lesson.runAttempt(d); expect(a.evaluation.task).toBe(true); expect(lesson.verifyAttempt(a)).toBe(true)
  expect(a.result.value).toBe(['checkpoint', 'damaged-archive'].includes(scenario) ? 3 : 1)
  expect(lesson.verifyAttempt({ ...a, result: { ...a.result, applied: [] } })).toBe(false)
})
it('memory acknowledgement really loses the confirmed write on crash', () => {
  const d = lesson.initial(); d.commands = scenarioCommands(d.config, d.scenario); const a = lesson.runAttempt(d)
  expect(a.result.value).toBe(0); expect(a.result.acknowledgements).toHaveLength(1); expect(a.evaluation.task).toBe(false)
})
it('requires WAL before persistent acknowledgement or installing a data checkpoint', () => {
  const c = { ...defaultConfig(), acknowledgement: 'wal' as const }
  const prefix: Command[] = [{ type: 'begin', delta: 1 }, { type: 'append-update' }, { type: 'append-commit' }, { type: 'apply' }]
  expect(() => runModel(c, [...prefix, { type: 'ack' }])).toThrow('未刷盘')
  expect(() => runModel(c, [...prefix, { type: 'checkpoint' }])).toThrow('WAL')
})
it('rejects gaps and corruption inside a restore target instead of borrowing the client ledger', () => {
  const c = defaultConfig(); const guide = scenarioCommands(c, 'damaged-archive'); const at = guide.findIndex((cmd) => cmd.type === 'restore')
  const blocked = runModel(c, guide.slice(0, at + 1)); expect(blocked.phase).toBe('blocked'); expect(blocked.value).toBeNull(); expect(blocked.acknowledgements).toHaveLength(2)
  const replacement = guide.slice(0, at).filter((cmd) => cmd.type !== 'corrupt'); replacement.push({ type: 'remove', archive: 'archive-1', lsn: 2 }, { type: 'restore', backup: 'backup-1', archive: 'archive-1', target: 4 })
  expect(runModel(c, replacement).phase).toBe('blocked')
})
it('installs the restored data so a subsequent restart preserves the selected timeline', () => {
  const c = defaultConfig(); const commands = scenarioCommands(c, 'point-in-time'); commands.push({ type: 'crash' }, { type: 'restart' })
  const s = runModel(c, commands); expect(s.phase).toBe('online'); expect(s.value).toBe(1); expect(s.applied).toEqual(['txn-1'])
})
