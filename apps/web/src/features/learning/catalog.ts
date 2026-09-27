import type { Concept, ConceptGroup, LearningPath } from './types'

export const conceptGroups: readonly ConceptGroup[] = [
  { id: 'failure', title: '故障与正确性', question: '我们知道发生了什么，怎样判断成功？' },
  { id: 'capacity', title: '容量、分布与过载', question: '工作为什么积压，压力落在哪里？' },
  { id: 'requests', title: '请求可靠性', question: '没有收到结果，重试会不会重复做事？' },
  { id: 'messaging', title: '消息与异步处理', question: '消息到了哪一步，重启后从哪里继续？' },
  { id: 'transactions', title: '事务与并发正确性', question: '没有机器故障，为什么状态仍会改错？' },
  { id: 'coordination', title: '故障检测与持有权', question: '谁还活着，谁现在有权写入？' },
  { id: 'replication', title: '复制、一致性与共识', question: '读到哪一版，哪些写入已经提交？' },
  { id: 'workflows', title: '跨服务可靠流程', question: '业务部分成功，怎样继续或纠正？' },
  { id: 'recovery', title: '持久性与数据恢复', question: '进程恢复了，数据也恢复了吗？' },
]

const concept = (id: string, groupId: string, title: string, aliases: string[], question: string, summary: string, prerequisiteIds: string[], capabilityIds: string[], labIds: string[] = [], caseIds: string[] = ['CASE-08']): Concept => ({ id, groupId, title, aliases, question, summary, prerequisiteIds, capabilityIds, labIds, caseIds })
export const concepts: readonly Concept[] = [
  concept('partial-failure', 'failure', '局部失败与结果未知', ['Partial failure', '网络分区', '暂停', '崩溃'], '没有响应，能断定对方没有执行吗？', '把观察到的超时与实际发生的故障分开。', [], ['REQ-01', 'COORD-01'], ['retry-idempotency']),
  concept('success-boundaries', 'failure', '成功边界与业务不变量', ['Safety', 'Liveness', '进展', '可观测性'], '请求被接收，等于业务完成了吗？', '明确接收、持久化、处理和可见性各自的含义。', ['partial-failure'], ['REQ-02', 'API-01', 'OPS-01'], ['retry-idempotency', 'concurrent-update', 'overload', 'two-phase-commit']),
  concept('capacity-and-queues', 'capacity', '容量、排队与瓶颈', ['Concurrency', '并发', 'Throughput', 'Latency', '吞吐'], '多加 API 副本，为什么延迟可能不变？', '从到达、处理与排队理解端到端瓶颈。', ['success-boundaries'], ['PERF-01', 'PERF-02'], ['service-queue-replicas', 'database-bottleneck', 'overload'], ['CASE-01', 'CASE-08']),
  concept('caching', 'capacity', '缓存、TTL 与淘汰', ['Cache', 'LRU', 'FIFO', '过期', '工作集'], '有了缓存，为什么仍然大量访问数据库？', '区分命中、冷启动、容量淘汰和失效。', ['capacity-and-queues'], ['SCALE-01', 'SCALE-02'], ['cache-pressure', 'hot-key'], ['CASE-01', 'CASE-04', 'CASE-08']),
  concept('consistent-hashing', 'capacity', '分片与一致性哈希', ['Sharding', 'Hash ring', 'Virtual nodes', '虚拟节点'], '增加节点时，哪些 key 需要换 owner？', '分别观察归属、重映射范围和键数均衡。', [], ['SCALE-03'], ['consistent-hashing'], ['CASE-01', 'CASE-06']),
  concept('hot-keys', 'capacity', 'Hot Key 与访问集中', ['Hotspot', '热点', '热分区'], 'key 很均匀，为什么请求仍集中？', '把键分布与访问频率分开统计，再选择策略。', ['consistent-hashing', 'caching'], ['SCALE-04'], ['hot-key'], ['CASE-01', 'CASE-02', 'CASE-08']),
  concept('overload-control', 'capacity', '过载保护与背压', ['Backpressure', 'Rate limiting', 'Circuit breaker', '限流', '熔断', '降级', '隔离'], '下游已经很慢，重试为何让情况更差？', '控制进入系统的工作量，并保护关键业务。', ['capacity-and-queues', 'timeouts-retries'], ['PERF-04', 'MSG-05', 'REL-03'], ['overload']),
  concept('timeouts-retries', 'requests', '超时、重试与预算', ['Timeout', 'Deadline', 'Retry', 'Backoff', 'Jitter', '取消'], '等待结束了，服务器是否也停止工作？', '用有限预算应对暂时失败，保留结果未知的状态。', ['partial-failure'], ['REL-01'], ['retry-idempotency', 'overload']),
  concept('idempotency', 'requests', '幂等与重复业务效果', ['Idempotency', 'Deduplication', '幂等键', '去重'], '任务创建成功却丢了响应，怎样安全重试？', '给同一业务意图稳定身份，并原子保护效果。', ['timeouts-retries', 'transactions'], ['REL-02'], ['retry-idempotency', 'concurrent-update']),
  concept('acknowledgements', 'messaging', 'ACK 与消息确认', ['Acknowledgement', 'Publisher confirm', 'at least once', 'at most once', 'exactly once', '重投'], '谁在向谁确认哪一阶段？', '发布确认、消费确认与业务完成是不同边界。', ['success-boundaries', 'idempotency'], ['MSG-01', 'MSG-02'], ['ack-checkpoint','transactional-outbox']),
  concept('message-ordering', 'messaging', '消息顺序与版本', ['Ordering', 'Partition', 'Consumer group', '乱序', '消费组'], '完成事件先到，处理中事件后到，怎么办？', '去重不能保证不同事件的顺序或状态合法性。', ['acknowledgements', 'concurrency-control'], ['MSG-03'], ['ack-checkpoint'], ['CASE-06', 'CASE-08']),
  concept('checkpoints', 'messaging', 'Checkpoint、Offset 与重放', ['检查点', '进度', 'Replay', '恢复'], 'Worker 重启后，什么可以跳过，什么需要重做？', '把已完成的效果与已保存的进度对齐。', ['acknowledgements', 'transactions'], ['OPS-05', 'MSG-03'], ['ack-checkpoint','transactional-outbox']),
  concept('dead-letter', 'messaging', '永久失败与死信处理', ['DLQ', 'Poison message', '毒消息', 'Reconciliation'], '同一条消息总失败，还应该一直重试吗？', '分类失败、隔离坏工作，并保留可审计的修复路径。', ['timeouts-retries', 'acknowledgements'], ['MSG-05', 'OPS-05'], ['ack-checkpoint']),
  concept('transactions', 'transactions', '本地事务与 ACID', ['Atomicity', 'Consistency', 'Isolation', 'Durability', '原子提交'], '两项必须一起成功的写入，中间失败了怎么办？', '事务把一组本地修改放在声明的提交边界内。', ['success-boundaries'], ['DATA-04'], ['retry-idempotency', 'concurrent-update'], ['CASE-07', 'CASE-08']),
  concept('concurrency-control', 'transactions', '并发冲突与条件更新', ['CAS', 'Isolation levels', '乐观锁', '悲观锁', '丢失更新', '隔离级别'], '两个不同任务同时争抢最后一个名额，会怎样？', '保护并发状态变化，而不只去重相同请求。', ['transactions'], ['DATA-05'], ['concurrent-update'], ['CASE-07', 'CASE-08']),
  concept('heartbeat', 'coordination', 'Heartbeat 与故障怀疑', ['心跳', 'Failure detection', '误判', '服务发现', 'Gossip'], '缺少心跳，等于节点已经死亡吗？', '故障检测提供怀疑，不提供对远端状态的全知。', ['partial-failure'], ['COORD-01', 'COORD-06'], ['heartbeat']),
  concept('leases-locks', 'coordination', 'Lease 与分布式锁', ['租约', 'Distributed lock', '时钟', '脑裂'], '锁过期了，旧持有者会自动停止吗？', '区分有限期的持有权与仍可能执行的旧进程。', ['heartbeat', 'concurrency-control'], ['COORD-02', 'COORD-05'], ['lease-fencing']),
  concept('fencing', 'coordination', 'Fencing 与过时写入', ['Fencing token', '世代号', '旧持有者'], '新 Worker 接管后，如何挡住迟到的旧写入？', '在受保护的资源端核验写入者的世代。', ['leases-locks'], ['COORD-02'], ['lease-fencing']),
  concept('replication-consistency', 'replication', '复制、旧读与一致性', ['Strong consistency', 'Eventual consistency', 'Read your writes', 'CAP', '强一致性', '最终一致性', '线性一致性'], '写入成功后，为何另一处仍读到旧值？', '先声明读写保证，再选择副本和缓存策略。', ['success-boundaries', 'transactions'], ['CONS-01', 'CONS-02'], ['replica-consistency', 'quorum-reads'], ['CASE-06', 'CASE-08']),
  concept('consensus', 'replication', 'Quorum、Leader 与共识', ['Raft', 'Election', '日志复制', '多数派', '提交'], '协调者也会失败，谁来确定唯一提交历史？', '区分多数派交集、选举规则与日志提交规则。', ['heartbeat', 'replication-consistency'], ['CONS-03', 'COORD-03', 'COORD-04'], ['quorum-reads', 'raft-consensus']),
  concept('transactional-outbox', 'workflows', 'Transactional Outbox', ['事务发件箱', '双写', '发布意图'], '数据库提交了，通知事件却没有发出去？', '把业务修改与发送意图一起提交，再可靠地发送。', ['transactions', 'acknowledgements'], ['MSG-04'], ['transactional-outbox'], ['CASE-02', 'CASE-08']),
  concept('sagas', 'workflows', 'Saga 与 Compensation', ['补偿', '工作流', '部分成功'], '多步业务部分成功后，怎样继续或纠正？', '通过本地步骤、进度和业务补偿管理失败。', ['transactional-outbox', 'checkpoints'], ['CONS-04', 'OPS-05'], ['saga-recovery'], ['CASE-07', 'CASE-08']),
  concept('two-phase-commit', 'workflows', '两阶段提交与阻塞', ['2PC', 'Prepare', '原子提交', '协调者'], '多个参与者必须共同提交，该怎样做？', '理解准备、决议和故障期间等待的代价。', ['transactions', 'partial-failure'], ['CONS-04'], ['two-phase-commit'], ['CASE-07']),
  concept('durability-recovery', 'recovery', '持久性、备份与数据恢复', ['WAL', 'Snapshot', 'RPO', 'RTO', 'Checkpoint', '日志重放', '灾备'], '机器重新启动，是否就恢复了已经确认的数据？', '声明保存了什么，再验证恢复得到什么。', ['transactions', 'checkpoints', 'replication-consistency'], ['DATA-06', 'REL-04', 'REL-05'], ['durability-recovery'], ['CASE-03', 'CASE-08']),
]

export const caseContexts = [
  { id: 'CASE-01', title: '短链接', question: '热门短码如何读取，何时访问缓存与数据库？' },
  { id: 'CASE-02', title: 'News Feed', question: '内容发布、事件传播与热门内容读取如何配合？' },
  { id: 'CASE-03', title: '对象存储', question: '确认保存的对象怎样在故障后恢复？' },
  { id: 'CASE-04', title: '地图与附近查询', question: '空间索引或道路缓存过期后，查询还正确吗？' },
  { id: 'CASE-06', title: 'Chat', question: '怎样处理消息重发、顺序与读取旧状态？' },
  { id: 'CASE-07', title: '订单流程', question: '重复提交、并发预留与部分成功怎样处理？' },
  { id: 'CASE-08', title: '视频发布', question: '提交、转码与发布之间发生故障，怎样恢复？' },
] as const

/** Only unimplemented candidates belong here; runnable links derive from Concept.labIds. */
export const plannedLabs: readonly { id: string; title: string; conceptIds: readonly string[] }[] = []

export const learningPaths: readonly LearningPath[] = [
  { id: 'failure-recovery', title: '故障与恢复', description: '用视频任务串起结果未知、消息重投、持有权与补偿。六个故障恢复 Lab 已可操作：超时与幂等、ACK/Checkpoint、Outbox、Heartbeat、Lease/Fencing 与 Saga。', steps: [
    { question: '没有响应，任务创建了吗？', conceptIds: ['partial-failure', 'success-boundaries', 'timeouts-retries', 'transactions', 'idempotency'] },
    { question: 'Worker 崩溃，从哪里继续？', conceptIds: ['acknowledgements', 'checkpoints', 'dead-letter'] },
    { question: '任务保存了，事件没发出去？', conceptIds: ['transactional-outbox'] },
    { question: '没有心跳，节点已经死了吗？', conceptIds: ['heartbeat'] },
    { question: '旧持有者回来写入，怎么办？', conceptIds: ['leases-locks', 'fencing'] },
    { question: '流程部分成功，怎样收场？', conceptIds: ['sagas'] },
  ] },
  { id: 'capacity-distribution', title: '容量、分布与热点', description: '从排队、热点到过载，六个 Lab 验证各自声明的机制。', steps: [
    { question: '工作为什么积压？', conceptIds: ['capacity-and-queues'] },
    { question: '缓存减少了哪些访问？', conceptIds: ['caching'] },
    { question: '节点变化时，key 怎样分配？', conceptIds: ['consistent-hashing'] },
    { question: '数据均匀，访问也均匀吗？', conceptIds: ['hot-keys', 'overload-control'] },
  ] },
  { id: 'state-correctness', title: '状态正确性与恢复', description: '从并发交错走到副本旧读、Quorum、Raft、两阶段提交和持久恢复，均有独立可操作 Lab。', steps: [
    { question: '什么必须一起成功？', conceptIds: ['transactions', 'concurrency-control'] },
    { question: '顺序与读取版本有什么不同？', conceptIds: ['message-ordering', 'replication-consistency'] },
    { question: '谁来确定提交的历史？', conceptIds: ['consensus', 'two-phase-commit'] },
    { question: '已确认的数据怎样恢复？', conceptIds: ['durability-recovery'] },
  ] },
]

export const getConcept = (id: string) => concepts.find((item) => item.id === id)
export const conceptsForLab = (labId: string) => concepts.filter((item) => item.labIds.includes(labId))
export function filterConcepts(query: string, groupId = '', pathId = '') {
  const terms = query.trim().normalize('NFKC').toLocaleLowerCase('en-US').split(/\s+/).filter(Boolean)
  const path = learningPaths.find((item) => item.id === pathId)
  const pathIds = path ? new Set(path.steps.flatMap((step) => step.conceptIds)) : null
  return concepts.filter((item) => (!groupId || item.groupId === groupId) && (!pathIds || pathIds.has(item.id)) && terms.every((term) => [item.title, item.question, item.summary, ...item.aliases].join(' ').normalize('NFKC').toLocaleLowerCase('en-US').includes(term)))
}
