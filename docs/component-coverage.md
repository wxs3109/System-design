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

## Shipped executable behaviors

Phase 1 ships nine latest-version behaviors. P2.1b organizes them into the category/variant hierarchy without inventing unsupported variants. Phase 2 has added five reusable behaviors under the same registry contract:

Phase 2 behavior expansion has also shipped Scheduler, CDN, Search Index, Topic, and Realtime Gateway. Search Index is reused by the Product Search and streaming Log Search acceptance projects and consumes the same Document Model and interaction contracts as the generic editor. Topic is likewise reused by the Order event fan-out and Incident fan-out projects to prove independent subscriber state and expiry. Realtime Gateway is reused by Realtime chat and Collaborative editing to prove connection lifecycle, shared-channel fan-out, and slow-client backpressure. None is a named preset or a case-specific page.

| Category | Behavior | Modeled boundary |
|---|---|---|
| Automation | Scheduler | Periodic/batch release, seeded jitter, missed-run policy, and concurrency limits |
| Traffic | Traffic Generator | Constant or Poisson request arrivals, size, duration, and generation cap |
| Network | Network Link | Latency, jitter, byte transfer, concurrency, queueing, and packet loss |
| Gateway & Routing | Load Balancer | Weighted, round-robin, or health-aware target selection |
| Gateway & Routing | Realtime Gateway | Long-lived connection capacity, channel membership, broadcast fan-out, independent outbound queues, and slow-client backpressure |
| Service | Service | Replicas, concurrency, service time, queueing, and intrinsic errors |
| Messaging | Queue | Bounded buffering and consumer delivery |
| Messaging | Stream | Partitions, consumer groups, batches, acknowledgement, and lag |
| Messaging | Topic | Publish fan-out, independent subscription backlog/ACK, batching, and time/size retention |
| Cache | Cache | Key distribution, TTL, capacity, LRU/FIFO eviction, and hit/miss routing |
| Cache | CDN | Deterministic POP selection, per-POP edge cache, origin fetch, and byte-dependent delivery |
| Object Storage | Object Storage | Bounded reads/writes and byte-dependent throughput |
| Database | Database | Connections, shards, primary/replica reads, and replication delay |
| Database | Search Index | Delayed indexing/refresh visibility, shard-copy query fan-out, and candidate merge |

Database v1 remains readable for compatibility; Database v2 is the current palette behavior.

## Representative-system matrix

“Covered” means the platform can already study the listed trade-offs. It does not mean production fidelity.

| Acceptance probe | Covered with shipped behaviors | Important unsupported semantics | Classification of the gap |
|---|---|---|---|
| URL shortener | API/data contracts, request path, load balancing, cache, indexed database access, hotspots, and failures | Unique-ID allocation, conditional writes, and transaction/consistency enforcement | Existing project contracts; later consistency/transaction policy where justified |
| Realtime chat | Service capacity, Realtime Gateway connections/rooms/broadcast, Topic/Stream delivery, partitions, storage, and backpressure | Presence, reconnect/resume, multi-gateway channel coordination, and protocol/delivery guarantees | Existing **Realtime Gateway** boundary; deeper session/distributed semantics require later variants or policies |
| Video delivery | Upload/transcode contracts, object storage, CDN POP/cache/origin behavior, scheduled work, bandwidth, and failures | Multipart/range transfer, adaptive bitrate sessions, shared-link contention, and DRM | Existing composition; transfer details remain explicit non-goals |
| Search | API/Document/query contracts, indexing delay, refresh/replica visibility, shard query fan-out, merge cost, cache, and read load | Analyzer/tokenizer, query DSL, relevance ranking, segments/compaction, and distributed failover | Existing **Search Index** boundary; deeper text/distributed semantics require later variants |
| Notifications | Producer service, Event contracts, independent Topic subscriptions, per-subscription backlog/ACK, retention, scheduled releases, and backpressure | Subscription filters, retry schedules, delivery calendars/rules, and provider quotas | Existing **Topic** and **Scheduler** variants plus later contracts/policies; provider is a Service variant |
| Cloud drive | File/metadata contracts, metadata database, object storage, upload service, async work, CDN delivery, and bandwidth | Multipart transfer, resumable-session correctness, object versions, and shared-link contention | Existing composition; transfer details remain explicit non-goals |
| Social feed | API/entity/access contracts, Cache, Topic/Stream fan-out, database, hotspots, and comparison | Durable per-user feed materialization, ranking, and consistency semantics | Existing composition; later contracts/variants only for independently testable gaps |
| Payments | Payment operation/entity contracts, synchronous services, database, queue, timeout, retry, and circuit breaker | Idempotency enforcement, durable step state, compensation, and transactional outbox | A **Workflow** behavior variant and later consistency policies |
| Web crawler | Crawl/Document contracts, Scheduler releases, worker capacity, queues, storage, bandwidth, Search Index, and backpressure | Per-host politeness, URL deduplication, robots semantics, and distributed crawl coordination | Existing composition plus later independently testable policies |
| Multi-region service | Regions/zones, health-aware routing, faults, and database replica delay | Operation placement, DNS/geo steering, TTL propagation, cross-region failover, and replication links | Project contracts plus a **Global Router** behavior variant; replication remains a later model |

## Cross-cutting contract layer

Phase 1 behaviors execute real capacity and failure logic, while Phase 2's `ProjectFile v3` adds the business identity that anonymous requests lacked. A Service can own API endpoints and request/response contracts; data models can declare tables or collections, typed fields, keys, and indexes; workloads can target concrete operations; and interactions bind service, cache, data, and event actions into executable paths. This was a platform-wide modeling gap, not ten missing component icons.

The shipped layer provides:

1. API and event contracts with stable operation IDs and payload schemas.
2. Data models with entities, fields, keys, indexes, relationships, cardinality, and size estimates.
3. Access patterns binding operations to service calls, cache operations, data queries/writes, and event publication.
4. Workload mixes that target concrete operation IDs and preserve key/payload distributions.
5. Runtime request context, events, traces, and metrics that consume and expose those bindings.

The acceptance gate is behavioral: indexed lookup versus scan, small versus large payload, uniform versus hot keys, and different operation mixes yield deterministic and explainable differences. Topic extends that gate to independent subscriptions: adding a subscriber multiplies fan-out copies, a failed or offline subscriber does not advance another subscriber, and retention changes expiry evidence. Realtime Gateway extends it to long-lived client state: channel membership determines fan-out, per-connection bandwidth determines drain and backlog, and the selected overflow policy determines whether a slow recipient drops a message or is disconnected.

## Prioritized additions

The order is based on how many acceptance probes each primitive unlocks and whether its semantics can be tested independently.

1. **API/Data/Access contract layer** — shipped; the cross-cutting prerequisite described above.
2. **Scheduler** — shipped; periodic and batch releases, jitter, missed-run policy, and concurrency limits.
3. **CDN** — shipped; edge cache capacity/TTL, POP selection, origin fetch, bandwidth, and hit/miss metrics.
4. **Search Index** — shipped; indexing delay, refresh visibility, shard/replica query fan-out, and merge latency.
5. **Topic** — shipped; independent subscriptions, per-subscription backlog/acknowledgement, retention, and fan-out.
6. **Realtime Gateway** — shipped; long-lived connections, rooms/channels, broadcast amplification, per-connection outbound drain, and `drop-message` / `disconnect` backpressure.
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
