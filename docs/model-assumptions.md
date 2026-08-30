# Simulation model assumptions

This document defines what a Phase 1 result means. The simulator is a deterministic, virtual-time model for exploring system-design trade-offs. It is not a capacity promise, benchmark of a real product, cloud-provider emulator, packet-level network simulator, or correctness proof.

Results are useful for comparing designs only when the experiment is held constant. Baseline and candidate runs must use identical workload definitions, fault schedules, simulation limits, and seed. Absolute values are model outputs, not production forecasts. Calibrate component inputs with measurements before using them for planning.

## Execution and reproducibility

- SimScript advances one monotonic virtual clock in milliseconds. Wall-clock duration reports simulator performance only; it does not affect simulated behavior. A run stops at the configured virtual duration even if work remains in flight.
- One seeded pseudo-random stream drives Poisson arrivals, service jitter, intrinsic errors, weighted routing, generated keys, and generated read/write operations. With the run ID fixed, the same validated project, active experiment, engine version, and seed produce the same ordered runtime events. Wall-clock duration is deliberately excluded from that guarantee. Changing topology order or any behavior that consumes randomness can change later samples.
- Constant workloads use evenly spaced arrivals. Poisson workloads use exponential inter-arrival times. `maxRequests` is a generation safety limit shared by the run; reaching it stops new requests and emits a warning.
- `maxHops` terminates cyclic paths. A request at the limit fails with `hop_limit`; the engine does not infer loop intent.
- A saved run contains an immutable project snapshot. Historical comparisons reject different workloads, faults, simulation settings, or seeds, but engine-version compatibility is not yet a long-term stability guarantee.

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
| Stream | stable key-to-partition hashing, monotonically increasing offsets, consumer groups, bounded batches, acknowledgement, and lag | Consumers drain batches as part of the component request. There is no continuously scheduled broker/consumer process, retention, compaction, rebalance, replication, per-partition throughput, or delivery retry. |
| Object Storage | generated read/write mix, concurrency, fixed object size, operation latency, successful byte counters | It does not store named objects or model existence, metadata, consistency, multipart transfer, cache/CDN behavior, or durability. |
| Database v1 | a bounded connection/query resource | It has no key, shard, replica, query-plan, transaction, lock, or storage-engine semantics. |
| Database v2 | stable key-to-shard hashing, primary writes, round-robin replica reads, version lag, and fixed replication delay | Capacity is an aggregate approximation. There are no transactions, indexes, joins, locks, failover/election, replication bandwidth, conflict resolution, cross-shard queries, or consensus. `replica-preferred` and `replica-only` both choose a replica when one exists. |

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

Project files are validated before compilation. Phase 1 opens schema versions 1 and 2, migrates version 1 deterministically, and rejects missing, future, unknown, or structurally invalid versions. Unknown component or policy versions, invalid port semantics, duplicate identifiers, missing references, invalid fault targets, and unsupported policy targets fail with validation errors instead of being guessed or silently approximated.

The following remain explicitly out of scope for Phase 1: vendor API compatibility; packet-level emulation; production traffic replay; arbitrary user code or public plugins; real distributed clocks; service discovery; protocol details; database query planning and storage engines; Raft, Paxos, or other consensus; accounts, hosted collaboration, and multiplayer editing.

When a desired behavior is absent from this document and has no registered component, policy, event, or fault contract, the result must not be interpreted as simulating it.
