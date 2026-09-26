# 数据分布与 Hot Key Lab 实施计划

> 状态：第一、第二里程碑 DIST-01 至 DIST-05 均已完成并通过验收。更新于 2026-09-20。对应[学习能力矩阵](./learning-capability-matrix.md)的 SCALE-03、SCALE-04，复用 SCALE-01 的部分缓存知识。

## 1. 交付目标与顺序

用户先预测一次成员变化的影响，操作取模、哈希环和虚拟节点，检查键归属及需要重映射的比例；再对同一键集合增加热点读取，区分数据均衡和请求集中，最后比较一个范围明确的读缓存策略。

每个实验同时说明其与缓存集群、短链接、Feed、聊天和视频读取的关系。结果由算法和有限请求序列计算；不用固定动画或预置成功数字代替证据。

| 部分 | 交付件 | 依赖 | 状态 |
|---|---|---|---|
| DIST-01 | 确定性分配模型、输入/结果合同、比较指标和测试向量 | 当前工程基础 | 已完成 |
| DIST-02 | 哈希 Lab 页面、目录接入、编辑/撤销、独立保存和前后比较 | DIST-01 | 已完成 |
| DIST-03 | 引导挑战、证据评分、迁移题及经典案例关联；发布第一题 | DIST-02 | 已完成 |
| DIST-04 | Hot Key 请求序列、键数/请求数并列视图及热点挑战 | DIST-03 | 已完成 |
| DIST-05 | 有限只读缓存对照、后端读取证据及第二题验收 | DIST-04 | 已完成 |

**第一里程碑只包含 DIST-01 至 DIST-03：一题完整的一致性哈希 Lab。** 第二里程碑为 DIST-04、DIST-05：Hot Key 只读分布实验。两题验证后，再按[短链接候选计划](./practice-design-exercises.md)进入自由搭建的综合题；本计划不包含该综合题实现。

## 2. 本期模型边界

- SCALE-03 本期比较取模、单 token 环、多虚拟节点环。Rendezvous 留作后续算法对照，不作为首题验收前置。
- 一 key 只有一个物理 owner；成员具有相同的声明权重。本期不包含副本放置、异构权重或业务键拆分。
- “需要重映射”表示目标 owner 改变。没有复制、增量写、切流过程，因此不报告“已迁移”、迁移耗时或迁移期间可用性；这些属于 SCALE-06。
- Hot Key 本期验证请求集中度与缓存后的后端读取次数，不输出每 shard 队列、吞吐上限、CPU、p95 或生产容量。现有 DB 使用聚合资源，不能作为独立热 shard 饱和的证据。
- 缓存版本限定固定只读值、成功源读取、顺序处理与显式填充时点；不验证写热点、更新一致性、并发 miss 合并或真实缓存服务。
- 算法状态可以在浏览器内执行，不需要部署服务或改造仿真组件。当前行为边界仍以[模型说明](../model-assumptions.md)为准。

## 3. DIST-01：分配模型与证据 spec

### 输入与确定性

拟定模型版本 `distribution-v1`。默认 4 个物理节点、1,024 个唯一 key；允许 1–12 个节点和 256/1,024/4,096 个 key。多虚拟节点页面提供每物理节点 8/32/128 个 token；模型也接受 V=1，以验证与单 token 环的等价性。它们是教学与渲染预算，不代表生产推荐。

- 使用显式、不可变且非空的 ASCII `nodeId`，按 ASCII 码元排序；添加节点分配新 ID，删除其他节点不重新编号。显示名称、选中、缩放和布局不参与分配。
- 数据集由独立的 `datasetSeed` 与生成器版本产生；初版可用 seed 前缀与递增索引生成唯一字符串。成员和算法变更不重新生成 key；保存实际 key 集合以便复查。
- 分配采用版本化 `hashV1`：MurmurHash3 x86_32，UTF-8 字节、little-endian 块解释、内部 seed 固定为 0，结果按无符号 32 位整数处理。以[参考实现](https://github.com/aappleby/smhasher/blob/master/src/MurmurHash3.cpp)和独立测试向量核对，记录来源和所用版本；不混用同名的其他位宽/平台变体。
- 输入域分别使用 `["key", keyId]` 和 `["token", nodeId, vnodeIndex]`，按 ECMAScript `JSON.stringify` 的紧凑数组格式（无额外空白）序列化，再编码为 UTF-8；字符串不做 Unicode 归一化，vnodeIndex 是非负整数。该字节合同属于模型版本，比较和排序不得依赖当前 locale、对象遍历顺序或 UI 顺序。
- 现有[取模与 rendezvous 代码](../../packages/simulation/src/components/data-state.ts)只作为已有行为参考。本题独立固定哈希语义，不改变其算法或旧项目的复现结果，也不深层导入私有函数。

### 分配规则

| 方法 | owner 规则 | 必须处理的边界 |
|---|---|---|
| 取模 | 将物理 nodeId 按固定 ASCII 顺序排列，以 `hash(key) mod N` 选择槽位 | 删除中间成员会重建槽位数组，但不改变剩余节点身份；UI 排序不改变结果 |
| 单 token 环 | 每物理节点使用 index=0 的 token；选择首个位置大于等于 key hash 的 token，越界回到首个 | key 恰好落在 token 上、首尾回绕和只有一个节点 |
| 虚拟节点环 | 每物理节点使用 index=0 至 V-1 的 token；按相同环规则选择，再归并到物理 owner | V=1 的模型测试须与单 token 环完全相同；增节点不能重算其他节点位置 |

Token 按 `(hash, nodeId, vnodeIndex)` 排成全序；同 hash 位置保留全部 token，选择该位置排序最前者，不覆盖或随机丢弃。不同 key 的 hash 碰撞仍是不同记录。模型拒绝空成员集、重复 nodeId/keyId、非法数量和未知版本；页面禁止删除最后一个节点，非法载入不能产生通过结果。

### 结果与比较合同

输入包含算法、完整成员/key 集合、虚拟节点配置和模型版本。结果包含逐 key owner、token、每物理节点 key 数、均衡指标，以及与基线的转移表。所有输出均由完整输入重新计算；图形抽样不改变统计分母。

| 指标 | 定义与展示规则 |
|---|---|
| 节点 key 数 | 对完整 key 集合按物理 owner 计数，含 0 个 key 的节点；总和等于 K |
| 最大份额 | `max(nodeKeyCount) / K`，同时展示最小值和平均值 `K / N` |
| 相对平均负载 | `max(nodeKeyCount) / (K / N)`；明确这是键数比例，不是 CPU 利用率 |
| 需要重映射数/比例 | 同一 key 在前后快照的物理 owner 不同的数量，分母固定为 K |
| 转移表 | 按旧 owner → 新 owner 计数，含未变化项；总和仍为 K，可展开具体 key |

比较分为三种受控实验：成员变化时保持算法/V/key 集合；算法变化时保持成员/key 集合；V 变化时保持成员与多节点环规则/key 集合。联合改变多个条件可作为探索记录，但不能按单一原因解释；key 集合、hash 或模型版本不同则不提供重映射对照。

### 模型验收

- 同一规范输入在不同对象/成员呈现顺序下输出相同；重命名或缩放视图不变，成员增删才改变相应语义。
- 独立小型参考计算核对三种方法；注入碰撞的测试 hash 验证 tie-break、回绕和精确命中，不能只让实现和评分器互相确认。
- 同算法与 token 参数下，环新增一个节点时，发生变化的 key 只能转到该新节点；移除节点时，其他 owner 的 key 不应换归属。多 token 统计必须落到物理节点。
- 加节点再移除该节点可恢复原始映射；取模不要求满足环的局部重映射性质。
- 不规定环必定比取模更均衡、V 越大每个样本必定越均衡，或本次迁移比例恰好等于 `1/(N+1)`。有限 key 集结果是精确计数；理论期望需另列分布假设。

## 4. DIST-02：界面、集成与保存 spec

拟定入口 `/practice/consistent-hashing`，题目 ID `consistent-hashing`，初始题目版本 1。沿用现有练习目录的题干、提示、反馈和历史体验，增加哈希环/槽位分布视图，不嵌入一份伪造的基础设施拓扑。

| 用户操作 | 可见结果与约束 |
|---|---|
| 切换方法、添加/移除指定节点、调整 V | 当前配置预览明确更新；已保存的运行证据保持不可变，新配置显示需要重新验证 |
| 选择某个 key 或节点 | 高亮其 hash、token、物理归属与前后变化；表格提供等价键盘操作 |
| 固定基线，运行候选 | 同屏显示完整统计、成员变化和转移表；不能把预览当成已提交的实验 |
| 换数据集或 seed | 明确开始另一组实验，旧比较失效；不把不同数据集的差异归因于算法 |
| 撤销/重做、重置 | 恢复配置与基线选择；重置当前设计不静默删除历史，历史另行保留 |
| 刷新、离开后返回 | 恢复当前输入、基线和尝试；只在语义快照相符时恢复当前结论 |

最多只把选中 key 和有界抽样画在环上，其余用聚合/虚拟化表格查看；标明图形抽样与全量统计的区别。提供窄屏布局、可读状态文本和非颜色提示。环位置由 hash 决定，平移/缩放只是展示操作。

集成规则：

- 在 practice 目录层引入薄的 `simulation` / `algorithm` 入口区分，保留现有 [ExerciseDefinition](../../apps/web/src/features/practice/exercise-types.ts)、题目 ID/version、ProjectFile 和 SimulationResult 的含义。
- 算法题使用自己的版本化 Input/Result/Attempt 合同；不调用 WorkbenchSession 来包装假运行，也不创建新的通用课程引擎或 workspace package。
- 纯分配/指标函数、题目判据、视图和 repository 分开维护在 practice 功能范围。若最大输入下计算阻塞交互，再复用 Worker 通信的做法；结果按 revision 匹配，取消/旧响应不能覆盖新输入。
- 新增算法题专用 IndexedDB repository，使用独立数据库与按题目版本划分的 scope；不修改或清空原 LocalHistory 的表、主键和活动指针。
- Attempt 保存题目/模型版本、规范输入、key 集、基线/候选、操作序列、结果、预测/复盘及时间。历史不可变，重算失败或未知版本显示不可验证；数据库写入失败须显示“未保存”，保留本次内存结果。
- 撤销栈只要求当前挂载会话有效，刷新不恢复整条撤销栈；当前输入与尝试必须持久恢复。展示状态与语义输入分离，不能通过改名影响 key 归属。

验收覆盖最大输入下的完整计算与可用界面、快速连改后的旧结果拒绝、刷新恢复、独立撤销、存储失败，以及原三道练习与自由工作台记录不被覆盖。首轮不新增自动播放、跨设备同步、共享链接或完整案例播放器。

## 5. DIST-03：引导、评分与案例关联 spec

第一题按四步组织：

1. **预测**：固定 key 和成员，选择新增节点后可能发生的归属变化，并保存预测。预测允许出错，不要求用户先猜中才能运行。
2. **观察与比较**：对取模、单 token 环、多 token 环分别保存同成员起点与新增同一节点的终点，再比较各自的重映射结果；选择实际发生变化的 key 查看依据，不能直接把不同方法的终点当成同一次成员变化。
3. **解释**：用结果中的节点、key 和计数回答“迁移范围与均衡性是否是同一个目标”。结构化题按可计算事实反馈，自由说明保留为复盘，不自动宣称理解正确。
4. **迁移挑战**：使用另一组固定 seed 或成员规模完成一次移除节点任务；不能复用前一题的数字或结果快照。

评分分开呈现“运行证据有效”“本次任务完成”“解释/迁移表现”。任务通过要求完整合规输入、实际执行指定变化及对证据的正确识别；初始预测错不等于最终没掌握，点击到某个 V 值也不等于通过。探索模式允许任意合规输入，指导题锁定其 key 集与允许操作。

### 经典案例如何关联

| 应用背景 | 本系列能迁移的设计问题 | 后续边界与资料 |
|---|---|---|
| 缓存集群 | 扩容时哪些 key 换 owner，冷缓存可能影响哪些访问 | 本期不算搬迁/预热耗时；[分布式缓存资料](../knowledge-base/06-case-design/01-common-basic-system/03-distributed-cache/README.md) |
| CASE-01 短链接 | 短码分布与热门链接读取是否产生不同压力 | 实际服务/缓存/DB 路径另做[综合题](./practice-design-exercises.md)；[知识资料](../knowledge-base/06-case-design/02-specific-application-system/01-url-shortener/README.md) |
| CASE-02 News Feed | 用户/内容分片与热门内容的读热点 | Celebrity 写扩散属于 RT-03，不能视为单热 key 的同一问题；[知识资料](../knowledge-base/06-case-design/02-specific-application-system/03-news-feed/README.md) |
| CASE-06 Chat | 会话分片与热门群读取的集中度 | 本期不保证消息顺序、交付、presence 或连接迁移；[知识资料](../knowledge-base/06-case-design/02-specific-application-system/04-chat-system/README.md) |
| CASE-08 Video | 视频对象/分片的键分布与热门资源读取 | 对象大小、播放会话、CDN 和共享带宽另建实验；[知识资料](../knowledge-base/06-case-design/02-specific-application-system/05-video-streaming/README.md) |

页面用简短案例卡展示应用问题、关联能力和“背景说明/候选案例”状态。只有存在可运行路由时提供“开始实验”；不创建空壳案例页，不把仓库 Markdown 相对路径当成已发布的网站路由。资料引用先由本文维护。

**第一里程碑出口**：从目录进入 → 完成预测与实验 → 查看可追溯变化 → 完成第二组迁移任务 → 刷新恢复；模型检查和浏览器流程通过，并运行完整 `pnpm check`。原三题继续保留原行为。本期上线后只更新 SCALE-03 的已覆盖子目标。

## 6. DIST-04：Hot Key 分布 spec

拟定入口 `/practice/hot-key`，题目 ID `hot-key`，初始题目版本 1。复用分配模型和视图，另建版本化只读 workload，不使用虚假的 SimulationResult。

- 默认生成 10,000 次读取，可选 1,000/10,000/20,000；请求 ID、key、逻辑时间与采样序列均可追溯。逻辑时间使用等间隔时刻，只用于顺序/TTL，不表示实测到达能力。
- `uniform` 在全部 key 中均匀抽样；`hotspot` 指定一个现有 key，选择概率为 20%/80%/95%，剩余概率均匀分给其他 key。UI 分别展示目标概率与这次实际比例。
- 固定并版本化采样器及 workloadSeed，成员/算法/V 改变时复用同一份完整请求序列，不能因 UI 操作消耗其他随机数。保存生成器版本和已生成序列，不能只保存一个可能被新实现重新解释的 seed。
- 初版固定 `hot-key-v1` / `reads-v1` / `murmur-counter-v1`：第 i 条请求的 gate 与 choice 分别为 `hashV1(JSON.stringify(["read-v1", seed, i, "gate"]))` 与 `hashV1(JSON.stringify(["read-v1", seed, i, "choice"]))`。两个无符号 32 位整数分别除以 `2^32`；uniform 以 choice 选择完整有序 key 集，hotspot 在 gate 小于目标概率时选择 hot key，否则以 choice 选择移除 hot key 后的有序集合。选择下标用 `floor(choice / 2^32 * populationSize)`。这是固定的伪随机采样规则，实际份额必须通过计数展示。
- 请求从 i=0 开始，ID 为 `read-` 加五位补零编号，逻辑时刻为 i ms；记录原始 gate/choice、实际 key 与时刻。载入或保存运行证据时会按声明版本重算并核对完整序列。
- 比较不同热点概率属于改变工作负载，固定总请求数、逻辑时刻与底层随机样本，并标明“负载变化”；比较分片/缓存策略则必须复用实际的同一请求序列。
- 并列展示节点 key 数、每 key 请求数、物理 owner 请求数、最大请求份额和 key 数份额；请求总计必须与输入一致。新增 V 可以改变分布，但一个 key 的每次读取仍指向一个 owner。

验收要求：同一组 key 可能分布均匀而请求集中；改变热点不改变 key 归属，改变节点不改变输入请求；多 V 不得把单个 hot key 偷偷复制到多个节点。对实际序列的统计与独立逐条计数一致，抽样波动不能被当成概率配置失效。反馈使用“请求集中”，不使用缺乏资源模型支撑的“该分片已经饱和”。

## 7. DIST-05：只读缓存对照 spec

在同一 Hot Key Lab 中增加“无缓存 / 路由前的共享只读缓存”对照。缓存不改变 key 所属分片，只减少继续访问 owner 的读取次数；不是把缓存作为新增分片。

- 每次实验从空缓存开始，LRU 按条目计量；容量可选 16/64/256，TTL 可选 100/1,000/60,000 个逻辑毫秒。各请求逻辑时刻递增 1 ms，逻辑时间与统计边界明确展示。
- 固定 `expiresAt = filledAt + TTL`，`expiresAt <= now` 即失效，命中不续期。每次请求前清理全部已过期项，再执行一次 lookup；清理只增加 expiry，不增加 lookup/miss。被访问的过期 key 计一次 miss，其他被清理 key 不产生请求。最终快照取最后一个请求时刻，不额外推进未来时间。
- 按 `(timestamp, requestIndex)` 顺序原子处理读取：命中则返回；未命中计一次 owner 读取，再假设源读取成功并在同一逻辑时刻填入。此零获取延迟假设必须可见，不生成延迟或并发排队结果。
- 可复用已有纯缓存状态，但通过明确公共边界接入，不更改现有缓存练习的并发 miss/填充语义。不实现更新值、失效传播、源失败、请求合并或副本一致性。
- 记录每次 bypass/lookup、hit/miss、TTL 清理、填充、淘汰和 owner 读取。统一守恒为 `reads = bypasses + lookups`、`lookups = hits + misses`、`backendReads = bypasses + misses`，每节点后端读取之和等于总后端读取。启用缓存时 bypasses 为 0；无缓存时 bypasses 与 backendReads 均等于 reads，lookup/hit/miss 为 0，命中率显示“不适用”。冷启动 miss 必须保留。
- 比较保持请求序列、成员、哈希与初始空缓存状态，仅改变所声明的缓存策略。展示缓存前请求热度、缓存后后端读取、命中率与淘汰；未命中重分配和缓存命中不能混为一种流量。

验证至少包括：重复热读降低后端读取、均匀大工作集不能保证高命中、TTL 到期重新访问、容量淘汰、冷启动第一次 miss，以及改输入后旧通过状态失效。解释题要求指出“后端读取减少不等于整个系统无瓶颈”；当前模型不评估共享缓存本身的处理容量。

**第二里程碑出口**：用户能用同一请求序列比较键分配、热点与只读缓存策略，解释各指标分母并关联到一个案例。模型、历史隔离、窄屏/键盘和浏览器流程通过，完成完整 `pnpm check`。SCALE-04 只标本期的只读分布/后端访问子目标；独立 shard 排队、写热点拆分和多副本策略继续留作后续。

## 8. 验证、交付与文档维护

### 第一里程碑实现入口

- 验收记录（2026-09-14）：完整 `pnpm check` 通过，包含 564 项单元/性质测试和 59 项浏览器测试；本轮新增 41 项模型/评分/保存测试与 3 项浏览器流程。既有 100,000 请求性能测试首轮用时 5.10 秒，超过 5 秒门槛；未改阈值，单独复测和整套重跑均通过。桌面与窄屏已检查，最大输入与键盘操作通过。
- 练习 ID `consistent-hashing` v1，入口 `/practice/consistent-hashing`；[目录与分流](../../apps/web/src/features/practice/catalog.ts)、[页面](../../apps/web/src/features/practice/distribution/hashing-lab.tsx)、[分布视图](../../apps/web/src/features/practice/distribution/distribution-view.tsx)。
- [纯分配模型](../../apps/web/src/features/practice/distribution/model.ts)、[题目与证据评分](../../apps/web/src/features/practice/distribution/lesson.ts)、[会话与撤销](../../apps/web/src/features/practice/distribution/session.ts)、[独立保存](../../apps/web/src/features/practice/distribution/repository.ts)。算法在有界输入上同步计算，没有异步计算结果覆盖新输入的通道；保存排队执行，状态按修订号更新。
- 哈希参考固定为 SMHasher [commit 07bb4de](https://github.com/aappleby/smhasher/blob/07bb4de10a63e8cc2e1724865454eba635742383/src/MurmurHash3.cpp) 的 `MurmurHash3_x86_32`。Austin Appleby 将该源代码置于 public domain。测试向量另以工具依赖中已有的 `imurmurhash` 0.1.4（MIT）按 UTF-8 字节独立生成，覆盖块、尾部、领域编码和 Unicode；不新增运行时依赖。
- [模型测试](../../apps/web/src/features/practice/distribution/model.test.ts)核对向量、独立枚举归属、碰撞、局部重映射、守恒与最大输入；[评分测试](../../apps/web/src/features/practice/distribution/lesson.test.ts)核对完整证据、固定基线及迁移题；[保存测试](../../apps/web/src/features/practice/distribution/repository.test.ts)核对不可变记录、版本、隔离、撤销和失败恢复；[浏览器验收](../../apps/web/tests/consistent-hashing.spec.ts)覆盖完整作答、刷新、窄屏、键盘、最大输入及旧练习隔离。

### 第二里程碑实现入口

- 验收记录（2026-09-20）：完整 `pnpm check` 通过，包含 585 项单元/性质测试及 62 项浏览器测试。本轮新增 21 项模型/评分/保存测试和 3 项浏览器流程；旧仿真与一致性哈希回归通过，修复了公共会话泛型约束及探索预置切换后的表单同步问题。
- 题目 ID `hot-key` v1，入口 `/practice/hot-key`。[页面](../../apps/web/src/features/practice/hot-key/hot-lab.tsx)提供发现热点、虚拟节点边界、缓存对照三步指导及自由探索；[参数面板](../../apps/web/src/features/practice/hot-key/hot-controls.tsx)区分固定条件和可编辑项，包含均匀大工作集反例。
- [模型](../../apps/web/src/features/practice/hot-key/model.ts)生成并核验完整读取序列，执行顺序只读缓存；[证据视图](../../apps/web/src/features/practice/hot-key/hot-evidence.tsx)并列显示 key、请求和后端读取，以分页表覆盖所有 key 和请求，展示每次 expiry、hit/miss、fill、eviction 与原始采样值。
- 节点的 `requests` 是按 key owner 归属的缓存前读取需求，`backendReads` 才是到达该 owner 的实际模型访问；缓存命中不能被解释成节点处理了一次读取。视图明确区分两者及统计分母。
- [评分](../../apps/web/src/features/practice/hot-key/lesson.ts)分别核对证据、固定条件下的操作和解释；要求识别实际热门 key、读取次数、owner、后端次数及案例边界。错误初始预测不会阻止通过；自由文字只保存，不自动判理解正确。
- 两个算法 Lab 复用[会话](../../apps/web/src/features/practice/algorithm/session.ts)与[保存实现](../../apps/web/src/features/practice/algorithm/repository.ts)，通过各自合同解析、运行和核验。原 `system-design-algorithm-labs` 数据库表结构与一致性哈希记录格式保持兼容；Hot Key 使用 `hot-key:v1` scope，原题使用 `consistent-hashing:v1`，不触碰 LocalHistory。
- [模型测试](../../apps/web/src/features/practice/hot-key/model.test.ts)使用独立数组 LRU 参考、逐条计数及反例；[评分测试](../../apps/web/src/features/practice/hot-key/lesson.test.ts)检查固定基线、完整证据、错误解释、迁移边界与最大输入；[保存测试](../../apps/web/src/features/practice/hot-key/session.test.ts)检查跨题/版本隔离、不可变尝试、撤销、恢复及写入失败；[浏览器测试](../../apps/web/tests/hot-key.spec.ts)覆盖完整三步、反例、明确的 4,096 keys / 20,000 reads 最大输入、窄屏、键盘与历史。

### 维护规则

- 模型测试优先检查独立向量、归属不变量、碰撞、精确计数与反例；不以截图或实现镜像测试代替算法证据。
- 浏览器验收从目录开始，覆盖操作、可见证据、预测纠正、迁移任务、保存恢复、基线锁定、旧结果拒绝和跨题隔离。最大输入只检查有界运行和界面可用，不将运行机器耗时解释成模型性能。
- 各部分保持独立可审查的改动；第一里程碑完成后即可交付，不等待 Hot Key 或综合案例。实现过程中如需变更模型规则，先更新本文的版本/边界和测试向量，再更新题目。
- 上线时在[矩阵](./learning-capability-matrix.md)记录实际题目 ID/version、覆盖子目标及代码/测试入口；更新 README 当前能力。仅新的共享仿真行为真正上线时更新模型说明，不把教学计划写成现有能力。
- 本文件集中维护本系列的分段 spec，不为每个指标或控件再建立 Markdown。更广能力和案例优先级继续由矩阵维护。
