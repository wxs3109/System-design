# Component coverage

This document maps current component models to System Design learning questions. Components are bounded simulations, not usable infrastructure products. Reuse composition and add only the state/resources needed to explain a design trade-off; S3-like, map, or ride scenarios do not require building those products.

Detailed execution rules, formulas, and omissions have one authority: [Simulation model assumptions](./model-assumptions.md). The tables below summarize current coverage; planned features are identified separately.

## Classification rule

| Kind | Responsibility |
|---|---|
| Component category | Palette-level organization, such as Service, Database, or Messaging; it does not define execution |
| Behavior variant | A versioned executable model with config schema, ports, state, events, metrics, and supported faults |
| Preset | Initial config and existing policies for exactly one variant; no new schema, ports, or runtime behavior; selected inside that variant |
| Project contract | Reusable API/event definitions, data models, keys/indexes, access actions, and workload mixes, referenced by stable IDs |
| Policy | A cross-cutting modeled behavior attached to supported targets: retry, timeout, circuit breaker, rate limit, or backpressure |

Regions/zones are topology groups; metrics/traces are result views. Each node discloses its resolved variant/version and preset provenance. A new name alone does not create a new behavior. Worker currently uses a Service preset; Relational, Document, and Key-Value data contracts do not imply separate database engines. Unsupported variant semantics must not be advertised as available.

Contracts bind operations to component work and carry identity into traces. Supported fields can change costs, routing, or state; descriptive-only fields must be identified as such. An Orders table is a project contract, not a new component category.

## Current executable behaviors

The registry contains these 16 current behavior types. Database v1 remains import-compatible; Database v2 is the current palette version.

| Category | Behavior | What the model covers |
|---|---|---|
| Traffic | Traffic Generator | Constant/Poisson arrivals, payload estimates, phases, generation limits |
| Network | Network Link | Latency, jitter, per-request byte transfer, concurrency, queues, packet loss |
| Gateway & Routing | Load Balancer | Weighted, round-robin, or health-aware target selection |
| Gateway & Routing | Global Router | Explicit-Region routing, decision cache/TTL, health detection and delayed failover |
| Gateway & Routing | Realtime Gateway | Connections, channels, broadcast, per-connection outbound queues and slow-client backpressure |
| Service | Service | Replicas, concurrency, local work time, queueing and intrinsic errors |
| Messaging | Queue | Bounded request waiting and consumer-slot delivery work |
| Messaging | Stream | Partitions, offsets, consumer groups, request-triggered batch consumption and lag |
| Messaging | Topic | Retained messages, independent subscription backlog/ACK, delivery opportunities and expiry |
| Cache | Cache | Key/TTL/entry-capacity behavior, LRU/FIFO eviction, hit/miss routing |
| Cache | CDN | Per-POP cache, successful origin fill, byte-dependent delivery costs on supported paths |
| Object Storage | Object Storage | Read/write work, request capacity, object-size-based transfer costs and byte counters |
| Database | Database | Connections, sharding, read-copy selection, replication delay; operation-bound access-cost estimates |
| Database | Search Index | Document visibility delay, shard/copy selection, query fan-out and merge-cost estimates |
| Automation | Scheduler | Periodic/batch releases, jitter, skip/catch-up policy, active/pending runs |
| Automation | Workflow | In-run checkpoints, scoped idempotency, ordered steps, timeout/retry and compensation |

This list does not imply shared bandwidth, independently scheduled broker consumers, real object storage, or durable state across runs. Refer to the model assumptions for the applicable capacity-only versus operation-aware path and behavior version.

## Representative-system matrix

These are composition probes, not claims of complete application implementations. Coverage means the listed trade-offs can be studied using current models. Missing semantics require explicit scope before implementation; they are not automatically roadmap commitments.

| Design probe | Current study scope | Important missing model semantics |
|---|---|---|
| URL shortener | API/cache/database load, access costs, hotspots and failures | ID allocation, conditional writes, transactions and enforced consistency |
| Realtime chat | Connection/message capacity, channels, delivery and backpressure | Presence, reconnect/resume, cross-gateway coordination and delivery guarantees |
| Video delivery | Upload/Worker load, object bytes, CDN caching and transfer costs | Sustained/adaptive sessions, shared bandwidth, multipart/range behavior and DRM |
| Search | Indexing delay, visibility, query fan-out/merge costs and cache load | Text analysis/ranking, query language, segments and distributed failover |
| Notifications | Producer load, Topic copies/ACK, scheduled releases and backlog | Autonomous subscription consumption, filters, retry calendars and provider quotas |
| Cloud drive | Metadata and object-path load, asynchronous processing, CDN and bytes | Named object versions, resumable/multipart correctness and shared bandwidth |
| Social feed | Access patterns, cache, fan-out, partitions and hotspots | Materialized per-user feed state, ranking and enforced consistency |
| Payments | Service/Workflow attempts, scoped idempotency, compensation and failures | Transactional outbox, exactly-once side effects and restart recovery |
| Web crawler | Scheduled work, Worker/queue pressure, storage bytes and Search load | Per-host politeness, URL deduplication, robots rules and distributed coordination |
| Multi-region service | Regional routing, decision TTL, failover timing, faults and replica lag | Real routing protocols, cross-region replication links and operation placement |
| S3-like storage | API/metadata/byte-path capacity and modeled node-loss effects | Object commit/version state, fragment placement, checksums and repair lifecycle |
| Maps/navigation | Tile/cache delivery costs, query capacity and location-event load | Spatial queries, road-graph routing, traffic aggregation and dataset-version compatibility |
| Ride dispatch | Location-event load, message delivery, push and Workflow capacity | Driver/trip state, spatial matching, leases and competing assignment updates |

## Planned improvements

[Demand and Capacity Planning](./roadmap/demand-capacity-planning/README.md) is proposed, not implemented. It owns autonomous Queue/Topic delivery (DP-05/DP-12), shared transfer capacity and sessions (DP-06 through DP-08), storage forecasting/admission (DP-09/DP-10), and broader sizing/validation. These are current gaps with planned work, rather than blanket non-goals. Other omissions remain bounded by the learning-model scope; see [future extensions](./roadmap/future-extensions.md) for separately deferred platform work.

## Coverage gate

- **Behavior variants** require a concrete learning question, minimal modeled state/resources and omissions, a validated versioned manifest, deterministic events/metrics/fault semantics, and unit/property tests. At least two independent scenarios must reuse the implementation; no example-specific Canvas, compiler, runtime, reducer, or result branches.
- **Presets** require a stable ID/version referencing exactly one variant/version, schema-valid defaults, discovery inside that variant, visible import/export provenance, and a test proving equivalence to the resolved config/policies. They add no executable semantics.
- **Project contracts** require versioned schemas, stable references, referential validation, generic editing, import/export round trips, and compiler/runtime consumption. Differential tests prove that supported semantic fields change the modeled result.
- Update current coverage and model assumptions only when behavior ships. Acceptance demonstrates properties of the declared simulation and chosen experiments, not production correctness.
