import { createProtocolLesson } from '../../../core/experiments/protocol-lesson'
import { defaultConfig, MAX_COMMANDS, parseCommand, parseConfig, runModel, type Command, type Config } from './model'
export const exercise = { kind: 'protocol' as const, id: 'durability-recovery', version: 1, title: '进程重启了，已经确认的数据还在吗？', category: 'WAL、检查点与恢复', difficulty: '进阶', estimatedMinutes: 30, summary: '区分内存、稳定日志、数据页、备份和归档；亲手刷盘、崩溃、重放，并从指定提交边界或损坏材料中恢复。', flow: ['提交与确认', '刷盘与快照', '故障', '核对恢复边界'] } as const
export const scenarios = { 'ack-loss': '确认之后进程崩溃', uncommitted: '日志有更新但没有提交', checkpoint: '检查点之后的日志重放', 'point-in-time': '恢复到较早提交边界', 'damaged-archive': '归档损坏与备用副本', manual: '自由实验' }
export function scenarioCommands(c: Config, scenario: string): Command[] {
  const commands: Command[] = []; const state = () => runModel(c, commands); const act = (command: Command) => { commands.push(command); return state() }
  const transaction = (delta: number, flush = true) => { act({ type: 'begin', delta }); act({ type: 'append-update' }); act({ type: 'append-commit' }); act({ type: 'apply' }); if (flush) act({ type: 'flush-wal' }); act({ type: 'ack' }) }
  const replay = () => { for (let i = 0; i < 8 && state().phase === 'recovering'; i++) act({ type: 'replay' }) }
  if (scenario === 'ack-loss') { transaction(1, c.acknowledgement === 'wal'); act({ type: 'crash' }); act({ type: 'restart' }); replay() }
  else if (scenario === 'uncommitted') { transaction(1); act({ type: 'begin', delta: 2 }); act({ type: 'append-update' }); act({ type: 'flush-wal' }); act({ type: 'crash' }); act({ type: 'restart' }); replay() }
  else if (scenario === 'checkpoint') { transaction(1); act({ type: 'checkpoint' }); transaction(2); act({ type: 'crash' }); act({ type: 'restart' }); replay() }
  else {
    act({ type: 'backup' }); transaction(1); transaction(2); act({ type: 'archive' })
    if (scenario === 'damaged-archive') { act({ type: 'archive' }); act({ type: 'corrupt', archive: 'archive-1', lsn: 2 }) }
    act({ type: 'lose-disk' }); act({ type: 'restore', backup: 'backup-1', archive: 'archive-1', target: scenario === 'point-in-time' ? 2 : 4 }); replay()
    if (scenario === 'damaged-archive') { act({ type: 'restore', backup: 'backup-1', archive: 'archive-2', target: 4 }); replay() }
  }
  return commands
}
export const lesson = createProtocolLesson({ id: exercise.id, initialConfig: defaultConfig, scenarios, maxCommands: MAX_COMMANDS, parseConfig, parseCommand, runModel,
  assess: (d, s) => {
    const missing = s.acknowledgements.filter((ack) => !s.applied.includes(ack.transaction))
    const expectedValue = ['checkpoint', 'damaged-archive'].includes(d.scenario) ? 3 : 1
    let window = false
    if (d.scenario === 'ack-loss') window = s.events.some((e) => e.kind === 'crash') && s.acknowledgements.length === 1
    if (d.scenario === 'uncommitted') window = s.events.some((e) => e.kind === 'uncommitted-skipped') && s.wal.some((r) => r.transaction === 'txn-2' && r.kind === 'update')
    if (d.scenario === 'checkpoint') window = s.recovery?.base.through === 2 && s.recovery.records.every((r) => r.lsn > 2)
    if (d.scenario === 'point-in-time') window = s.restoredTarget === 2 && s.acknowledgements.length === 2 && s.applied.join() === 'txn-1'
    if (d.scenario === 'damaged-archive') window = s.events.some((e) => e.kind === 'recovery-blocked') && s.restoredTarget === 4 && s.applied.length === 2
    const intentional = s.restoredTarget !== null && missing.every((ack) => ack.lsn > s.restoredTarget!)
    return { task: s.phase === 'online' && s.value === expectedValue && window && (!missing.length || intentional && d.scenario === 'point-in-time'), expected: { value: String(s.value ?? 'unavailable'), applied: String(s.applied.length), missing: String(missing.length), reason: 'durable-inputs' }, messages: [`当前状态 ${s.phase}，值 ${s.value ?? 'unavailable'}，已恢复 ${s.applied.length} 个事务；客户端曾确认但未恢复 ${missing.length} 个。`, s.restoredTarget !== null ? `本次明确选择恢复至 LSN ${s.restoredTarget}；目标之后的数据排除是恢复范围，不是 RPO=0。` : '普通进程恢复应保留已经承诺持久成功的事务；不能把内存 ACK 当作稳定存储。', '恢复只使用数据页、稳定日志或选中的备份/归档，不读取客户端确认清单来修补数据。没有 commit 的 redo 不应用，缺失或损坏的恢复范围不能静默跳过。', s.error || '数据页在对应 WAL 刷盘后才能检查点；本模型使用 redo-only 的本地串行事务，不实现完整数据库或物理磁盘。'] }
  },
})
