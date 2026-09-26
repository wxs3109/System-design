# Simulation model assumptions

This document defines what a current simulation result means. The simulator is a deterministic, virtual-time model for exploring system-design trade-offs. It is not a capacity promise, benchmark of a real product, cloud-provider emulator, packet-level network simulator, or correctness proof.

This document describes the shared canvas simulation engine. The independent Practice protocol labs use separate, versioned command/state models for request retries, ACK/checkpoint and Outbox, heartbeat and lease/fencing, Saga recovery, single-row concurrent updates, bounded overload, replicated registers and quorum reads, Raft log consensus, two-phase commit, and WAL/backup recovery. Their contracts and boundaries are documented in [failure-recovery foundations](roadmap/failure-recovery-foundations.md). A capability in those labs does not automatically change Queue, Workflow, or routing behavior in the shared engine; saving a browser session is also distinct from modeled business durability.

`ProjectFile v3` supports capacity-only requests and business-aware operation plans bound to topology. Business definitions describe APIs, data models, cache keys, events, workflows, and interactions; only the projections specified below execute. Simulated state and events support learning and research without running real services, databases, or brokers. For component coverage see [component coverage](component-coverage.md); planned behavior belongs in the [roadmap](roadmap/demand-capacity-planning/README.md).

Results are useful for comparing designs only when the experiment is held constant. Baseline and candidate runs must use identical workload definitions, fault schedules, simulation limits, and seed. Absolute values are model outputs, not production forecasts. Calibrate component inputs with measurements before using them for planning.

Read by concern: [execution](#execution-and-reproducibility), [operations](#business-aware-operations-and-interactions), [routing and completion](#requests-routing-and-completion), [capacity](#capacity-queues-and-latency), [policies](#reliability-and-delivery-policies), [component semantics](#stateful-component-semantics), [faults](#faults), [metrics](#metrics-traces-and-interpretation), [validation](#unsupported-inputs-and-safe-failure).

## Execution and reproducibility

- SimScript advances one monotonic virtual clock in milliseconds. Wall-clock duration reports simulator performance only; it does not affect simulated behavior. A run stops at the configured virtual duration even if work remains in flight.
- One seeded pseudo-random stream drives Poisson arrivals, service jitter, intrinsic errors, weighted routing, generated keys, and generated read/write operations. With the run ID fixed, the same validated project, active experiment, engine version, and seed produce the same ordered runtime events. Wall-clock duration is deliberately excluded from that guarantee. Changing topology order or any behavior that consumes randomness can change later samples.
- Constant workloads use evenly spaced arrivals. Poisson workloads use exponential inter-arrival times. `maxRequests` is a generation safety limit shared by the run; reaching it stops new requests and emits a warning.
- [Scheduler](#scheduler-approximation) is a separate virtual-time source; its releases share the run's generation budget.
- `maxHops` terminates cyclic paths. A request at the limit fails with `hop_limit`; the engine does not infer loop intent.
- A saved run contains an immutable project snapshot. Historical comparisons reject different workloads, faults, simulation settings, or seeds, but engine-version compatibility is not yet a long-term stability guarantee.

## Business-aware operations and interactions

- Each operation-mix entry resolves one API operation and one interaction version. Compilation requires the interaction's entry API call to start at the workload's Traffic Generator and end at the API owner. Every action target must be enabled and reachable through compatible topology edges: API, service, data, and cache actions use synchronous paths; event publish/consume actions use asynchronous paths.
- An operation workload on a Traffic Generator supersedes the legacy capacity workload on that same source. The compiler emits a warning instead of generating both request streams. Arrival phases and weighted operation selection use the same virtual clock and seeded random stream as capacity-only workloads.
- An operation workload may instead use a [Scheduler source](#scheduler-approximation), whose timing replaces arrival phases.
- Interaction actions run in declared order. `dependsOn` normally requires earlier actions to have produced a successful outcome. Conditions branch on `success`, `failure`, `cache-hit`, or `cache-miss`; an unsatisfied action emits `action-skipped`. A successful action conditioned on an earlier action's `failure` marks that referenced failure as recovered. The operation fails after all eligible declared actions finish only when at least one action failure remains unrecovered; a failed recovery action is itself unrecovered. A `workflow` action still owns its internal ordered step state, retry clocks, deadlines, and compensation before returning one terminal action result. This does not turn the surrounding interaction into a parallel DAG or general recovery graph.
- Operation actions, including event publish and consume actions, are awaited through their terminal action outcome. This lets declared dependencies, backpressure rejection, dead-letter outcomes, and failure recovery remain deterministic. It differs from an undeclared asynchronous branch in the capacity-only request path, which remains fire-and-forget from its root request's perspective.
- Request context carries operation and action IDs, the selected key, payload bytes, data-object and query-shape identity, cache-key identity, and event identity. API/service handler time is added to the target Service's configured base time. Ordinary action targets consume their configured capacity, queue, latency, jitter, error, and active node-fault behavior; bound paths also apply modeled edge faults. [Workflow activities](#workflow-approximation) use a separate runner with the narrower behavior described there. Runtime meaning never depends on canvas coordinates.
- Operation metrics report generated/completed/failed counts and successful p95 latency. Action metrics report completed/failed counts, average duration, records examined, and bytes processed. Operation/action spans and domain events are derived from the same ordered runtime event stream as the summary.
- Request JSON bodies are not materialized. JSON Schema validates and documents contracts, while request bytes, API response estimates, sampled value bytes, and generated keys are the executable projection described by each component model. The operation-mix `responseBytes` override is stored in the compiled plan but is not yet applied to action response latency. API method/path, response status/schema, and SLO fields identify or describe an operation but do not emulate HTTP, enforce an SLO, or change correctness.

### Database access-cost approximation

For an access action, let $N$ be the declared object cardinality, $r$ the declared `estimatedRows` clamped to the modeled cardinality, $B$ the declared row/document/value bytes, $q$ the Database node's configured `queryTimeMs`, and

$$
d = \max\left(1, \left\lceil \log_2(\max(2,N)) \right\rceil\right).
$$

The simulator estimates examined records $E$, a query multiplier $m$, and service time

$$
t = \max\left(0.001, q m + \frac{\max(B, EB)}{262144}\right)\ \text{ms}.
$$

The byte term is a transparent calibration constant, not a storage-device throughput claim.

| Access shape | Examined records $E$ | Multiplier $m$ |
|---|---:|---:|
| point read | $1$ | $0.65$ |
| hash index read | $\min(N,1+r)$ | $0.75 + 0.035 + 0.004r$ |
| B-tree index read | $\min(N,d+r)$ | $0.75 + 0.035d + 0.004r$ |
| range read | $\min(N,d+r)$ | $0.9 + 0.04d + 0.006r$ |
| scan | $N$ | $1 + 0.35\log_{10}(N+1) + N/25000$ |
| insert | $1$ | $1.25$ |
| update | $r$ | $1.15 + 0.01r$ |
| delete | $r$ | $1.05 + 0.009r$ |

Index and range actions must reference a declared index. A hash index cannot serve a range read. Relational primary and unique keys are treated as B-tree access paths; relational indexes retain their B-tree/hash kind; document secondary indexes are treated as B-trees. The model uses declared cardinality and record size, but it does not inspect predicates, estimate real selectivity, choose a plan, model joins, or maintain changing cardinality after writes.

Database v2 supplies the aggregate shard/replica capacity and key-routing approximation described under [stateful component semantics](#stateful-component-semantics). Workload uniform, hotspot, or Zipfian key generation can therefore change shard concentration. It does not derive keys from JSON payloads or declared column/JSON-pointer values.

### Cache, event, and descriptive contract fields

- A named cache `get` performs the existing deterministic TTL/capacity lookup and produces a hit or miss outcome for interaction conditions. Explicit `put` and `delete` actions mutate that same cache state. Cache-key estimated bytes affect the action payload; its pattern and value schema are descriptive. There is no automatic cache-aside fill unless the interaction declares the corresponding write action.
- Named event publish/consume actions use the bound Queue, Stream, or Topic behavior and carry the declared event identity and estimated payload bytes. Topic additionally executes its own configured subscription fan-out, retention, batching, and acknowledgement semantics. The event contract's `delivery` and `ordering` declarations remain descriptive: they do not select that Topic configuration or add deduplication, exactly-once processing, or ordering enforcement.
- Specialized [`realtime`](#realtime-gateway-approximation) and [`workflow`](#workflow-approximation) actions use the state and pattern rules in their component sections.
- Ordinary operation action paths execute intermediate component resources and target component resources sequentially. Each bound hop applies edge timeout, retry, circuit-breaker, edge fault, node rate-limit, and node capacity/failure semantics. An `async-publish` hop also uses the configured node and edge backpressure gates and acknowledges admitted in-memory delivery when that action hop terminates. A traversed Load Balancer or Global Router dynamically chooses from exits that can continue to the declared action target. A direct alternative target may substitute for the declared target only when it has the same component type and component version; later interaction actions retain their own declared bindings rather than being rebound to that physical alternative. Selected routes feed the existing health-aware outcome state. [Topic consume actions](#topic-approximation) additionally settle retained subscription state. Edge latency-spike remains a multiplicative approximation rather than a packet or independent link-delay model.
- Relational column types/nullability, unique and foreign-key correctness, included-index columns, document schemas and partition-key pointers, key/value schemas, event payload schemas, API response schemas/SLOs, and key-value consistency hints remain validation or documentation metadata. They do not currently alter latency or enforce data correctness. Compiler warnings identify descriptive action-level fields that might otherwise imply execution semantics.

## Requests, routing, and completion

- A capacity-only request carries one byte size and generates a key and read/write operation when needed. The generic request model has no headers, protocol, authentication, payload contents, priority, deadline propagation, or tenant isolation. Explicit [Realtime Gateway](#realtime-gateway-approximation) connection state does not add general session semantics to other components.
- Ports provide behavioral routing semantics. `weighted-one` selects one synchronous edge by positive edge weight. A Load Balancer can instead use weighted, round-robin, or health-aware selection. Health-aware routing marks a target unhealthy after consecutive terminal call failures and makes it eligible again after a fixed recovery interval; it performs no active health checks.
- [Global Router](#global-router-approximation) adds Region affinity, decision caching, delayed health exclusion, and logical recovery probes.
- `fan-out` starts all synchronous branches. The root completes after every branch finishes and fails if any branch fails; there is no quorum, fastest-wins, branch cancellation, or partial-success policy.
- On the capacity-only request path, `async-publish` is fire-and-forget from the root request's perspective. Once all synchronous work is done, the root may complete while asynchronous branches are still running. Backpressure rejection or later async branch failure does not fail that root request, and a dead-letter outcome is an event rather than a durable stored message. A declared operation action instead waits for its own asynchronous path and exposes rejection or failure to interaction conditions. [Topic](#topic-approximation) separately retains subscription copies and settles them according to its acknowledgement policy.
- Disabled nodes and their incident paths are omitted at compile time. Unreachable enabled nodes produce warnings. A node may not connect directly to itself, but multi-node cycles are allowed and bounded by `maxHops`.

## Capacity, queues, and latency

- Components expose a fixed number of concurrent service units and a bounded FIFO waiting queue. A request is rejected with `queue_full` only when all units are busy and the waiting bound has been reached. There is no priority queueing, fairness class, CPU scheduling, autoscaling, resource sharing between nodes, or memory/GC model.
- Service time is the configured base plus uniformly distributed jitter, clamped to a small positive duration. It is not a measured latency distribution. Intrinsic errors are independent Bernoulli trials.
- Service and Queue capacity are replicas times per-replica concurrency and consumer count, respectively. Network capacity is configured parallelism; its service time is base latency plus request transfer time. Object Storage uses configured object size and read/write throughput.
- Capacity-drop faults multiply concurrent capacity and keep at least one service unit. Latency multipliers compose multiplicatively. Packet-loss probabilities compose as independent loss sources. Fault intervals are start-inclusive and end-exclusive on virtual time.
- Bandwidth-drop adds transfer delay only when the incoming edge's source is a Network Link. The model does not simulate shared links, congestion control, packetization, handshakes, DNS, connection pools between arbitrary nodes, or bandwidth contention across flows.

## Reliability and delivery policies

The current runtime semantics, rather than attachment display order, determine policy composition:

1. On an outbound synchronous edge, the circuit breaker decides whether each attempt may start.
2. An allowed attempt is subject to its timeout while the directly connected downstream node queues and runs. The deadline does not cover the target's later descendants.
3. Success or failure updates the circuit breaker and health-aware load-balancer state.
4. A failed attempt retries until `maxAttempts`, using fixed or capped exponential backoff plus seeded proportional jitter. All modeled failures, including timeout and circuit rejection, are retryable; edge retry has no reason-specific filter or idempotency model. [Workflow idempotency](#workflow-approximation) is scoped to explicit business executions.

Node rate limits are discrete token buckets. They start full, refill in whole configured intervals of virtual time, and reject immediately when empty; tokens are not reserved by concurrent work. Rate-limit admission occurs before arrival faults and capacity queueing at that node. Asynchronous backpressure bounds in-flight deliveries on configured nodes or edges and either rejects or records a dead-letter outcome. Runtime acknowledgement releases in-memory admission as asynchronous work terminates; it is not a broker durability guarantee. [Topic](#topic-approximation) has separate retained delivery state. There is no durable dead-letter store, broker restart persistence, ordering guarantee, or exactly-once contract.

Policy attachments are singletons per supported target. Timeout, retry, and circuit breaker target edges; rate limit targets nodes; backpressure targets nodes or edges. Group policies can exist in the project contract only when a registered policy supports them; no built-in policy currently does.

## Stateful component semantics

Components with longer execution contracts: [Scheduler](#scheduler-approximation), [CDN](#cdn-approximation), [Global Router](#global-router-approximation), [Search Index](#search-index-approximation), [Topic](#topic-approximation), [Realtime Gateway](#realtime-gateway-approximation), and [Workflow](#workflow-approximation).

| Component | What is modeled | Important boundary |
|---|---|---|
| Cache | key-aware reads, virtual-time TTL, bounded entry count, deterministic LRU/FIFO eviction, hit/miss routing | Capacity-only misses fill after the miss dependency succeeds; [named actions](#cache-event-and-descriptive-contract-fields) require explicit writes and support delete. Values, byte capacity, automatic invalidation, consistency, write-through/write-back, and stampede coalescing are not modeled. |
| Stream | stable key-to-partition hashing, monotonically increasing offsets, consumer groups, bounded batches, acknowledgement, and lag | Consumers drain batches as part of the component request. There is no continuously scheduled broker/consumer process, retention, compaction, rebalance, replication, per-partition throughput, or delivery retry. |
| Object Storage | generated read/write mix, concurrency, fixed object size, operation latency, successful byte counters | It does not store named objects or model existence, metadata, consistency, multipart transfer, cache/CDN behavior, or durability. |
| Database v1 | a bounded connection/query resource; business-aware actions use the [access-cost model](#database-access-cost-approximation) | It has no key-routing, shard, replica, query-plan, transaction, lock, or storage-engine state. |
| Database v2 | stable key-to-shard hashing, primary writes, round-robin replica reads, version lag, fixed replication delay, and the same access-cost model | Capacity is aggregate. Declared indexes affect access cost; real index structures, transactions, joins, locks, failover/election, replication bandwidth, conflict resolution, cross-shard queries, and consensus are absent. `replica-preferred` and `replica-only` both choose a replica when one exists. |

### Scheduler approximation

The first nominal release is `startAtMs`; later releases are separated by `intervalMs`. Periodic mode offers one run per tick, while batch mode offers `batchSize` runs. One seeded uniform offset in `[-jitterMs,+jitterMs]` is applied per tick and constrained not to move behind the previous tick. Releases outside virtual duration are not executed.

Concurrency tracks root work through its terminal outcome. At the limit, `skip` records a missed run; `catch-up` retains FIFO pending runs up to `maxPendingRuns` and releases them as slots settle. Pending or active work at virtual-time end stays unfinished. Scheduler decisions and all other generated roots share `maxRequests`.

One Scheduler can bind at most one operation workload. Its timing replaces that workload's arrival phases, while the operation mix still selects a topology-bound interaction plan; stored arrival phases are not executed and produce a compiler warning. There is no cron calendar/time zone/DST behavior, durable job store, leader election, distributed lease, priority, retry policy, or persistence across runs. Direct faults and node policies are rejected because Scheduler-specific failure/retry behavior is not modeled.

### CDN approximation

Capacity-only CDN requests carry a generated key. The CDN selects one logical POP by rendezvous hash or deterministic round-robin cursor, looks up that POP's independent bounded TTL cache, and routes through `hit` or `miss`. A successful miss dependency fills only the selected POP. The operation compiler has no CDN-specific action and does not apply CDN cache state while traversing an operation action path.

Byte-dependent edge transfer and origin round-trip/transfer are calibrated latency terms; the origin miss penalty is charged in addition to explicit miss-path component cost and does not simulate a return flow. POPs have no geographic coordinates. There is no request coalescing, purge/invalidation propagation, tiered cache, stale-while-revalidate, HTTP cache-control, range request, shared bandwidth contention, or origin shielding.

### Global Router approximation

Region identity comes only from `topology.groups` whose kind is `region`. The workload source supplies client location; direct route targets supply target location. When any Global Router exists, one node cannot belong to multiple Regions. In `geo` mode, every direct target must belong to a Region; a workload source without one produces a warning and takes weighted fallback. Layout coordinates are ignored, and Region membership adds no distance, latency, bandwidth, sovereignty, or data-placement behavior.

Direct synchronous exits must all use `weighted-one`. `geo` first restricts candidates to the client's Region, falling back to all targets when none match; `weighted` samples all targets; `health-aware` excludes targets whose unhealthy propagation delay has elapsed. Only health-aware mode schedules recovery probes. Operation action paths use the same selection state but can select only compatible exits that preserve their declared target semantics.

For eligible targets with positive edge weights $w_i$, seeded weighted selection uses

$$
P(i)=\frac{w_i}{\sum_j w_j}.
$$

The result is stored under the workload cohort identity until `selectedAt + decisionTtlMs`; roots without that identity fall back to their sampled key or trace ID. A cache hit continues to use that route even after the target is detected or becomes effectively unhealthy; the health state is considered only when a new health-aware decision is made. TTL represents a coarse DNS/edge-decision cache, not a resolver hierarchy, client-specific TTL implementation, or active cache invalidation.

Target results are passive observations sampled no more often than `healthCheckIntervalMs`. After `unhealthyThreshold` consecutive sampled failures, detection occurs at $t_d$ and exclusion becomes effective at

$$
t_e=t_d+T_{propagation}.
$$

Here $T_{propagation}$ is `failoverDelayMs`. Once detected, a logical probe checks the target at the same configured interval against modeled node faults; `healthyThreshold` consecutive sampled successes restore eligibility. Probes do not consume network or target capacity and do not inspect an external health endpoint. Before effective exclusion, and for the full lifetime of an existing cached decision, traffic can continue to reach the failed target.

A failover is recorded when an expired cohort decision moves from a now-effectively-unhealthy edge to a different edge. Its reported delay is

$$
T_{observed}=t_{new route}-t_d,
$$

so it includes propagation, any remaining decision TTL, and request-arrival granularity. It is not just the configured propagation value. If every health-aware target is excluded, route selection fails with `no_healthy_target`. Geo and weighted policies do not exclude unhealthy targets. Routing decisions, cache hits/misses/expiry, geo matches, target selections, failed outcomes, health transitions/recoveries, failover count, and cumulative/maximum observed delay are retained as aggregate evidence when `traceLimit` is zero.

Decisions are in-run control-plane state. This does not execute DNS, Anycast/BGP, geolocation, latency measurement, a distributed health-check service, a global load balancer protocol, or cross-region replication.

### Search Index approximation

For $S$ primary shards, $R$ replicas per shard, result limit $L$, and visible documents $D_s$ on the selected copy of shard $s$, a query visits one copy of every primary shard:

$$
F=S,\qquad C=\sum_{s=1}^{S}\min(L,D_s),\qquad N=\min(L,C)
$$

where $F$ is fan-out, $C$ is the merged candidate count, and $N$ is the reported result count. The explainable query service-time approximation is:

$$
T_q=T_{coord}+T_{shard}+F\,T_{fanout}+C\,T_{merge}
$$

Shards search in parallel in this abstraction, so $T_{shard}$ is charged once; candidate merge and fan-out are charged explicitly. Whole-query concurrent capacity is $K_{copy}(R+1)$, not multiplied by $S$, because every logical query consumes one copy in every shard. A successful write of $B$ bytes uses $T_w=T_{write}+8B/(1000\,M_{index})$. Its primary visibility time is the first refresh boundary at or after `acceptedAt + indexingDelay`; replicas become visible after the additional replica refresh delay. A query is stale when its selected copy differs from the latest accepted version/presence of the requested key.

Collection `estimatedDocuments` initializes candidate availability and `estimatedDocumentBytes` drives records/bytes evidence. `keySpaceSize` is only the fallback for capacity-only traffic without a bound document model. The model intentionally does not infer search relevance from JSON Schema or secondary-index field names.

Capacity-only traffic without an existing key uses one distinguished hot key plus uniform samples from the configured key space; a hot-key fault overrides that probability. Operation workloads instead supply their sampled `uniform`, `hotspot`, or `zipfian` keys, and a workload hot-key fault replaces that distribution with a single-key hotspot. `zipfian` is the runtime's bounded rank-sampling approximation, not empirical traffic replay. No path replays user-supplied traces.

Only Document models may bind to Search Index; `point-read` is rejected. Mutations are acknowledged after successful node work, and queries choose shard copies round-robin. This is not a text engine: analyzers/tokenizers, query DSL, relevance/ranking, term statistics, Lucene segments/merges, query cache, shard relocation, failover, consensus, and cross-index queries are absent.

### Topic approximation

For $S$ configured subscription slots, every successfully completed publish creates one retained message and $S$ independently acknowledged delivery copies. Therefore, after $P$ successful publishes and before acknowledgement or expiry, the modeled fan-out is

$$
C_{fanout}=PS.
$$

Enabled `async-publish` edges leaving the Topic map in deterministic topology order to `subscription:0` through `subscription:S-1`. More than $S$ such edges is a compile error. Fewer edges are allowed: an unbound slot represents an offline subscription and continues accumulating backlog. A v3 event-consume action maps through its first Topic edge to the same slot, and two actions may not claim the same edge in one interaction.

At a delivery opportunity, one slot selects up to `batchSize` oldest pending copies. The simulated downstream request carries their combined bytes. `deliveryTimeMs` adds a fixed broker-to-subscriber delay before the target runs, while the subscriber still consumes its own capacity, queue, latency, faults, and error rate. That delay does not currently contend for a separate delivery resource. With `auto` acknowledgement, copies settle when dispatched. With `explicit` acknowledgement, each selected copy settles after downstream terminal success; rejection before selection leaves it pending, and downstream failure releases it from in-flight state.

`retentionMs` assigns each message an expiry deadline from publish time. `maxRetainedMessages` limits unique retained messages, not fan-out copies; accepting a message at the limit removes the oldest whole message and every still-outstanding subscription copy. Time cleanup is evaluated at the first Topic operation or metric snapshot at or after the deadline rather than by a separate broker timer. Published messages, bytes, fan-out copies, unique retained messages, aggregate and per-slot backlog/in-flight/age, deliveries, acknowledgements, and time/capacity expiry are emitted as runtime evidence.

There is no autonomous subscriber loop or redelivery timer. A capacity-only topology offers deliveries as successful publications traverse the Topic; an operation-aware project offers them when its event-consume actions execute. Released copies need another such opportunity. `batchSize` can drain older retained copies during a later opportunity but does not schedule work. Message keys and bytes are modeled; payload bodies, subscription names/filters, per-subscription configuration, consumer concurrency groups, retry schedules, dead-letter storage, ordering enforcement, deduplication, replication, disk durability, and exactly-once processing are not.

### Realtime Gateway approximation

A capacity-only request represents a new generated client: after successful node work it connects, joins one fallback channel, and broadcasts `defaultMessageBytes`. Its connection ID derives from the request ID and its channel from `requestId mod defaultChannelCount`. A business-aware `realtime` action instead performs `connect`, `broadcast`, or `disconnect`; connect also joins the selected channel, and broadcast requires `messageBytes`. `connectionPattern` and `channelPattern` replace every `{request}` with the root request ID and `{key}` with the sampled workload key; other text is literal. There are no separate join/leave actions.

A successful `connect` admits a new connection only while active connections are below `maxConnections`; reconnecting the same generated ID reuses the existing connection without refreshing its lifetime. It then joins the selected channel while that connection has fewer than `maxChannelsPerConnection` memberships. Its lifetime starts when the first connect action completes and ends after `connectionDurationMs`. Disconnect or expiry removes all memberships and drops that connection's remaining outbound queue. Connection admission or membership rejection fails the action and operation. Disconnecting an unknown ID leaves state unchanged and emits rejected evidence, but is otherwise treated as an idempotent successful action.

Each newly admitted connection is independently classified as slow with seeded probability `slowConnectionFraction`. It receives either `outboundBandwidthMbps` or `slowConnectionBandwidthMbps`; this classification remains fixed for that connection. For a broadcast of $B$ bytes to a channel with $F$ active members at action admission, every member, including the initiating connection when it is a member, receives one attempted copy. The gateway's request-processing approximation before jitter and faults is

$$
T_{broadcast}=T_{base}+F T_{fanout}.
$$

Each recipient has its own FIFO outbound schedule. If its previous delivery becomes available at $A_i$ and its bandwidth is $b_i$ Mbps, a newly accepted copy at virtual time $t$ completes at

$$
D_i=\max(t,A_i)+\frac{8B}{1000b_i}\ \text{ms}.
$$

This transfer time drains only that recipient's logical queue; it does not consume a shared network link or execute another topology node. Drain and expiry are evaluated when the gateway next advances through an operation or metric sample. Copies scheduled no later than connection expiry are delivered; later copies are dropped with the connection.

Before enqueue, the runtime checks whether the recipient's pending bytes plus $B$ exceed `maxPendingBytesPerConnection`. With `drop-message`, only that copy is rejected and other recipients continue. With `disconnect`, the triggering copy is rejected, the slow connection is removed, and all of its already-pending copies are dropped. `maxConcurrentMessages` and `maxQueueSize` bound gateway action processing, while `maxConnections` separately bounds persistent connection state. A capacity-drop fault changes processing concurrency, not the configured connection limit.

Active/peak/accepted/rejected/expired/disconnected connections, channels and memberships, broadcast count, attempted fan-out copies, delivered copies, current/peak pending bytes, dropped copies/bytes, and overflow disconnects are derived from gateway state snapshots. These aggregates remain exact when `traceLimit` removes request-level evidence. `disconnectedConnections` includes explicit disconnects, expiry, and overflow removal; use the separate expiry and overflow counters to distinguish causes.

Connection and channel state is scoped to one gateway in one run. This does not simulate WebSocket/SSE, frames, heartbeats, ping/pong, inbound socket bandwidth, connection establishment network round trips, authentication, channel authorization, presence, message ordering, acknowledgements/retry, offline replay, reconnect/resume, sticky routing, replicated membership, cross-node broadcast, broker durability, or a delivery guarantee. Broadcast payload bodies are not materialized, and channel strings imply only exact membership identity.

### Workflow approximation

A capacity-only request creates a request-scoped execution with one synthetic step. The node's configured concurrency, queue, step time, jitter, error rate, persistence time, admission policies, and active faults apply through the ordinary component path; it does not synthesize business retries or compensation.

A business-aware `workflow` action targets the node owning its versioned definition. Its idempotency pattern replaces `{request}` and `{key}` with the root request ID and sampled workload key. Each activity must target a Service reachable through a synchronous path; an optional API-operation reference must belong to that Service. Each forward or compensation activity has its own timeout and retry policy.

A Workflow Definition is a linear sequence. Completing step $i$ stores a successful checkpoint before step $i+1$ is claimed. The runtime retains every attempt with start, deadline, completion, and outcome. An execution is active while it is running or compensating; `maxConcurrentInstances` rejects a new business execution at the limit. Terminal records and their idempotency mappings remain available until the run ends.

Idempotency is scoped by Workflow Definition ID and rendered key. Reusing that pair with the same definition signature returns the existing in-flight or terminal execution and performs no new activity. An in-flight replay waits for the original execution and returns its terminal outcome; a stored successful execution succeeds immediately, while a stored failed, compensated, or compensation-failed execution fails immediately. Reusing the pair with a different version, step order, or retry/compensation signature is rejected as a conflict. This prevents duplicate simulated work; it does not provide a database uniqueness constraint or exactly-once behavior in a real dependency.

For failed attempt number $a$, the retry delay before seeded jitter is

$$
B_a=\min(B_{max},B_0m^{a-1}),
$$

where $m=1$ for fixed backoff and $m=2$ for exponential backoff. A seeded sample $u\in[0,1]$ and declared jitter ratio $j$ produce

$$
D_a=\min(B_{max},\max(0,B_a[1+(2u-1)j])).
$$

`maxAttempts` includes the first attempt, and every modeled failure reason is retryable. The activity deadline starts when the attempt is claimed and includes waiting for target Service capacity plus its configured service and handler time; a queued timeout is observed after capacity admission rather than scheduling a separate queue-cancellation event at the exact deadline. Edge region outage/packet loss and target Service node-down/region outage, capacity drop, queue, jitter, and intrinsic error can affect an attempt. This runner does not execute intermediate nodes, latency-spike/bandwidth-drop effects, edge reliability policies, or node rate-limit policies. The Workflow's `persistenceTimeMs` is charged after each executed activity as checkpoint overhead. Business-aware steps use their bound Service activities and definition; they do not apply Workflow-node admission policies/faults, default step time, jitter, or error rate.

When a forward step exhausts its attempts, only earlier steps with successful checkpoints and declared compensation are selected. They run in reverse declaration order. Each compensation has its own timeout and retry policy; exhausting one marks the final execution `compensation-failed` but does not prevent remaining earlier compensations from being attempted. A fully successful rollback ends `compensated`; both outcomes fail the enclosing action and root operation because compensation is recovery evidence, not successful business completion.

Workflow events expose instance start/replay/terminal state, attempt/checkpoint/failure/timeout, retry scheduling, and compensation start/completion. Node details retain active/peak/started/rejected/completed/failed/compensated instances, idempotency replays/conflicts, forward attempt/checkpoint/failure/timeout totals, retry counts, and compensation attempts/failures. These aggregates remain exact when `traceLimit` removes request-level events.

History and checkpoints are retained for one run, without disk persistence or restart recovery. There is no parallel/DAG execution, external signal/timer, human task, child workflow, distributed transaction, exactly-once side effect, workflow-version migration, worker lease, or cross-run recovery.

## Faults

Supported schedules include node down, capacity drop, latency spike, edge bandwidth drop, edge packet loss, workload traffic spike, workload hot key, and region/zone outage. Overlapping factors compose deterministically. Region/zone outages are expanded into faults on member nodes and incident edges at compile time. [Global Router](#global-router-approximation) also uses explicit Region identity; zones do not participate in geo matching.

Faults do not model correlated stochastic failure, cascading failure discovery, repair crews, partial partitions, clock skew, data loss, failover promotion, recovery warm-up, or state reconstruction. A timeline item changes only the behavior described by its registered fault type. Grouping itself adds no capacity or failure mechanics; the one additional semantic is explicit Region identity for Global Router selection.

## Metrics, traces, and interpretation

- Summary throughput is completed root requests divided by the configured simulation duration, not by the active workload duration. Error rate is failed root requests divided by generated root requests. Work still in flight at virtual-time end is neither completed nor failed and is reported in a warning.
- Latency percentiles use completed root requests only. Failed and unfinished requests are excluded. Percentiles are exact over the full-run latency aggregate and values are rounded to three decimals.
- Node utilization and queue metrics are sampled state, not operating-system measurements. Time-series values are aligned to the configured sample interval; short spikes between samples may be absent.
- Runtime events are the source of UI evidence. `traceLimit` caps request-level event and span detail by request ID to control memory, while online reducers retain exact full-run summary, node-count, and time-series aggregates. A missing trace after the cap is not evidence that the request never existed and does not change displayed aggregate metrics.
- Bottleneck explanations are deterministic evidence rules over emitted metrics and events. They identify modeled symptoms such as saturation, retry amplification, hot shards, cache-miss load, or circuit rejection; they are not automated architecture recommendations or causal proofs.

## Unsupported inputs and safe failure

Project files are validated before compilation. The current parser opens schema versions 1, 2, and 3. Versions 1 and 2 migrate deterministically to a capacity-only v3 project with empty business catalogs and operation workloads; migration does not infer APIs, data models, events, workflows, or interactions. Version 3 validates those catalogs and all supported cross-resource/topology references. Missing, future, unknown, or structurally invalid versions are rejected. Unknown component or policy versions, invalid port semantics, duplicate identifiers, missing references, invalid fault targets, and unsupported policy targets fail with validation errors instead of being guessed or silently approximated.

The current platform does not execute vendor-compatible APIs, packets, production traffic replay, arbitrary user code/public plugins, real distributed clocks, service discovery, protocol details, database query planning/storage engines, or Raft/Paxos/other consensus. Accounts, hosted collaboration, and multiplayer editing are also unavailable; future plans do not change the meaning of current results.

When a desired behavior is absent from this document and has no registered component, policy, event, or fault contract, the result must not be interpreted as simulating it.
