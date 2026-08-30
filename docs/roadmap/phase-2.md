# Phase 2 Implementation Plan

## 1. Outcome

Phase 2 turns the Phase 1 simulator into a broader and externally extensible component platform. It first proves the abstraction against missing, reusable system primitives; only then does it publish an SDK and load third-party packages.

At the end of Phase 2, users must be able to choose clearly separated behavior components and role presets, build all representative systems in the coverage audit, install a versioned component package without editing the workbench core, and run isolated batch experiments using the same project/result contracts.

Detailed scope evidence: [Component coverage audit](../component-coverage.md).

## 2. Non-negotiable rules

1. A behavior component adds real runtime semantics; a role preset only resolves to existing behavior and optional existing policies.
2. Palette count is not progress. Decorative aliases and vendor logos do not count as behavior coverage.
3. Project files store the resolved behavior type/version. Preset identity is optional versioned metadata and can never change runtime meaning silently.
4. Unknown behavior, preset, policy, or package versions fail safely. No fallback may guess executable semantics.
5. Built-in and external components use the same manifest, compiler, event, metric, and fault contracts.
6. Reuse React Flow, Zod, SimScript, Web Workers, ECharts, Zustand, and Dexie; Phase 2 does not build replacement infrastructure.
7. Each implementation settlement is verified and committed before the next one begins.

## 3. Compatibility decision

`ProjectFile v2` remains the executable format while optional role-preset metadata is added. Existing v1 migrations and v2 files remain valid. A preset resolves at creation/import time to a normal component node containing the base behavior `type`, `componentVersion`, and validated `config`.

The compiler and runtime execute only that resolved behavior. Removing the preset catalog must not make an otherwise valid project impossible to run; it may only remove role-specific presentation. If a future extension cannot preserve this rule, it requires a new project schema version and an explicit migration.

## 4. Settlements

### P2.0 — Coverage and classification

Deliverables:

- [x] inventory the nine shipped behavior types;
- [x] define behavior-component versus role-preset acceptance rules;
- [x] audit ten representative systems;
- [x] prioritize missing reusable behaviors;
- [x] define the compatibility direction for preset metadata.

Status: planning complete. This settlement changes scope and documentation only; it does not claim new runtime behavior.

### P2.1 — Role preset registry

Deliverables:

- [x] versioned `RolePresetManifest` and registry;
- [x] optional preset ID/version on project nodes without changing resolved behavior identity;
- [x] generic creation path for validated configuration overrides;
- [x] separate “Behaviors” and “Role presets” palette sections;
- [x] initial truthful presets: Client, API Gateway (routing boundary), Worker, SQL Store, and NoSQL Store;
- [x] visible base-behavior disclosure in palette, node details, and properties;
- [x] migration, JSON round-trip, equivalence, and browser tests.

Status: complete. Presets resolve to ordinary behavior nodes, unknown removed presets degrade to their stored base behavior, known mismatches fail validation, and the complete `pnpm check` gate covers creation, editing, export, compatibility, and disclosure. Policy recipes remain deferred until a preset needs one; they must reuse the existing Policy Registry rather than extend preset runtime semantics.

Exit criteria: deleting all preset manifests leaves exported nodes executable as their resolved base behaviors, and adding a preset requires no editor or runtime case branch.

### P2.2 — Behavior wave one

Deliverables:

- [ ] Scheduler;
- [ ] CDN;
- [ ] Search Index;
- [ ] reusable manifests, state machines, events, metrics, faults, and explanations;
- [ ] video, search, notification, cloud-drive, and crawler acceptance fixtures.

Exit criteria: each behavior changes measured results under parameter changes and is reused by at least two acceptance probes.

### P2.3 — Behavior wave two

Deliverables:

- [ ] Topic with independent subscription state;
- [ ] Realtime Gateway with connection and broadcast amplification;
- [ ] Workflow with durable steps and compensation;
- [ ] Global Router with cached routing and failover delay;
- [ ] chat, payment, notification, and multi-region acceptance fixtures.

Exit criteria: all ten systems in the coverage audit can be assembled without a case-specific component or page, and every unsupported semantic remains explicit.

### P2.4 — SDK extraction

Deliverables:

- [ ] extract the proven built-in contracts into a documented component SDK;
- [ ] package manifest, behavior adapter, config-field extension, event/metric namespace, and compatibility APIs;
- [ ] CLI scaffolding, conformance suite, sample external component, and package validation;
- [ ] SDK version policy and deprecation/migration rules.

Exit criteria: the sample package lives outside the platform packages, passes conformance tests, and installs without edits to model, workbench, compiler dispatch, reducers, or result pages.

### P2.5 — Plugin loading and isolation

Deliverables:

- [ ] trusted local package installation first;
- [ ] Worker boundary, capability declaration, CPU/event/memory budgets, and cancellation;
- [ ] integrity metadata and explicit user consent;
- [ ] failure isolation and safe diagnostics;
- [ ] no arbitrary main-thread or DOM execution.

Exit criteria: a malformed, incompatible, slow, or crashing plugin cannot corrupt the project, block the canvas indefinitely, or impersonate built-in events.

### P2.6 — Batch experiments

Deliverables:

- [ ] parameter sweeps and seeded repetitions;
- [ ] bounded parallel Worker pool with cancellation;
- [ ] capacity-boundary search and aggregate comparison;
- [ ] reproducible experiment manifests and exportable results.

Exit criteria: one experiment definition can compare a parameter range without manually cloning projects, while every run remains independently reproducible.

### P2.7 — Sharing and adapters

Deliverables:

- [ ] shareable, immutable project/experiment artifacts;
- [ ] team component-package metadata;
- [ ] optional server runner using the browser result protocol;
- [ ] adapter boundary for measured inputs without claiming live infrastructure emulation.

Exit criteria: a shared artifact either reproduces with declared compatible versions or fails with an actionable compatibility error.

## 5. Test strategy

- Registry tests prove uniqueness, version resolution, schema validation, and behavior/preset separation.
- Equivalence tests compare preset-created nodes with their resolved base behavior and policies.
- Behavior tests cover state transitions, invariants, deterministic replay, overload, and faults.
- Compatibility tests keep Phase 1 projects and v1 migration fixtures executable.
- Browser tests build representative topologies from the generic palette and inspect real events/metrics.
- SDK conformance tests run identically for built-in and external packages.
- Isolation tests terminate excessive plugins and preserve an interactive canvas.

## 6. Phase 2 definition of done

- [ ] behavior components and role presets are distinct in contracts, UI, docs, and tests;
- [ ] all ten coverage probes are buildable with shared behaviors;
- [ ] at least one external package installs and runs through the public SDK;
- [ ] plugin failures and unsupported versions fail safely;
- [ ] batch experiments are deterministic and cancellable;
- [ ] Phase 1 project compatibility remains covered in CI;
- [ ] `pnpm check` and the Phase 2 conformance suite pass.

## 7. Immediate execution order

Implement P2.1 next. Do not start Scheduler, CDN, or Search Index until the preset registry proves the two-class palette without changing runtime semantics. Do not freeze the public SDK until both behavior waves expose the contracts that real extensions need.
