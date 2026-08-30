# Component coverage audit

This audit decides whether a missing palette item needs a new simulation behavior or only a role preset. The systems below are acceptance probes for the generic platform, not case-specific pages or hard-coded topologies.

## Classification rule

The palette has exactly two executable entry kinds:

1. **Behavior component** — owns distinct runtime semantics, state transitions, events, metrics, faults, configuration validation, and deterministic tests. Adding one extends what the simulator can claim to model.
2. **Role preset** — creates an existing behavior component with a role-specific name, icon, help text, and validated defaults. It may attach existing policies through a generic recipe. It never owns a second runtime implementation and does not increase behavior coverage.

Regions and availability zones remain topology groups. Retry, timeout, circuit breaker, rate limit, and backpressure remain attachable policies. Metrics and traces remain result views. None of those should be duplicated as decorative components merely to increase the palette count.

If the existing behavior cannot truthfully represent a role, the role must remain unavailable until a behavior component or policy supplies the missing semantics. Every preset must disclose its underlying behavior in the UI and exported project.

## Shipped behavior components

Phase 1 ships nine latest-version behavior types:

| Category | Behavior | Modeled boundary |
|---|---|---|
| Traffic | Traffic Generator | Constant or Poisson request arrivals, size, duration, and generation cap |
| Network | Network Link | Latency, jitter, byte transfer, concurrency, queueing, and packet loss |
| Routing | Load Balancer | Weighted, round-robin, or health-aware target selection |
| Compute | Service | Replicas, concurrency, service time, queueing, and intrinsic errors |
| Async | Queue | Bounded buffering and consumer delivery |
| Async | Stream | Partitions, consumer groups, batches, acknowledgement, and lag |
| Data | Cache | Key distribution, TTL, capacity, LRU/FIFO eviction, and hit/miss routing |
| Data | Object Storage | Bounded reads/writes and byte-dependent throughput |
| Data | Database | Connections, shards, primary/replica reads, and replication delay |

Database v1 remains readable for compatibility; Database v2 is the current palette behavior.

## Representative-system matrix

“Covered” means the platform can already study the listed trade-offs. It does not mean production fidelity.

| Acceptance probe | Covered with Phase 1 behaviors | Important unsupported semantics | Classification of the gap |
|---|---|---|---|
| URL shortener | Request path, load balancing, cache, database, hotspots, and failures | Unique-ID allocation and conditional writes | Defer until a general consistency/transaction model is justified |
| Realtime chat | Service capacity, durable queue/stream, partitions, storage, and backpressure | Long-lived connections, presence, rooms, and broadcast fan-out | New **Realtime Gateway** behavior |
| Video delivery | Upload service, object storage, async processing, bandwidth, and failures | Edge POP cache/origin fetch and scheduled transcoding jobs | New **CDN** and **Scheduler** behaviors; transcoder is a Service preset |
| Search | API capacity, cache, storage, shards, and read load | Indexing pipeline, refresh lag, replica query fan-out, and merge cost | New **Search Index** behavior |
| Notifications | Producer service, queues, streams, retries, and backpressure | Independent subscribers, scheduled delivery, provider quotas | New **Topic** and **Scheduler** behaviors; provider is a Service preset |
| Cloud drive | Metadata database, object storage, upload service, async work, and bandwidth | Edge delivery, multipart/resumable transfer, and object version semantics | New **CDN** behavior first; transfer details remain explicit non-goals |
| Social feed | Cache, fan-out edges, stream/queue, database, hotspots, and comparison | Durable fan-out bookkeeping and ranking-specific semantics | Existing composition plus Service/Worker presets; add no case-specific behavior |
| Payments | Synchronous services, database, queue, timeout, retry, and circuit breaker | Idempotency keys, durable workflow state, compensation, and transactional outbox | New **Workflow** behavior and later consistency policies |
| Web crawler | Traffic, worker capacity, queues, storage, bandwidth, and backpressure | Periodic scheduling, per-host politeness, deduplication, and searchable indexing | New **Scheduler** and **Search Index** behaviors; crawler is a Worker preset |
| Multi-region service | Regions/zones, health-aware routing, faults, and database replica delay | DNS/geo steering, TTL propagation, cross-region failover, and replication links | New **Global Router** behavior; replication remains a later model |

## Prioritized additions

The order is based on how many acceptance probes each primitive unlocks and whether its semantics can be tested independently.

1. **Scheduler** — periodic and batch releases, jitter, missed-run policy, and concurrency limits.
2. **CDN** — edge cache capacity/TTL, POP selection, origin fetch, bandwidth, and hit/miss metrics.
3. **Search Index** — indexing delay, refresh visibility, shard/replica query fan-out, and merge latency.
4. **Topic** — independent subscriptions, per-subscription backlog/acknowledgement, retention, and fan-out.
5. **Realtime Gateway** — connections, rooms/channels, broadcast amplification, and connection backpressure.
6. **Workflow** — durable step state, idempotency, bounded retry, timeout, and compensation.
7. **Global Router** — geo/weighted/health routing, cached decisions, TTL, and failover delay.

These are behavior contracts, not vendor products. API Gateway, Worker, Function, SQL Store, NoSQL Store, transcoder, crawler, ranking service, and notification provider should begin as role presets when their documented boundary is faithfully covered by an existing behavior. A Function must become a behavior component only when cold starts, scale-to-zero, concurrency allocation, or billing are actually modeled.

## Coverage gate

A behavior addition is accepted only when it provides:

- a versioned manifest and validated configuration;
- deterministic runtime semantics, events, metrics, and fault behavior;
- unit and property tests for its invariants;
- at least two acceptance probes that use the same implementation;
- no case-specific canvas, reducer, or result page.

A role preset is accepted only when it provides:

- a stable preset ID/version and an explicit underlying behavior type/version;
- defaults that pass the underlying component schema;
- no runtime dispatch, schema, port, metric, or fault implementation of its own;
- import/export round-trip and a visible “uses … behavior” disclosure;
- a test proving its execution is equivalent to the resolved base component plus declared policies.
