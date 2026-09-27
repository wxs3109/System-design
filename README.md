# System Design Simulator

> Build it. Run it. Break it. Measure it.

面向 **System Design 学习和研究**的可视化仿真平台。用户从空白画布或示例开始组合组件，配置业务流量和故障，运行实验，观察瓶颈并比较设计取舍。

Service、DB、Queue 等组件运行的是虚拟时间下的简化行为模型，使用平台无需部署或连接真实中间件、数据库或云资源。模型深度以解释设计问题为准；仿真结果只适用于声明的假设，不构成生产容量或正确性保证。

基本流程：**搭建拓扑 → 配置负载 → 运行 → 观察 → 注入故障 → 调整并比较**。

## 快速开始

应用 CI 使用 Node.js 22，包管理器为 `pnpm@10.16.1`。在仓库根目录执行：

```bash
pnpm install --frozen-lockfile
pnpm dev
```

打开 [本地工作台](http://localhost:3000)。项目和运行记录保存在浏览器本地，也可导出为项目文件。

首次运行端到端测试前，安装测试浏览器：

```bash
pnpm --filter @system-design/web exec playwright install chromium
```

执行完整检查（lint、类型检查、单元测试、生产构建和浏览器测试）：

```bash
pnpm check
```

仅修改文档时，可运行内容和链接检查：

```bash
node .tools/lint-content.mjs
```

## 当前能力

- **综合设计题**：短链接、News Feed、S3 类对象存储、地图、Uber 类派单和云盘共 6 题，包含痛点、需求、接口/数据设计、实际操作、故障验证、方案对比与复盘；各题范围见[交付记录](docs/roadmap/practice-design-exercises.md)。
- **基础知识**：[本地知识入口](http://localhost:3000/learn)提供九组、24 篇入门讲解，支持中英文搜索、前置导航和三条阅读路径；每篇包含最小例子、机制、成立条件、反例和自测，并与现有 Lab 双向关联。尚未实现的协议实验与案例设计题明确标记为规划项。
- **交互练习**：[本地练习入口](http://localhost:3000/practice)提供 18 个 Lab，覆盖容量/分布、故障恢复、并发与过载，以及副本旧读、Quorum、Raft、2PC 和持久恢复。可交错读写、递送/丢弃消息、触发选举、刷盘与重放，查看实际账本和局部判断；各题支持证据核验与本地恢复。
- **搭建与配置**：空白画布、类型化连线、拓扑分组、自动布局和属性编辑。
- **业务合同**：定义 API、数据模型、事件、Interaction 和 Workflow，绑定具体 operation 的负载；支持有明确范围的 OpenAPI 3.1 / DBML 导入导出。
- **运行与故障实验**：常量/泊松到达、容量限制、排队、超时、重试、熔断、背压，以及支持的节点、链路和区域故障。
- **观察与比较**：吞吐量、延迟、错误率、利用率、积压、请求 Trace，以及相同实验条件下的运行对比。
- **保存与复现**：独立工作台会话、隔离的撤销/重做与保存范围、本地版本和运行历史、项目导入导出，以及固定场景、实验、版本和种子的可复现实验。
- **历史与备份**：Lab 历史分页、按需核验、归档与显式清理；实验、笔记和工作台备份支持预览后导入，保留原草稿并拒绝冲突覆盖。
- **异常恢复**：实验显示失败后保留本页输入，可导出或重试；Hot Key 的计算与核验在 Worker 中执行，Lab 与画布 Worker 支持取消和超时退出。

内置行为覆盖 Service、Database、Object Storage、Queue/Stream/Topic、Cache/CDN、Network、负载均衡、Global Router、Realtime Gateway、Scheduler 和 Workflow 等。每个行为的执行范围见[组件覆盖说明](docs/component-coverage.md)。

## 当前限制与计划

- 自由工作台目前支持启动和取消，暂停、单步和加速待实现；独立协议 Lab 已支持手动逐步操作与逻辑时间推进。
- 部分共享组件使用较粗的容量或状态近似。独立消息 Lab 已有重投与消费调度，共享工作台的 Queue/Stream/Topic、共享带宽竞争和长期存储预测仍需补强，见[仿真模型说明](docs/model-assumptions.md)。
- 基础协议 Lab 与综合设计题使用各自声明的有限模型。Raft 不含成员变更和日志压缩，2PC 不含全局快照隔离，持久恢复不实现真实磁盘；综合题用可重算的业务状态解释取舍。
- **需求与容量规划尚未实现**：已拆为 20 份 spec，第一里程碑先打通“业务需求 → Service 容量建议 → 应用 → 仿真 → 对比”。
- 外部组件 SDK、插件隔离、共享服务和服务端 Runner 保留在未来扩展中。

## 工作原理与代码结构

场景、业务合同、负载和故障经过校验与编译，由浏览器 Web Worker 中的 SimScript 推进虚拟时间。界面展示运行事件和指标；Canvas 布局不影响执行语义。

知识元数据和讲解正文独立维护在 `apps/web/src/features/learning/`；阅读页不执行模型或评分。现有实验从同一概念索引获得知识关联，算法与协议题使用各自的版本化输入、操作记录与结果。

24 个实验由 `apps/web/src/experiments/registry.ts` 统一注册路由、目录、案例关联和按需加载入口。`core/experiments` 提供不依赖页面的执行与存储接口；产品模型分别维护语义证据、评分和展示投影。版本迁移、恢复保护与新增实验约束见[教学实验架构决策](docs/decisions/adr-002-experiment-core.md)。

| 路径 | 职责 |
|---|---|
| [apps/web](apps/web/) | Next.js / React 工作台、画布、编辑器、观测和本地保存 |
| [packages/model](packages/model/) | 版本化项目、业务合同、事件与指标 Schema |
| [packages/components](packages/components/) | 组件/策略注册表、配置和编辑元数据 |
| [packages/simulation](packages/simulation/) | 编译器、SimScript 行为模型、Worker 协议和遥测 |
| [packages/formats](packages/formats/) | OpenAPI / DBML 的服务端格式适配 |

## 文档导航

| 文档 | 内容 |
|---|---|
| [容量规划候选计划](docs/roadmap/demand-capacity-planning/README.md) | 容量规划目标、里程碑、依赖和各部分 spec，尚未实现 |
| [容量规划共享合同](docs/roadmap/demand-capacity-planning/shared-contracts.md) | 学习模型边界、公式、运行证据和验收规则 |
| [学习能力矩阵](docs/roadmap/learning-capability-matrix.md) | 能力、候选练习、前置知识、验收证据、模型缺口与学习路径 |
| [基础设计决策顶层设计](docs/roadmap/foundation-design-decisions.md) | 从目标、资源、数据和状态约束到机制选择的教学分层、复用边界和分批规格 |
| [基础概念与平台接入](docs/roadmap/failure-recovery-foundations.md) | 知识入口、六个故障恢复 Lab 的模型合同与剩余范围 |
| [数据分布与 Hot Key Lab 计划](docs/roadmap/data-distribution-hot-key-labs.md) | 一致性哈希与热点只读缓存实验的模型合同、实现和验收 |
| [综合设计练习交付计划](docs/roadmap/practice-design-exercises.md) | 短链接可执行读取题，以及 News Feed、S3、地图、派单、云盘的逐题交付范围 |
| [组件覆盖说明](docs/component-coverage.md) | 组件类别、行为变体、Preset 和能力边界 |
| [仿真模型说明](docs/model-assumptions.md) | 当前执行语义、假设、指标解释和未支持行为 |
| [格式适配决策](docs/decisions/adr-001-format-adapters.md) | OpenAPI / DBML 的已选实现与支持范围 |
| [教学实验架构决策](docs/decisions/adr-002-experiment-core.md) | 模型/展示边界、执行接口、存储兼容、统一注册与依赖检查 |
| [未来扩展](docs/roadmap/future-extensions.md) | 延期的平台扩展方向 |
| [System Design 知识库](docs/knowledge-base/) | 学习资料与实验素材；不决定组件类型或运行逻辑 |

## 工程原则

- 通过通用组件、合同和策略组合系统；组件按 category → behavior variant → optional preset 组织，不写案例专用分支。
- 场景模型是配置事实来源，运行事件是观测依据；指标必须可追溯，动画只呈现结果。
- 假设、单位和不支持的语义必须可见；新增行为以可复现、能解释设计取舍的实验验收。
- 优先复用成熟库，通过适配层隔离；引入依赖前验证维护状态、许可证、包体、性能及运行环境兼容性。
- 保持项目版本迁移和结果复现；实现改动运行相关测试和完整 `pnpm check`。

## Terminology convention

保留通用英文术语，例如 `Fan-out`、`Backpressure`、`Watermark`；首次出现可附中文解释。避免自造缩写，明确术语对应的组件、流量、版本和操作边界。

## License

项目许可证尚未确定。引入依赖、复制示例或发布组件包之前，必须检查并记录对应许可证。
