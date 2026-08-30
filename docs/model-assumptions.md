# Simulation model assumptions

This document defines what a current simulation result means. The simulator is a deterministic, virtual-time model for exploring system-design trade-offs. It is not a capacity promise, benchmark of a real product, cloud-provider emulator, packet-level network simulator, or correctness proof.

`ProjectFile v3` can store, validate, and execute business definitions for APIs, relational/document/key-value data models, cache keys, events, interactions, and operation workloads. P2.4 compiles those definitions into topology-bound operation plans and emits operation/action events and metrics. Capacity-only projects continue to use the Phase 1 anonymous-request path. The operation-aware path is still an explainable system-design approximation; the executed and descriptive fields are separated below.

Results are useful for comparing designs only when the experiment is held constant. Baseline and candidate runs must use identical workload definitions, fault schedules, simulation limits, and seed. Absolute values are model outputs, not production forecasts. Calibrate component inputs with measurements before using them for planning.

## Execution and reproducibility

- SimScript advances one monotonic virtual clock in milliseconds. Wall-clock duration reports simulator performance only; it does not affect simulated behavior. A run stops at the configured virtual duration even if work remains in flight.
- One seeded pseudo-random stream drives Poisson arrivals, service jitter, intrinsic errors, weighted routing, generated keys, and generated read/write operations. With the run ID fixed, the same validated project, active experiment, engine version, and seed produce the same ordered runtime events. Wall-clock duration is deliberately excluded from that guarantee. Changing topology order or any behavior that consumes randomness can change later samples.
- Constant workloads use evenly spaced arrivals. Poisson workloads use exponential inter-arrival times. `maxRequests` is a generation safety limit shared by the run; reaching it stops new requests and emits a warning.
- A Scheduler is a separate source. Its first nominal release is `startAtMs`; later releases are separated by `intervalMs`. Periodic mode offers one run per tick, while batch mode offers `batchSize` runs. One seeded uniform offset in `[-jitterMs,+jitterMs]` is applied per tick and constrained not to move behind the previous tick. Releases outside virtual duration are not executed.
- Scheduler concurrency tracks root work through its real terminal outcome. At the limit, `skip` records a missed run; `catch-up` retains FIFO pending runs up to `maxPendingRuns` and releases them as slots settle. Pending or active work at virtual-time end stays unfinished. Scheduler decisions and all other generated roots share `maxRequests`.
- Capacity-path CDN requests carry a generated key. The CDN selects one POP by rendezvous hash or a deterministic round-robin cursor, performs one lookup in that POP's independent bounded TTL cache, and routes the request through its `hit` or `miss` port. A successful miss dependency fills only the selected POP. The operation-aware compiler has no CDN-specific interaction action yet, so it does not currently apply CDN state while traversing an operation action path.
- `maxHops` terminates cyclic paths. A request at the limit fails with `hop_limit`; the engine does not infer loop intent.
- A saved run contains an immutable project snapshot. Historical comparisons reject different workloads, faults, simulation settings, or seeds, but engine-version compatibility is not yet a long-term stability guarantee.

## Business-aware operations and interactions

- Each operation-mix entry resolves one API operation and one interaction version. Compilation requires the interaction's entry API call to start at the workload's Traffic Generator and end at the API owner. Every action target must be enabled and reachable through compatible topology edges: API, service, data, and cache actions use synchronous paths; event publish/consume actions use asynchronous paths.
- An operation workload on a Traffic Generator supersedes the legacy capacity workload on that same source. The compiler emits a warning instead of generating both request streams. Arrival phases and weighted operation selection use the same virtual clock and seeded random stream as capacity-only workloads.
- An operation workload may instead use a Scheduler source. In that case Scheduler timing replaces arrival phases, while the operation mix still selects a topology-bound interaction plan. The stored arrival phases are not executed and produce a compiler warning. One Scheduler can bind at most one operation workload.
- Actions run in declared order. `dependsOn` requires earlier actions to have produced a successful outcome. Conditions currently branch on `success`, `cache-hit`, or `cache-miss`; an unsatisfied action emits `action-skipped`. An executed action failure terminates its operation, so the schema's `failure` condition is reserved and is not yet a recovery branch. This is a deterministic workflow projection, not parallel DAG scheduling, distributed transactions, rollback, compensation, or a saga engine.
- Request context carries operation and action IDs, the selected key, payload bytes, data-object and query-shape identity, cache-key identity, and event identity. API/service handler time is added to the target Service's configured base time. Action targets consume their configured capacity, queue, latency, jitter, error, and active node-fault behavior. Bound path traversal also remains subject to modeled edge faults. Runtime meaning never depends on canvas coordinates.
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

Database v2 still supplies the aggregate shard/replica capacity and key-routing approximation described under Stateful component semantics. Workload uniform, hotspot, or Zipfian key generation can therefore change shard concentration. It does not derive keys from JSON payloads or declared column/JSON-pointer values.

### Cache, event, and descriptive contract fields

- A named cache `get` performs the existing deterministic TTL/capacity lookup and produces a hit or miss outcome for interaction conditions. Explicit `put` and `delete` actions mutate that same cache state. Cache-key estimated bytes affect the action payload; its pattern and value schema are descriptive. There is no automatic cache-aside fill unless the interaction declares the corresponding write action.
- Named event publish/consume actions use the bound Queue/Stream capacity behavior and carry the declared event identity and estimated payload bytes. Delivery and ordering declarations are currently descriptive; they do not add durable redelivery, deduplication, exactly-once processing, or ordering enforcement.
- Operation action paths execute intermediate component resources and target component resources sequentially. Edge timeouts and node rate limits apply, while retry/circuit-breaker attachments, async backpressure gates, and load-balancer target selection are not yet composed into operation action paths. Edge latency-spike remains multiplicative and therefore adds no delay to a zero-latency edge. Use node capacity/latency/failure controls for operation-aware comparisons until those remaining policy integrations are implemented.
- Relational column types/nullability, unique and foreign-key correctness, included-index columns, document schemas and partition-key pointers, key/value schemas, event payload schemas, API response schemas/SLOs, and key-value consistency hints remain validation or documentation metadata. They do not currently alter latency or enforce data correctness. Compiler warnings identify descriptive action-level fields that might otherwise imply execution semantics.

## Requests, routing, and completion

- A request has one byte size, one generated key when a stateful component needs it, and one generated read/write operation when applicable. The request model has no headers, protocol, authentication, session, payload contents, priority, deadline propagation, or tenant isolation.
- Ports provide behavioral routing semantics. `weighted-one` selects one synchronous edge by positive edge weight. A Load Balancer can instead use weighted, round-robin, or health-aware selection. Health-aware routing marks a target unhealthy after consecutive terminal call failures and makes it eligible again after a fixed recovery interval; it performs no active health checks.
- `fan-out` starts all synchronous branches. The root completes after every branch finishes and fails if any branch fails; there is no quorum, fastest-wins, branch cancellation, or partial-success policy.
- `async-publish` is fire-and-forget from the root request's perspective. Once all synchronous work is done, the root may complete while asynchronous branches are still running. Backpressure rejection or later async branch failure does not fail that root request, and a dead-letter outcome is an event rather than a durable stored message.
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
4. A failed attempt retries until `maxAttempts`, using fixed or capped exponential backoff plus seeded proportional jitter. All modeled failures, including timeout and circuit rejection, are retryable; there is no reason-specific retry filter or idempotency model.

Node rate limits are discrete token buckets. They start full, refill in whole configured intervals of virtual time, and reject immediately when empty; tokens are not reserved by concurrent work. Rate-limit admission occurs before arrival faults and capacity queueing at that node. Asynchronous backpressure bounds in-flight deliveries on configured nodes or edges and either rejects or records a dead-letter outcome. Runtime acknowledgement releases in-memory admission as asynchronous work terminates; it is not a broker durability guarantee. There is no durable dead-letter store, redelivery timeout, delivery retry, ordering guarantee, or exactly-once contract.

Policy attachments are singletons per supported target in Phase 1. Timeout, retry, and circuit breaker target edges; rate limit targets nodes; backpressure targets nodes or edges. Group policies can exist in the project contract only when a registered policy supports them; no built-in Phase 1 policy currently does.

## Stateful component semantics

| Component | What is modeled | Important boundary |
|---|---|---|
| Cache | key-aware reads, virtual-time TTL, bounded entry count, deterministic LRU/FIFO eviction, hit/miss routing | Miss data is filled only after the miss dependency succeeds. Values, byte capacity, invalidation, consistency, write-through/write-back, and stampede coalescing are not modeled. |
| CDN | deterministic POP selection, independent per-POP TTL/entry caches, hit/miss routing, successful origin fill, and byte-dependent edge/origin transfer latency | POPs are logical slots, not geographic coordinates. Origin round-trip/transfer are charged as a calibrated miss penalty at the CDN in addition to the explicit miss-path component cost; they do not simulate a return flow. There is no request coalescing, purge/invalidation propagation, tiered cache, stale-while-revalidate, HTTP cache-control, range request, shared bandwidth contention, or origin shielding. |
| Stream | stable key-to-partition hashing, monotonically increasing offsets, consumer groups, bounded batches, acknowledgement, and lag | Consumers drain batches as part of the component request. There is no continuously scheduled broker/consumer process, retention, compaction, rebalance, replication, per-partition throughput, or delivery retry. |
| Object Storage | generated read/write mix, concurrency, fixed object size, operation latency, successful byte counters | It does not store named objects or model existence, metadata, consistency, multipart transfer, cache/CDN behavior, or durability. |
| Database v1 | a bounded connection/query resource | It has no key, shard, replica, query-plan, transaction, lock, or storage-engine semantics. |
| Database v2 | stable key-to-shard hashing, primary writes, round-robin replica reads, version lag, and fixed replication delay | Capacity is an aggregate approximation. There are no transactions, indexes, joins, locks, failover/election, replication bandwidth, conflict resolution, cross-shard queries, or consensus. `replica-preferred` and `replica-only` both choose a replica when one exists. |
| Scheduler | periodic or batched release ticks, seeded bounded jitter, real in-flight concurrency, skip/catch-up pending behavior, and optional v3 operation-plan selection | It has no cron calendar/time zone/DST semantics, durable job store, leader election, distributed leases, priority, retry policy, or persistence across runs. Direct faults and node policies are rejected because Scheduler-specific failure/retry semantics are not yet modeled. |
| Search Index | document mutations acknowledged after successful node work, delayed primary/replica refresh visibility, query fan-out across primary shards, round-robin copy selection, bounded candidate merge, stale-query evidence, and cardinality/byte-aware action metrics | It is not a text engine: there is no analyzer/tokenizer, query DSL, relevance/ranking, term statistics, Lucene segment/merge model, cache, shard relocation, failover, consensus, or cross-index query. Only Document models may bind to it; `point-read` is rejected. |

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

Generated key traffic uses one distinguished hot key plus a uniform distribution over the remaining configured key space. A hot-key fault overrides the per-request hot-key probability. It does not model Zipfian or user-supplied traces.

## Faults

Phase 1 supports scheduled node down, capacity drop, latency spike, edge bandwidth drop, edge packet loss, workload traffic spike, workload hot key, and region/zone outage. Overlapping factors compose deterministically. Region/zone outages are expanded into faults on member nodes and incident edges at compile time.

Faults do not model correlated stochastic failure, cascading failure discovery, repair crews, partial partitions, clock skew, data loss, failover promotion, recovery warm-up, or state reconstruction. A timeline item changes only the behavior described by its registered fault type; visual grouping has no additional runtime meaning.

## Metrics, traces, and interpretation

- Summary throughput is completed root requests divided by the configured simulation duration, not by the active workload duration. Error rate is failed root requests divided by generated root requests. Work still in flight at virtual-time end is neither completed nor failed and is reported in a warning.
- Latency percentiles use completed root requests only. Failed and unfinished requests are excluded. Percentiles are exact over the full-run latency aggregate and values are rounded to three decimals.
- Node utilization and queue metrics are sampled state, not operating-system measurements. Time-series values are aligned to the configured sample interval; short spikes between samples may be absent.
- Runtime events are the source of UI evidence. `traceLimit` caps request-level event and span detail by request ID to control memory, while online reducers retain exact full-run summary, node-count, and time-series aggregates. A missing trace after the cap is not evidence that the request never existed and does not change displayed aggregate metrics.
- Bottleneck explanations are deterministic evidence rules over emitted metrics and events. They identify modeled symptoms such as saturation, retry amplification, hot shards, cache-miss load, or circuit rejection; they are not automated architecture recommendations or causal proofs.

## Unsupported inputs and safe failure

Project files are validated before compilation. The current parser opens schema versions 1, 2, and 3. Versions 1 and 2 migrate deterministically to a capacity-only v3 project with empty business catalogs and operation workloads; migration does not infer APIs, data models, events, or interactions. Version 3 validates those catalogs and all supported cross-resource/topology references. Missing, future, unknown, or structurally invalid versions are rejected. Unknown component or policy versions, invalid port semantics, duplicate identifiers, missing references, invalid fault targets, and unsupported policy targets fail with validation errors instead of being guessed or silently approximated.

The following remain explicitly out of scope for Phase 1: vendor API compatibility; packet-level emulation; production traffic replay; arbitrary user code or public plugins; real distributed clocks; service discovery; protocol details; database query planning and storage engines; Raft, Paxos, or other consensus; accounts, hosted collaboration, and multiplayer editing.

When a desired behavior is absent from this document and has no registered component, policy, event, or fault contract, the result must not be interpreted as simulating it.
