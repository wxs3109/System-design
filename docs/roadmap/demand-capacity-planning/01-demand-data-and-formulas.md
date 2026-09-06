# DP-01: Demand data and formulas

> Status: not started. Depends on the existing v3 model. Milestone: M1.

[Roadmap and part index](./README.md) · [Shared contracts](./shared-contracts.md)

## Outcome and scope

Store generic business demand and produce inspectable transactional rate and byte estimates without running the simulator. This part supplies schemas and pure calculations; workload execution belongs to DP-02 and the full editor to DP-04. Sessions and persistence receive their own versioned extensions in DP-08 and DP-09.

## Input and output contract

ProjectFile v4 adds `planning: { schemaVersion: 1, demandModels: [], capacityProfiles: [], scenarios: [] }`. Experiments may reference a planning scenario by ID. Catalog entries use stable IDs and explicit schema versions. Empty catalogs are valid; missing or duplicate references are errors.

A demand model contains named actor groups and activities. An actor group has `id`, `name`, and `population`. Each activity has `id`, `name`, a binding, volume, `rootRequestsPerOccurrence`, transactional transfer assumptions, and a traffic shape. Bindings reference either existing versioned API/Interaction contracts plus a Traffic Generator source, or an existing capacity-only Traffic Generator. Incomplete editor drafts stay outside the validated executable model.

Initial volume forms:

| Kind | Required fields | Meaning |
|---|---|---|
| `per-actor` | actorGroupId, participatingFraction, occurrencesPerActor, periodSeconds | Expected occurrences per actor in the stated period |
| `absolute-count` | occurrences, periodSeconds | Total occurrences in that period |
| `arrival-rate` | averageOccurrencesPerSecond | Occurrences per second before root-request multiplication |

All numbers are finite. Population and expected occurrences may be nonnegative real estimates; fractions are in `[0,1]`; period is positive; root requests per occurrence is nonnegative. Payload bytes are nonnegative, overhead is a nonnegative ratio, and omitted payload is unknown unless inherited from its bound contract. A zero rate is valid and compiles to no arrivals. Unsafe count arithmetic reports `numeric-range` instead of silently losing integer precision.

A formula result contains `formulaId`, `formulaVersion`, input references, expression tree, canonical unit, activity/scope ID, time basis, value or unresolved reasons, and contributing provenance. Unknown is not encoded as zero, NaN, or an arbitrary default. Formula nodes are serializable and have stable deterministic IDs.

## Calculation rules

- Per-actor roots per period: `N = population * participatingFraction * occurrencesPerActor * rootRequestsPerOccurrence`; average roots/s is `N / periodSeconds`.
- Absolute-count and arrival-rate forms apply `rootRequestsPerOccurrence` exactly once. The field name distinguishes occurrences from root operations.
- Estimate request bits/s and response bits/s separately using `8 * rootRate * payloadBytes * (1 + overhead)`; mark these as endpoint demand until DP-02 attributes paths.
- Traffic-shape fields and their volume-preservation rules follow DP-02. A flat shape is sufficient for this part's standalone fixtures.
- Active source selection is scenario override, selected baseline source, visible teaching default, then unknown. Preserve superseded sources for inspection; do not auto-select a newly imported benchmark.
- Hash normalized source data and formula versions; exclude layout and UI selection. Recalculation never modifies source data.

## Acceptance cases

1. Population 1,000,000, participation 0.2, three occurrences/day, and two roots/occurrence produce 1,200,000 roots/day and `125/9` roots/s.
2. Absolute count 600/minute with two roots/occurrence produces 20 roots/s. Arrival rate 10 occurrences/s with the same multiplier also produces 20 roots/s.
3. At 100 roots/s, 1,000 request bytes and 2,000 response bytes produce 800,000 ingress and 1,600,000 egress bits/s with zero overhead.
4. Missing response size leaves response demand unknown while request demand remains available. Zero participation produces zero rate without division errors.
5. Invalid references, negative sizes, zero periods, invalid fractions, unsupported schema versions, and unsafe numeric ranges fail with field paths.
6. Importing v3 creates an empty planning catalog; a fixed legacy fixture's compiled workload and deterministic run remain unchanged. v2 import continues through the existing migration chain.
7. JSON round trip preserves selected sources and IDs. Equivalent unit inputs produce equal canonical values. Billion-user inputs allocate by activity count, not population.

## Completion evidence

- [ ] Schema, migration, formula, unit conversion, and numeric-range cases pass.
- [ ] Public model/planning exports and formula ownership are documented.
- [ ] Focused checks and `pnpm check` pass; changed files, results, boundaries, and commit are logged here.
