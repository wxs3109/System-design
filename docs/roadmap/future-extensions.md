# Future Extension Roadmap

> Status: deferred. These settlements are preserved for future product expansion and are not part of the current personal-use roadmap or Phase 2 core completion gate.

## 1. Purpose

The current product is optimized first as a local, single-user System Design workbench. The extensions below become relevant only when actual use creates one of these needs:

- third-party behavior variants must be developed outside the repository;
- untrusted or independently versioned packages must be loaded safely;
- repeated manual comparisons should become reproducible parameter sweeps;
- projects and runs must be shared across people or executed by a server runner.

The historical P2.7 through P2.10 identifiers are retained for traceability. Deferral is intentional, not an incomplete current commitment.

## 2. Resume rules

1. Resume a settlement only after a concrete use case justifies it.
2. Keep personal-use improvements, model correctness, and deterministic replay ahead of speculative platform infrastructure.
3. Revalidate package boundaries and dependencies when work resumes; current implementation details are not a frozen future API.
4. Complete and verify each resumed settlement independently.

## 3. P2.7 — SDK extraction

Purpose: allow a behavior variant to be developed and validated outside platform packages without editing core dispatch or result code.

Deliverables:

- [ ] extract the proven category, variant, preset, contract, adapter, event, metric, and fault interfaces into a documented SDK;
- [ ] provide CLI scaffolding, conformance tests, a sample external variant, and package validation;
- [ ] define SDK version, capability, dependency, deprecation, and project-migration rules;
- [ ] allow custom editor widgets only through declared extension points with generic fallbacks.

Exit criteria: the sample package lives outside platform packages, passes conformance tests, appears under its declared category, and registers at build time without edits to the model, workbench, compiler dispatch, reducers, or result pages.

P2.7 proves the extension contract and build-time registration path. Dynamic installation and execution isolation belong to P2.8.

## 4. P2.8 — Plugin loading and isolation

Purpose: load independently distributed extensions without allowing a malformed or hostile plugin to compromise the workbench.

Deliverables:

- [ ] trusted local package installation first;
- [ ] Worker boundary, capability declaration, CPU/event/memory budgets, and cancellation;
- [ ] integrity metadata, explicit user consent, failure isolation, and safe diagnostics;
- [ ] no arbitrary main-thread or DOM execution.

Exit criteria: a malformed, incompatible, slow, or crashing plugin cannot corrupt the project, block the canvas indefinitely, or impersonate built-in events.

## 5. P2.9 — Batch experiments

Purpose: replace repeated manual project cloning and reruns with reproducible parameter exploration.

Deliverables:

- [ ] parameter sweeps across infrastructure and business-contract parameters;
- [ ] seeded repetitions and aggregate confidence summaries;
- [ ] bounded parallel Worker pool with progress and cancellation;
- [ ] capacity-boundary search and reproducible experiment manifests.

Exit criteria: one experiment compares a parameter range without manually cloning projects, while every constituent run remains independently reproducible and inspectable.

P2.9 may be reprioritized independently when personal use makes repeated manual comparisons painful; it does not require a third-party plugin ecosystem.

## 6. P2.10 — Sharing and adapters

Purpose: make compatible projects and experiments portable across users and execution environments.

Deliverables:

- [ ] shareable immutable project/experiment artifacts;
- [ ] team package and contract metadata;
- [ ] optional server runner using the browser result protocol;
- [ ] adapter boundary for measured inputs without claiming live infrastructure emulation.

Exit criteria: a shared artifact either reproduces with declared compatible versions or fails with an actionable compatibility error.

## 7. Future verification gates

- SDK conformance tests run identically for built-in and external variants.
- Unsupported SDK and package versions fail with actionable compatibility errors.
- Isolation tests terminate excessive or crashing plugins safely.
- Every batch constituent remains deterministic, cancellable, and independently inspectable.
- Shared artifacts declare enough version metadata to reproduce or reject a run explicitly.
