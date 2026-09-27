import type { Concept, LearningPath } from './types'

export const foundationConcepts: readonly Concept[] = [
  { id: 'quality-goals', groupId: 'foundations', title: '把可靠、可用和持久变成明确目标', aliases: ['Reliability', 'Availability', 'Durability', 'Scalability', 'Maintainability', 'SLI', 'SLO', '可靠性', '可用性', '持久性'], question: '返回成功，是否就满足了用户的要求？', summary: '先声明成功条件和故障范围，再选择副本、持久化和降级策略。', prerequisiteIds: [], capabilityIds: ['REQ-01', 'REQ-02', 'REL-03', 'REL-04'], labIds: ['quality-goals'], caseIds: [] },
  { id: 'resource-constraints', groupId: 'foundations', title: '计算、存储和网络的基本限制', aliases: ['CPU', 'Memory', 'IOPS', 'Bandwidth', 'Latency', 'RTT', '带宽', '资源争用'], question: '系统变慢时，究竟是哪一种资源不够？', summary: '区分计算、等待、传输与排队，用证据找到约束。', prerequisiteIds: ['quality-goals'], capabilityIds: ['PERF-01', 'PERF-02', 'NET-02', 'NET-03'], labIds: ['resource-budget', 'service-queue-replicas', 'database-bottleneck', 'overload'], caseIds: [] },
  { id: 'capacity-estimation', groupId: 'foundations', title: '从用户规模推导流量和资源需求', aliases: ['QPS', 'RPS', 'Concurrency', 'Little law', 'Capacity estimation', '容量估算', '峰值', '存储增长'], question: '十万用户，意味着多少请求、并发和存储？', summary: '让单位、时间窗口、读写比例和放大来源都能追溯。', prerequisiteIds: ['resource-constraints'], capabilityIds: ['REQ-03', 'PERF-05'], labIds: ['resource-budget', 'service-queue-replicas', 'database-bottleneck'], caseIds: [] },
  { id: 'storage-access-patterns', groupId: 'foundations', title: '从访问模式选择数据模型与存储', aliases: ['Database selection', 'SQL', 'NoSQL', 'Key value', 'Document', 'Index', '数据库选型', '关系型', '文档', '对象存储', '索引'], question: '数据要怎样读取和修改，才决定该用什么存储？', summary: '从查询、更新和事务边界出发，比较模型及索引的维护代价。', prerequisiteIds: ['quality-goals'], capabilityIds: ['API-02', 'DATA-01', 'DATA-04', 'DATA-07'], labIds: ['database-bottleneck', 'concurrent-update'], caseIds: [] },
  { id: 'state-and-scaling', groupId: 'foundations', title: '状态放在哪里，决定怎样扩展', aliases: ['Stateless', 'Stateful', 'Replication', 'Partitioning', 'Horizontal scaling', 'Vertical scaling', '无状态', '有状态', '横向扩展', '纵向扩展', '复制', '分片'], question: '把一台服务变成两台，哪些状态和故障问题会出现？', summary: '区分服务实例、数据所有权、副本和分片，检查扩容后的依赖与故障域。', prerequisiteIds: ['quality-goals', 'storage-access-patterns'], capabilityIds: ['API-05', 'SCALE-03', 'SCALE-05', 'NET-01', 'REL-04'], labIds: ['quality-goals', 'consistent-hashing', 'replica-consistency'], caseIds: [] },
]

export const foundationPath: LearningPath = {
  id: 'design-foundations', title: '基础设计决策', description: '先理解目标、资源、规模、数据和状态，再用已有实验验证缓存、异步、并发与故障恢复。',
  steps: [
    { question: '先定义什么才算成功', conceptIds: ['quality-goals'] },
    { question: '识别资源限制并估算需求', conceptIds: ['resource-constraints', 'capacity-estimation', 'capacity-and-queues'] },
    { question: '决定数据怎样组织和访问', conceptIds: ['storage-access-patterns', 'transactions'] },
    { question: '确认状态归属，再讨论扩展', conceptIds: ['state-and-scaling', 'consistent-hashing', 'replication-consistency'] },
    { question: '选择缓存并解释新鲜度代价', conceptIds: ['caching', 'hot-keys'] },
    { question: '选择异步边界并控制积压', conceptIds: ['success-boundaries', 'acknowledgements', 'overload-control'] },
    { question: '保护并发效果并验证恢复', conceptIds: ['concurrency-control', 'idempotency', 'durability-recovery'] },
  ],
}
