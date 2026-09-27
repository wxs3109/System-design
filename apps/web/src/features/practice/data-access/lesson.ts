import { createProtocolLesson } from '../../../core/experiments/protocol-lesson'
import { defaultConfig, MAX_COMMANDS, parseCommand, parseConfig, runModel, type Command, type QueryResult } from './model'
export const exercise = { id: 'data-access-paths', kind: 'algorithm' as const, version: 1, title: '同一批数据，为什么查询成本和结果不同？', category: '基础设计决策', difficulty: '基础', estimatedMinutes: 25, summary: '实际扫描记录、按主键读取或走用户/时间索引，比较读取字节、索引维护和更新后的完整性。', flow: ['声明访问模式','选择访问路径','更新与查询','核对结果和代价'] }
export const scenarios = { point: '按 ID 点查', range: '按用户和时间列出', maintenance: '更新后的索引', payload: '只需要元数据', manual: '自由查询' }
export function script(scenario: string): Command[] {
  if (scenario === 'point') return [{type:'point',id:'r07'}]
  if (scenario === 'maintenance') return [{type:'range',owner:'u2'},{type:'move',id:'r05',owner:'u2',time:7},{type:'range',owner:'u2'},{type:'refresh'},{type:'range',owner:'u2'}]
  return scenario === 'manual' ? [] : [{type:'range',owner:'u1'}]
}
/** Independent enumeration of the canonical snapshot, not of index candidates. */
export function reference(q: QueryResult) { return q.source.filter(row => q.command.type === 'point' ? row.id === q.command.id : row.owner === q.command.owner).sort((a,b) => a.time - b.time || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) }
export const correct = (q: QueryResult) => JSON.stringify(q.rows) === JSON.stringify(reference(q))
export const lesson = createProtocolLesson({ id: exercise.id, versions: { model: 'data-access-v1', definition: 1, assessment: 1 }, initialConfig: defaultConfig, scenarios, maxCommands: MAX_COMMANDS, parseConfig, parseCommand, runModel,
  assess: (d,s) => {
    const last = s.queries.at(-1); const complete = s.queries.length > 0 && s.queries.every(correct)
    const fixed = d.scenario !== 'manual' && JSON.stringify(d.commands) === JSON.stringify(script(d.scenario))
    const work = !!last && last.rowsExamined <= (d.scenario === 'point' ? 1 : 5)
    const task = fixed && complete && work && (d.scenario !== 'payload' || last!.bytesRead < 1000)
    return { task, expected: { rows: String(last?.rows.length ?? 0), examined: String(last?.rowsExamined ?? 0), wrong: String(s.queries.filter(q => !correct(q)).length), reason: 'access-and-maintenance' }, messages: [`末次查询返回 ${last?.rows.length ?? 0} 条，读取 ${last?.rowsExamined ?? 0} 条、${last?.bytesRead ?? 0} bytes；历史错误查询 ${s.queries.filter(q => !correct(q)).length} 次。`, `二级索引累计写入 ${s.indexWrites} 条、移除 ${s.indexRemovals} 条；初建与刷新也计入。`, complete ? '每次查询均与当时的权威记录枚举结果一致。' : '索引或路径没有返回完整正确结果；最后修好不会抹掉之前的错误查询。', fixed ? '保持原查询和更新要求。' : '需要完成本关原访问脚本，不能缩小结果范围通过。', '按实际访问形状选择路径；主键点查不能替代用户范围索引。字节按教学 JSON 布局计算，不是数据库厂商性能。'] }
  },
})
