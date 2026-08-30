# Component coverage audit

This audit decides whether a capability belongs to a component category, an executable behavior variant, an optional preset, a reusable project contract, or a policy. The systems below are acceptance probes for the generic platform, not case-specific pages or hard-coded topologies.

## Classification rule

The platform distinguishes five kinds of reusable definition:

1. **Component category** — the top-level architectural building block shown in the palette, such as Service, Database, Cache, or Messaging. It organizes discovery but does not by itself claim runtime behavior.
2. **Behavior variant** — a versioned executable form inside exactly one category. It owns configuration validation, ports, state transitions, events, metrics, faults, and deterministic tests. Adding one extends what the simulator can claim to model.
3. **Preset** — an optional starting configuration for exactly one variant. It may provide a role-specific name, help text, validated defaults, and existing policies, but owns no schema extension, ports, runtime dispatch, events, metrics, or faults. It is chosen inside its variant flow, never listed as a peer top-level component.
4. **Project contract** — describes what components process and how they interact: API/event operations, payload schemas, tables/collections, typed fields, keys, indexes, relationships, access patterns, and operation-level workload mixes. Contracts use stable project-level IDs and are referenced by compatible nodes and edges.
5. **Policy** — attaches reusable cross-cutting runtime behavior such as retry, timeout, circuit breaker, rate limit, or backpressure to a compatible node or edge.

Regions and availability zones remain topology groups. Metrics and traces remain result views. None of these should be duplicated as decorative components merely to increase the palette count.

Relational, Document, and Key-Value are potential Database behavior variants because their data and query semantics differ. API Service and Worker may be Service variants when their execution semantics differ. Names such as “read-heavy SQL cluster” are presets only when they change defaults rather than semantics. If a category cannot truthfully support a proposed variant, that variant remains unavailable until its generic semantics exist. Every node discloses its category, resolved variant, and optional preset provenance in the UI and exported project.

Project contracts are not component variants. Defining an Orders table once and referencing it from Database access steps is different from creating a new Orders Database component. A contract counts as implemented only when changing it produces a deterministic, explainable runtime difference.

## Shipped Phase 1 behaviors

Phase 1 ships nine latest-version behaviors. P2.1b will organize them into the category/variant hierarchy without inventing unsupported variants:

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
| URL shortener | Request path, load balancing, cache, database, hotspots, and failures | API operations, URL table/collection, key/index access, unique-ID allocation, and conditional writes | Project contracts first; later consistency/transaction policy where justified |
| Realtime chat | Service capacity, durable queue/stream, partitions, storage, and backpressure | Message/event contracts, long-lived connections, presence, rooms, and broadcast fan-out | Project contracts plus a **Realtime Gateway** behavior variant |
| Video delivery | Upload service, object storage, async processing, bandwidth, and failures | Upload/transcode operation contracts, edge POP origin fetch, and scheduled jobs | Project contracts plus **CDN** and **Scheduler** behavior variants; transcoder is a Service variant |
| Search | API capacity, cache, storage, shards, and read load | Document/query contracts, indexing pipeline, refresh lag, replica query fan-out, and merge cost | Project contracts plus a **Search Index** behavior variant |
| Notifications | Producer service, queues, streams, retries, and backpressure | Notification/event contracts, independent subscribers, scheduled delivery, and provider quotas | Project contracts plus **Topic** and **Scheduler** behavior variants; provider is a Service variant |
| Cloud drive | Metadata database, object storage, upload service, async work, and bandwidth | File API/metadata contracts, edge delivery, multipart transfer, and object versions | Project contracts plus a **CDN** behavior variant; transfer details remain explicit non-goals |
| Social feed | Cache, fan-out edges, stream/queue, database, hotspots, and comparison | Feed API/entities/access paths, durable fan-out bookkeeping, and ranking semantics | Project contracts plus existing composition and Service variants; no case-specific behavior |
| Payments | Synchronous services, database, queue, timeout, retry, and circuit breaker | Payment operations/entities, idempotency keys, durable workflow, compensation, and transactional outbox | Project contracts plus a **Workflow** behavior variant and later consistency policies |
| Web crawler | Traffic, worker capacity, queues, storage, bandwidth, and backpressure | Crawl/document contracts, periodic scheduling, per-host politeness, deduplication, and indexing | Project contracts plus **Scheduler** and **Search Index** behavior variants; crawler is a Service variant |
| Multi-region service | Regions/zones, health-aware routing, faults, and database replica delay | Operation placement, DNS/geo steering, TTL propagation, cross-region failover, and replication links | Project contracts plus a **Global Router** behavior variant; replication remains a later model |

## Cross-cutting contract gap

Phase 1 behaviors execute real capacity and failure logic, but requests are still effectively anonymous. A Service cannot declare API endpoints and request/response contracts; a Database cannot declare tables or collections, typed fields, keys, or indexes; a workload cannot target a concrete operation; and the runtime cannot explain which query or access path caused a cost. This is a platform-wide modeling gap, not ten missing component icons.

Before the prioritized infrastructure behaviors below, Phase 2 must add:

1. API and event contracts with stable operation IDs and payload schemas.
2. Data models with entities, fields, keys, indexes, relationships, cardinality, and size estimates.
3. Access patterns binding operations to service calls, cache operations, data queries/writes, and event publication.
4. Workload mixes that target concrete operation IDs and preserve key/payload distributions.
5. Runtime request context, events, traces, and metrics that consume and expose those bindings.

The acceptance gate is behavioral: indexed lookup versus scan, small versus large payload, uniform versus hot keys, and different operation mixes must yield deterministic and explainable differences.

## Prioritized additions

The order is based on how many acceptance probes each primitive unlocks and whether its semantics can be tested independently.

1. **API/Data/Access contract layer** — the cross-cutting prerequisite described above.
2. **Scheduler** — periodic and batch releases, jitter, missed-run policy, and concurrency limits.
3. **CDN** — edge cache capacity/TTL, POP selection, origin fetch, bandwidth, and hit/miss metrics.
4. **Search Index** — indexing delay, refresh visibility, shard/replica query fan-out, and merge latency.
5. **Topic** — independent subscriptions, per-subscription backlog/acknowledgement, retention, and fan-out.
6. **Realtime Gateway** — connections, rooms/channels, broadcast amplification, and connection backpressure.
7. **Workflow** — durable step state, idempotency, bounded retry, timeout, and compensation.
8. **Global Router** — geo/weighted/health routing, cached decisions, TTL, and failover delay.

These are generic behavior variants and project contracts, not vendor products. API Gateway, Worker, Function, SQL Database, NoSQL Database, transcoder, crawler, ranking service, and notification provider are offered only when an owning category has a variant that faithfully covers their documented boundary. A role name alone is at most a preset. Function becomes a distinct behavior variant only when cold starts, scale-to-zero, concurrency allocation, or billing are actually modeled.

## Coverage gate

A behavior-variant addition is accepted only when it provides:

- a versioned manifest and validated configuration;
- deterministic runtime semantics, events, metrics, and fault behavior;
- unit and property tests for its invariants;
- at least two acceptance probes that use the same implementation;
- no case-specific canvas, reducer, or result page.

A preset is accepted only when it provides:

- a stable preset ID/version and exactly one owning variant ID/version;
- defaults that pass the owning variant schema;
- discoverability within its variant rather than as a peer top-level palette item;
- no runtime dispatch, schema, port, metric, or fault implementation of its own;
- import/export round-trip and visible variant disclosure;
- a test proving its execution is equivalent to the resolved variant plus declared defaults and policies.

A project-contract addition is accepted only when it provides versioned validation, stable references, referential-integrity diagnostics, import/export round trips, generic editors, compiler/runtime consumption, and differential tests proving semantic changes affect measured results.
