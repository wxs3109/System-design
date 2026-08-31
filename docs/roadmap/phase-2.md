# Phase 2 Implementation Plan

> Status: core implementation complete through P2.6g. P2.7 through P2.10 have moved to the deferred [Future Extension Roadmap](./future-extensions.md) and are not current personal-use commitments.

## 1. Outcome

Phase 2 turns the Phase 1 capacity and failure simulator into a business-aware System Design workbench. Users must be able to define what an API accepts, what a service does, what data a store owns, which indexes and keys support an access pattern, which events are published, and how traffic is split across those operations. The simulator must execute those definitions instead of sending anonymous requests through decorative nodes.

At the end of Phase 2, users can:

- choose a component category, then a truthful behavior variant and optional preset;
- define reusable API, data, event, and interaction contracts without writing application code;
- bind workload mixes to named operations and inspect operation-specific traces and metrics;
- measure the effects of indexes, scans, payload sizes, hot keys, read/write mixes, caches, queues, and failures;
- assemble representative systems without case-specific editor or runtime branches;
- retain a documented future path toward SDKs, isolated plugins, batch experiments, and shared artifacts without making those platform capabilities part of the current personal-use completion gate.

Detailed scope evidence: [Component coverage audit](../component-coverage.md). Current runtime limits remain documented in [Simulation model assumptions](../model-assumptions.md).

## 2. Product taxonomy

The product uses three different concepts. They must not be flattened into parallel palette items.

1. **Component category** is the architectural building block shown in the primary palette, such as Service, Database, Cache, Messaging, Gateway, Network, or Object Storage. It owns discovery and grouping, not runtime behavior.
2. **Behavior variant** is a versioned executable form inside a category. It owns configuration validation, ports, runtime semantics, events, metrics, and supported faults. Examples include Relational Database, Document Database, Key-Value Store, API Service, and Worker. If SQL and NoSQL differ in schema, query, consistency, or cost behavior, they are variants rather than presets.
3. **Preset** is an optional named starting configuration for exactly one variant. It may provide validated defaults and attach existing policies, but it adds no ports, schema rules, runtime dispatch, metrics, or claims of capability. Presets appear only inside the category/variant creation flow or as a configuration action; they never occupy a top-level palette section.

The runtime executes a resolved behavior variant. Removing a preset catalog must not make an exported project unexecutable. A variant may be offered only after its claimed semantics are implemented and tested. Vendor product names are adapters or presets only when the generic variant can represent them truthfully.

## 3. Non-negotiable rules

1. Every visible semantic claim must be executable, or explicitly marked as documentation-only and excluded from simulated conclusions.
2. Palette count is not progress. Decorative aliases, vendor logos, and differently named copies of one behavior do not increase coverage.
3. API, data, event, and interaction definitions are project-level, versioned resources referenced by stable IDs. They do not live as unstructured blobs inside an individual node's `config`.
4. A field that claims to affect performance or correctness must be consumed by compilation/runtime and covered by a result-changing test.
5. Topology describes deployable structure; contracts describe business meaning; experiments describe workload and faults. Layout pixels affect none of them.
6. Built-in and external variants use the same manifest, compiler, event, metric, fault, and compatibility contracts.
7. Reuse React Flow, Zod, SimScript, Web Workers, ECharts, Zustand, and Dexie. Reuse OpenAPI, JSON Schema, and database-schema tooling through adapters after a bounded compatibility spike; do not build general-purpose parsers, form engines, or graph editors from scratch.
8. Unknown category, variant, preset, policy, contract, or package versions fail with actionable errors. Runtime meaning is never guessed.
9. Existing project files remain importable through explicit, deterministic migrations. Migrations never invent APIs, tables, indexes, or interactions that did not exist.
10. Each settlement is implemented, verified, and committed independently before the next settlement begins.

## 4. Compatibility direction

`ProjectFile v2` remains supported as the capacity-only format shipped by Phase 1. `ProjectFile v3` adds the business contract catalogs and references required for operation-aware simulation. Importing v2 into v3 preserves its current anonymous-request behavior and creates no fake business definitions. Capacity-only projects remain visibly identified as such.

The existing `RolePresetManifest` and resolved-node representation are reusable implementation foundations, but the separate “Role presets” palette shipped in P2.1 is transitional UI. Existing preset metadata continues to round-trip for compatibility. New projects use category, variant, and optional preset provenance; execution never depends on preset availability.

SQL Store and NoSQL Store cannot claim distinct database semantics while both resolve to the same generic database behavior. New creation must either describe them honestly as capacity templates or withhold those names until Relational, Document, and Key-Value variants implement their differences. Existing saved nodes retain their resolved Phase 1 behavior.

## 5. Settlements

### P2.0 — Initial coverage audit

Deliverables:

- [x] inventory the nine Phase 1 behavior types;
- [x] establish that aliases and vendor names do not count as behavior coverage;
- [x] audit representative systems for missing reusable infrastructure behaviors;
- [x] document the initial compatibility direction.

Status: complete as an initial infrastructure audit. The later business-model review found a more fundamental prerequisite: named APIs, data models, events, access patterns, and operation-aware workloads must exist before adding more infrastructure icons.

### P2.1a — Preset registry foundation

Deliverables:

- [x] versioned preset manifest and registry;
- [x] optional preset provenance on resolved project nodes;
- [x] validated creation from a base behavior plus configuration overrides;
- [x] migration, JSON round-trip, equivalence, and browser tests;
- [x] visible disclosure that a preset currently uses an existing behavior.

Status: implementation complete. The registry and compatibility work remain useful, but the separate preset palette and SQL/NoSQL naming do not satisfy the revised product taxonomy. P2.1b corrects that presentation before new semantic work begins.

### P2.1b — Component hierarchy and palette correction

Deliverables:

- [x] introduce explicit category, behavior-variant, and preset contracts;
- [x] show only component categories in the primary palette;
- [x] choose a variant and optional preset within the add/configure flow;
- [x] remove the separate top-level preset section;
- [x] preserve old preset provenance without making runtime depend on it;
- [x] remove or relabel claims such as SQL Store, NoSQL Store, and API Gateway when only generic Phase 1 behavior exists;
- [x] add keyboard, import/export, migration, and browser coverage for the hierarchy.

Status: complete. New creation follows category → executable variant → optional active preset. Legacy API Gateway, SQL, and NoSQL capacity templates remain import-compatible but cannot be selected or created through public creation commands.

Exit criteria: a user starts with “Database” and then chooses only among implemented variants; deleting every preset leaves the same project executable; no top-level palette item is merely a renamed copy of another runtime behavior.

### P2.2 — ProjectFile v3 business contracts

Deliverables:

- [x] versioned API catalog with stable operation IDs, HTTP method/path, request/response JSON Schema references, payload estimates, ownership, and optional SLO targets;
- [x] versioned data-model catalog with discriminated Relational, Document, and Key-Value definitions;
- [x] relational tables, typed columns, nullability, primary/unique/foreign keys, indexes, cardinality, and row-size estimates;
- [x] document collections, JSON Schema, partition keys, secondary indexes, cardinality, and document-size estimates;
- [x] key/value schemas, key distribution, value-size estimates, TTL, and consistency hints;
- [x] versioned event catalog with event name/version, payload JSON Schema, partition/ordering key, producer, and consumers;
- [x] interaction/access-pattern catalog whose typed actions reference topology nodes, API operations, data objects/indexes, cache keys, and event contracts;
- [x] workload operation mixes with weights, key/value distributions, payload overrides, and arrival phases;
- [x] deterministic v2-to-v3 migration, reference validation, serialization, and compatibility fixtures.

Status: complete. `ProjectFile v3` now separates topology, normalized business definitions, and experiments; distinguishes `capacity-only` from `business-aware`; validates cross-resource and topology references; and includes a serialization-stable order-system contract fixture. Version 1 and 2 imports migrate deterministically to capacity-only v3 without inventing contracts, while their Phase 1 executable scenarios remain unchanged. These contracts are intentionally not executed yet: P2.3 makes them generically editable and P2.4 gives them runtime meaning.

Contracts are normalized internal domain objects. OpenAPI 3.1, JSON Schema 2020-12, and DBML are import/export formats behind adapters, not unvalidated arbitrary objects copied into runtime state.

Exit criteria: a v3 fixture can express an API operation, its service owner, a relational or non-relational data model, its access steps, an emitted event, and a workload mix. Invalid method/path pairs, duplicate IDs, broken references, invalid index fields, and incompatible targets fail validation. Existing v2 fixtures retain their exact Phase 1 execution meaning.

### P2.3 — Contract and interaction editors

Deliverables:

- [x] a project-level Definitions explorer for APIs, data models, events, cache keys, interactions, and operation workloads;
- [x] Service editing for operations, request/response schemas, handler estimates, SLOs, and ownership;
- [x] Database editing that changes with the selected Relational, Document, or Key-Value variant;
- [x] table/collection fields, keys, indexes, cardinality, and size editors with inline reference errors;
- [x] event schema, producer, consumer, key, and delivery-assumption editing;
- [x] an operation-focused overlay on the existing topology for binding typed calls, reads, writes, cache actions, and publishes without creating a second disconnected diagram;
- [x] workload mix editing against named operations, including arrival, key, payload, and value-size distributions;
- [x] OpenAPI and DBML import/export plus JSON Schema editing through selected mature libraries;
- [x] autosave, undo/redo, keyboard navigation, and large-form performance coverage.

The settlement starts with a time-boxed dependency spike. Selection gates include OpenAPI 3.1 and JSON Schema 2020-12 correctness, editable arrays/unions/references, browser and Worker compatibility, maintained licensing, bundle cost, accessibility, and round-trip fidelity. Candidates include Swagger Parser or Redocly CLI for OpenAPI, JSON Forms or RJSF for schema-driven forms, and `@dbml/core` for DBML conversion. Node-only tools may be used in an import/export boundary but cannot be assumed to run in the browser. Failed candidates are recorded; a thin adapter prevents library types from becoming the project model.

Exit criteria: using only the generic UI, a user can create and edit the complete P2.2 fixture, see contract errors before running, export it, reload it, and obtain a structurally identical project. Presets remain nested under their variant chooser.

Status: complete. Definitions and topology are two views over the same `ProjectFile v3`; invalid drafts stay local with field paths while valid edits enter the shared undo/autosave/export history. The existing topology becomes the interaction binding overlay rather than a second diagram. OpenAPI 3.1 uses Scalar validation and DBML uses `@dbml/core` in Node-only routes documented in [ADR-001](../decisions/adr-001-format-adapters.md), keeping parser implementations out of the browser and simulation Worker.

### P2.4 — Operation-aware compiler and runtime

Deliverables:

- [x] compile each workload operation into a validated executable interaction plan;
- [x] carry operation ID, payload size, entity/data-object ID, action, key/partition value, query shape, and event identity in request context;
- [x] route only across edges and ports bound to the active interaction instead of broadcasting one anonymous request shape;
- [x] execute API-specific service cost and downstream actions;
- [x] execute database point lookup, indexed lookup, range access, scan, insert, update, and delete cost models against declared cardinality, estimated rows, row/document size, index availability, shards, and replicas;
- [x] execute named cache-key and event publish/consume actions with existing cache/stream/queue primitives;
- [x] emit operation- and action-specific spans, events, metrics, warnings, and explanations;
- [x] keep all stochastic choices deterministic under project, engine, run, and seed identity;
- [x] clearly reject or label contract fields that remain descriptive and do not yet affect execution.

The database model remains an explainable system-design approximation, not a SQL optimizer or storage-engine emulator. Its formulas, supported query shapes, transaction limits, and consistency assumptions must be documented and calibrated through editable parameters.

Exit criteria: changing an operation mix, removing a supporting index, increasing cardinality or payload size, introducing a hot partition key, or changing a cache path produces deterministic and directionally justified changes in latency, throughput, queueing, shard load, and traces. No order-specific or case-specific runtime branch is allowed.

Status: complete. The generic compiler resolves operation workloads to versioned API/interaction plans, infers caller context from prior actions, validates synchronous versus asynchronous topology paths, and preserves capacity-only execution. The runtime executes ordered and conditional actions through real component resources, queues and faults; database costs, named cache operations, and event payloads feed operation/action telemetry. Results expose operation counts and p95 latency plus per-action duration, records examined, and bytes processed. Unsupported contract semantics produce descriptive warnings and are bounded in [Simulation model assumptions](../model-assumptions.md). P2.5 now owns the full order-system browser acceptance and comparative scenarios.

Deferred integration boundary: P2.4 does not yet compose edge retry/circuit-breaker policies, async backpressure gates, or load-balancer selection into operation action paths, and action failures terminate an operation before a reserved `failure` condition can recover it. These limits are explicit in the model assumptions and must be closed before Phase 2 is considered done; they do not change the completed P2.4 contract-to-runtime vertical slice.

### P2.5 — Generic vertical acceptance: order system

Deliverables:

- [x] model `POST /orders`, `GET /orders/{id}`, and an indexed customer-order query;
- [x] define Orders and OrderItems tables with typed columns, keys, relationships, cardinality, and indexes;
- [x] model order creation writes followed by `OrderCreated` publication and worker consumption;
- [x] model cache-aside order reads with explicit hit and miss actions;
- [x] compare indexed versus scan queries, uniform versus hot-customer keys, cache configurations, and different read/write mixes;
- [x] provide browser acceptance, deterministic runtime, result-explanation, import/export, and migration tests.

Exit criteria: the example is stored only as a normal v3 project fixture created from generic contracts. Every displayed result derives from runtime events. Removing the fixture leaves all editor and simulation capabilities intact.

Status: complete. The normal order-system v3 project now contains three named operations, typed Orders and OrderItems tables with a foreign key and supporting indexes, creation/event and cache-aside interactions, and a weighted operation workload. Deterministic acceptance tests compare index versus scan cost, uniform versus hot keys, cache-aside versus direct database reads, and read-heavy versus write-heavy mixes. The browser loads the same fixture through the ordinary example picker and exposes operation/action identity, metrics, traces, and export/import behavior; no order-specific compiler, runtime, or editor dispatch exists.

### P2.6 — Reusable behavior expansion

Wave one:

- [x] Scheduler with periodic/batch releases, jitter, missed-run policy, and concurrency limits;
- [x] CDN with POP selection, edge cache/origin fetch, bandwidth, and hit/miss behavior;
- [x] Search Index with indexing delay, refresh visibility, shard/replica query fan-out, and merge cost.

Wave two:

- [x] Topic with independent subscription state and retention;
- [x] Realtime Gateway with connection, channel, broadcast, and backpressure behavior;
- [x] Workflow with durable steps, idempotency, timeout, retry, and compensation;
- [x] Global Router with geo/weighted/health routing, cached decisions, TTL, and failover delay.

Exit criteria: every variant owns distinct tested runtime semantics, changes measured results under parameter changes, integrates with the v3 contracts where relevant, and is reused by at least two representative systems.

P2.6a status: complete. Scheduler is an Automation source variant rather than a Service preset. It releases anonymous topology requests or an attached v3 operation mix on its own periodic/batch clock. Seeded bounded jitter, skip/catch-up behavior, concurrency and pending limits produce scheduler events and node metrics. Focused tests reuse it for a direct scheduled service, a Queue/Worker/Database batch pipeline, and a scheduled v3 report operation.

P2.6b status: complete. CDN is a Cache-category behavior variant rather than a preset. It deterministically selects an edge POP by rendezvous hash or round robin, keeps independent bounded TTL caches per POP, routes hits to the edge response path, routes misses to the explicit origin path, and fills only after a successful origin dependency. Edge delivery and origin transfer time use the configured object bytes and bandwidth; POP distribution, cache outcomes, origin fetches, byte counters, evictions, expirations, and hit rate are emitted as runtime evidence. Video delivery and cloud-drive-shaped object delivery reuse the same behavior.

P2.6c status: complete. Search Index is an executable Database-category variant rather than a preset. Document-model collections provide initial cardinality and document bytes; successful insert, update, and delete actions enter an indexing queue and become primary-visible only after indexing delay plus the next refresh boundary, then replica-visible after the configured replica delay. Queries fan out once per primary shard, round-robin across primary/replica copies, merge bounded candidates, and expose stale reads, visibility lag, backlogs, visible documents, shard searches, candidates, bytes, and explanations through runtime evidence. Query coordination, fan-out, per-shard search, candidate merge, index-write throughput, queueing, failures, and faults all affect measured results. Product Search and streaming Log Search are ordinary v3 projects reusing this behavior. Analyzer/tokenizer behavior, relevance scoring, query DSL, Lucene segments, compaction, distributed consensus, and shard relocation remain outside this model.

P2.6d status: complete. Topic is an executable Messaging-category variant rather than a preset. Each successful publish creates a retained message and an independent delivery copy for every configured subscription slot. Topology-ordered async edges map to stable slots; fewer edges leave offline subscriptions accumulating backlog, while too many fail compilation. Batch delivery, auto or explicit acknowledgement, downstream-success settlement, downstream-failure release, delivery delay, and both time and retained-message-capacity expiry change runtime results. Published bytes, fan-out copies, unique retained messages, aggregate/per-subscription backlog and in-flight state, delivery attempts, acknowledgements, and expiry causes are runtime evidence. Ordinary Order event fan-out and Incident fan-out v3 projects reuse the same Event/Interaction contracts and generic editor/runtime. Topic does not claim broker persistence, subscriber filters, autonomous polling, timed retry, ordering enforcement, deduplication, replication, or exactly-once delivery.

P2.6e status: complete. Realtime Gateway is an executable Gateway-category variant rather than a Load Balancer preset. A v3 `realtime` interaction action can connect and join a generated client to a channel, broadcast bytes to current channel members, or disconnect that client. The runtime enforces long-lived connection capacity and expiry, per-connection channel limits, message-processing capacity, independent FIFO outbound byte queues, normal/slow-client bandwidth, and either `drop-message` or `disconnect` overflow handling. Broadcast cost grows with the member count, while active/peak/rejected/expired connections, memberships, broadcasts, fan-out copies, delivered and pending bytes, dropped copies, and overflow disconnects remain runtime evidence even when request traces are capped. Realtime chat and Collaborative editing are ordinary business-aware projects that reuse the same generic action editor, compiler, runtime, and result reducers. The model does not claim WebSocket protocol frames or handshakes, presence, authentication, reconnect/resume, acknowledgements, delivery ordering/exactly-once guarantees, multi-gateway routing, broker durability, or cross-node channel coordination.

P2.6f status: complete. Workflow is an executable Automation-category variant rather than a Service preset or a relabeled interaction. A versioned Workflow Definition owns an ordered list of Service activities; each activity can bind a named API operation and declares its own timeout, fixed/capped-exponential retry policy, seeded jitter, and optional compensation activity. A v3 `workflow` action binds that definition to its owning node and derives an idempotency key from the request ID and sampled workload key. The runtime preserves execution, attempt, checkpoint, deadline, retry, and compensation history for the life of the run. Reusing a definition/key returns the stored execution without rerunning completed work; an in-flight duplicate waits for that execution's terminal result. Exhausting a forward step compensates previously completed compensatable steps in reverse order, and rollback continues best-effort after a compensation exhausts its own retries. Payment checkout and compensating Order fulfillment are distinct ordinary business-aware projects that reuse the same generic editor/compiler/runtime; capacity-only projects execute a synthetic single durable step through the same state owner. Instance/step/retry/timeout/compensation/idempotency aggregates remain exact when traces are capped. This is an in-run deterministic saga approximation, not a disk-backed workflow service: there is no cross-run recovery, arbitrary DAG/parallelism, signals or timers, human tasks, child workflow, distributed transaction, exactly-once side effect, version migration, or worker leasing.

P2.6g status: complete. Global Router is an executable Gateway-category variant rather than a Load Balancer preset. It resolves client and route-target locations only from explicit Region groups; canvas coordinates never imply geography, geo targets must have one unambiguous Region, and geo clients without one use weighted fallback. Geo, weighted, and health-aware policies select only synchronous weighted-one route edges, with seeded edge-weight selection. One decision is cached per workload cohort until its configured TTL, so a cached route intentionally remains stale after a target failure. Health-aware routing samples terminal target outcomes at the configured interval, applies unhealthy and healthy thresholds, waits the configured propagation delay before excluding a target, and probes unhealthy targets for recovery. Route selection/cache/expiry, target health/recovery, failover, cache hit rate, geo matches, target selections, and maximum/cumulative failover delay remain runtime evidence even when request traces are disabled. Global storefront and Multi-region failover are ordinary capacity-only projects that reuse the same editor/compiler/runtime. The model is an explainable control-plane approximation, not DNS, Anycast/BGP, latency-based geography, an active distributed health-check service, traffic-manager quorum, or cross-region data replication.

## 6. Deferred future extensions

P2.7 SDK extraction, P2.8 plugin loading and isolation, P2.9 batch experiments, and P2.10 sharing and adapters are retained as possible future platform work in the [Future Extension Roadmap](./future-extensions.md). They are intentionally deferred while the product is used and stabilized as a local, single-user workbench.

These settlements do not gate the current Phase 2 core. Resume one only when concrete personal-use evidence or a deliberate product-priority change justifies its added complexity.

## 7. Verification strategy

- Schema and property tests cover IDs, references, migrations, round trips, and generated valid/invalid contracts.
- Taxonomy tests prove that categories contain variants, presets belong to exactly one variant, and preset removal cannot alter execution.
- Adapter contract tests use official OpenAPI/JSON Schema/DBML fixtures and preserve supported round trips.
- Compiler tests reject unresolved and incompatible interaction actions before runtime.
- Runtime tests cover named operations, query shapes, indexes/scans, cardinality, key distributions, payload sizes, caches, events, overload, and faults.
- Metamorphic tests assert directional properties, such as a supported selective index touching no more records than the equivalent scan.
- Determinism tests replay the same v3 project and seed into the same ordered event stream.
- Browser tests build the order fixture through generic editors and inspect actual operation-specific traces and metrics.
- Compatibility tests keep ProjectFile v1/v2 imports and capacity-only semantics executable.

Each settlement runs its focused tests plus the complete `pnpm check` gate before commit. Documentation and model assumptions are updated in the same settlement whenever executable meaning changes.

## 8. Phase 2 core definition of done

- [x] the palette follows category → variant → optional preset, with no separate preset shelf;
- [x] ProjectFile v3 represents APIs, data models, events, interactions, and operation-aware workloads;
- [x] those contracts affect compilation, runtime events, traces, and measured results rather than only decorating forms;
- [x] the generic order-system acceptance project proves the end-to-end workflow;
- [x] representative systems use shared behavior variants without case-specific runtime or editor branches;
- [ ] operation-aware action paths compose the documented routing, reliability-policy, asynchronous backpressure, and failure-recovery behavior instead of bypassing those shared execution semantics;
- [x] Phase 1 projects preserve their documented execution meaning;
- [x] the complete current `pnpm check` suite passes.

Future SDK, plugin-isolation, batch, and sharing criteria belong to the future roadmap and do not block this definition of done.

## 9. Current execution order

P2.6 is complete through P2.6g Global Router. The current priority is personal-use stabilization: first close the deferred P2.4 operation-aware execution boundary, then improve the run controls and workflows that become painful during real use. Prefer fixes, model consistency, and everyday usability over new infrastructure variants.

P2.7 and later settlements remain paused future extensions. Do not begin them unless they are explicitly reprioritized after concrete use demonstrates a need for third-party variants, plugin loading, automated parameter sweeps, or shared/server-run artifacts.
