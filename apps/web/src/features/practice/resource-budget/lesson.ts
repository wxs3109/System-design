import { createProtocolLesson } from '../../../core/experiments/protocol-lesson'
import { defaultConfig, derive, MAX_COMMANDS, parseCommand, parseConfig, runModel, type Command, type Config } from './model'
export const exercise = { id: 'resource-budget', kind: 'algorithm' as const, version: 1, title: '用户数怎样变成请求、字节和排队？', category: '基础设计决策', difficulty: '入门', estimatedMinutes: 25, summary: '逐项推导平均/峰值需求，再让同一批请求经过计算、存储和共享网络，检查增加哪种资源才有效。', flow: ['核对单位', '推导需求', '运行有限样本', '定位排队'] }
export const scenarios = { units: '单位与长期需求', network: '大响应的网络瓶颈', storage: '共享存储的瓶颈', manual: '自由估算' }
export const scenarioConfig = (scenario: string): Config => scenario === 'storage' ? { ...defaultConfig(), users: 17280, responseBytes: 100000, bandwidthMbps: 80 } : defaultConfig()
export const script: Command[] = [{ type: 'derive' }, { type: 'sample' }]
export const format = (value: number) => String(Number(value.toFixed(3)))
export const lesson = createProtocolLesson({ id: exercise.id, versions: { model: 'resource-budget-v1', definition: 1, assessment: 1 }, initialConfig: defaultConfig, scenarios, maxCommands: MAX_COMMANDS, parseConfig, parseCommand, runModel,
  assess: (d, s) => {
    const expected = scenarioConfig(d.scenario); const demandKeys = ['users', 'requestsPerDay', 'peakFactor', 'readPercent', 'responseBytes', 'retentionDays', 'copies'] as const
    const fixed = demandKeys.every(key => d.config[key] === expected[key]) && JSON.stringify(d.commands) === JSON.stringify(script)
    const estimate = derive(d.config); const bounded = s.requests.length === estimate.peakRps * 5 && s.latencyP95Ms !== null
    const task = fixed && !!s.estimate && bounded && (d.scenario === 'units' || s.latencyP95Ms! <= (d.scenario === 'network' ? 500 : 250))
    return { task, expected: { average: format(estimate.averageRps), peak: format(estimate.peakRps), logical: format(estimate.logicalBytes / 1000000), physical: format(estimate.copiedBytes / 1000000), reason: 'work-and-boundaries' }, messages: [`全天平均 ${format(estimate.averageRps)} 请求/s，声明峰值 ${format(estimate.peakRps)} 请求/s；逻辑数据 ${format(estimate.logicalBytes / 1000000)} MB，完整副本 ${format(estimate.copiedBytes / 1000000)} MB。`, `${s.requests.length} 个请求全部有完成时刻；其中 ${s.completedInWindow} 个在 5 秒到达窗口内完成。p95 ${s.latencyP95Ms === null ? '尚未观察' : format(s.latencyP95Ms)} ms，停流后排空不能说明到达期间无积压。`, fixed ? '保持了本关原始需求和操作。' : '本关不能通过降低请求量、响应大小或保留期来通过。', '独立计算槽、固定 100 ms 存储访问和单 FIFO 响应链路是教学假设；不把槽数解释成真实 CPU 核数或数据库连接性能。'] }
  },
})
