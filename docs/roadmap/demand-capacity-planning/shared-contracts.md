# Demand and Capacity Planning: Shared Contracts

[Roadmap and part index](./README.md)

These rules apply to all twenty parts. The roadmap owns status and dependencies; each spec owns its implementation details, formulas, and acceptance cases. This document defines only the rules that must agree across parts.

## Learning-model boundary

Components execute simplified models for System Design learning and research. Users do not deploy or connect to real services, databases, brokers, or cloud resources. Saving projects and experiments is a workbench feature, separate from simulated component state.

- Implement the smallest reusable model that explains a stated design question. Name its state/resources, observable outcome, and omissions; reuse component composition before adding variants.
- Messages, objects, replicas, and servers are bounded in-run records. Declared byte sizes do not require real payload allocation; processing, storage commit, and recovery use virtual work and state transitions.
- Claimed discrete effects must come from executed model transitions; formulas and sampled traces cannot impersonate full runtime evidence. Conclusions apply only to the declared model and experiment.
- S3-like, map, and ride scenarios may use symbolic objects and small synthetic datasets. Full products, protocols, disks/storage engines, OS scheduling, live infrastructure integration, and production capacity/durability guarantees are outside scope. Business state-machine checks require separate scope; they are not added by these parts.
- Size the existing topology. Provisioning, SKUs, vendor pricing, and cost optimization are outside this roadmap. Imported traces, cross-node shared pools, architecture generation, multidimensional optimization, cost catalogs, and continuous benchmark ingestion remain deferred.

## Integration boundaries

See the [code structure](../../../README.md#工作原理与代码结构) and [current model assumptions](../../model-assumptions.md) for existing capabilities. These specs describe proposed changes, not shipped behavior. The model owns schemas; behavior adapters own component meaning; compilation shares executable path interpretation; runtime telemetry owns evidence. Keep formulas/solvers pure and independent of React and scheduling, without a central component-config switch. Compilation and runtime must not branch on example names. Reuse existing project commands, Worker orchestration, and comparison views.

## Data and outputs

| Output | Meaning | Required record |
|---|---|---|
| Derived demand | `estimated` under declared assumptions | Dimension, scope/window, unit, formula, input references, provenance, completeness |
| Recommendation | Satisfies specified analytic constraints | Current/required/proposed values, rounding, reserve, limiting dimensions, locks, validated patches, unmet constraints |
| Runtime evidence | `simulated` in a concrete run | Offered/admitted/completed/rejected/unfinished work, resource metrics, window, mode, stop reason, verdict basis |

Storage horizons remain `estimated` even when calibrated from a run; only storage events executed in that run are `simulated`. Provenance is `measured`, `user-assumed`, `simulated-observation`, `teaching-default`, or `unknown`. Preserve contributing origins and unresolved inputs; provenance is not a confidence score, and simulation never becomes a production benchmark.

- Source inputs and executable config are authoritative. Derived totals are recomputed, not independently edited.
- Profiles own benchmark sources, policies, locks, and assumptions. Limits that affect execution belong in versioned executable config; expose the mapping.
- Source precedence is explicit scenario override, user-selected baseline, visible teaching default, then unknown. Preserve source history; use saved-run calibration only when explicitly selected.
- Generated workloads belong to immutable run snapshots. Each source explicitly selects manual or generated traffic; preserve authored workloads and never implicitly execute both.
- Validate units, finite/safe numeric ranges, bounds, references, dimensions, and versions. Unknown remains unknown; do not replace it with zero or an unlabeled guess.

## Runtime bindings

Support is per dimension and behavior version. [DP-03](./03-service-capacity.md) defines adapter registration and sizing; each adapter publishes:

```typescript
interface CapacityDimensionSupport {
  dimension: string
  scope: 'node' | 'connection' | 'pool' | 'partition' | 'subscription'
  support: 'estimated-only' | 'executable' | 'unsupported'
  configPaths: string[]
  runtimeResource?: string
  evidenceMetrics: string[]
  supportedModes: Array<'discrete' | 'aggregate-capacity'>
  limitations: string[]
}
```

Registration requires an executable dimension to bind validated config to a runtime resource, evidence metrics, and a result-changing test. Estimated-only changes cannot satisfy an executable validation requirement. CPU/memory/NIC/IOPS assumptions remain estimates until the relevant part implements their resource.

## Recommendation application

- Every solver knob can be locked. Preserve locked and unsupported values; report infeasible constraints. Each proposal names its knob, patch or explicit profile edit, prerequisites, and validation scope.
- Apply-all is one explicit atomic undoable command. Individual rows revalidate prerequisites and affected constraints; they do not inherit the full proposal's verdict. Manual edits govern the next run; no silent application or run.
- Semantic input/revision or engine-hash changes invalidate previews; layout-only changes do not. Application creates a new project revision without rewriting earlier results.
- Patches cannot add/remove/reconnect/enable/disable topology nodes. Structural suggestions are separate findings. Default to increases only; user-enabled downsizing is identified in the same preview.

## Formula conventions

Equations and numeric cases belong to [demand](./01-demand-data-and-formulas.md), [traffic projection](./02-workload-compilation.md), [Service sizing](./03-service-capacity.md), [transfers](./07-directional-transfers.md), [sessions](./08-sustained-delivery.md), and [storage](./09-storage-horizon.md). Shared rules are:

- Use canonical seconds, counts, bytes, bits/s, and integer UTC-relative planning days. Show decimal/binary conversions and the declared end-of-day retention boundary.
- Aggregate traffic on one experiment-relative timeline before taking peaks. Sum-of-peaks requires an explicit conservative envelope. Count-derived profiles conserve volume; stress phases expose their own integrated count. Population is not session concurrency.
- Match each rate/occupancy calculation to its resource boundary. Distinguish end-to-end response time from slot holding; count queue/downstream time only when the resource remains held. Distinguish request/response directions and transactional/session bytes.
- Attribute fan-out, retries, message copies, replication, and bytes to one owner. Unknown branch probabilities leave dependent estimates incomplete. Apply growth/utilization headroom once; add replica reserve once after the per-knob dimension maximum. Benchmarks state mix, payload, SLO, and ceiling versus operating-target semantics.
- Keep different knobs and pools separate; their counts cannot share one maximum. Each coupled solver declares feasibility and selection rules. Storage distinguishes horizon, retention, initial data, successful mutations, physical occupancy, backup ownership, and provisioned reserve; [DP-10](./10-physical-storage.md) owns physical formulas.

## Evidence and pass predicates

[DP-04](./04-transactional-loop.md#evidence-contract) defines observation plans and per-criterion records. Every versioned predicate returns:

- **Pass:** all required criteria have sufficient supported evidence and pass in their requested windows.
- **Fail:** at least one supported criterion has sufficient evidence of a violation; preserve any inconclusive criteria alongside it.
- **Inconclusive:** no supported violation is established, but at least one required criterion lacks evidence or execution support.

Record warm-up, sustained observation, planned arrival cutoff/drain, samples, slope window/tolerance, metric population, trace limits, budgets, and stop reason. Missing observation due to `maxRequests`, event budget, cancellation, or early termination cannot pass; a complete observed violation may still fail. Queue slopes use the sustained window, not post-load drain. Show successful-latency denominators with failures and unfinished work. Trace retention never defines totals; storage forecasts retain an estimated verdict basis.

### Execution capability matrix

| Criterion | Discrete, supported behavior | Aggregate-capacity v1 | Representative subset |
|---|---|---|---|
| Work counters | Full-run | Full-rate conservation for opted-in adapters | Subset only |
| Queue slope/utilization | Complete observation required | Declared rate equations | No full-demand pass |
| Shared bytes | After DP-07/DP-08 bindings | Declared rate pools | No full-demand pass |
| p95/p99 latency | Eligible population and enough samples | Unsupported | Sampled latency only |
| Cache state, ordering, retries | Implemented semantics only | Fixed coefficients; dynamic semantics unsupported | Subset-specific |
| Fault survival | Supported fault and scope | Supported capacity schedules only | No full-demand pass |
| Storage horizon | Separate estimate | Same separate estimate | Same separate estimate |

[DP-18](./18-aggregate-runtime.md) governs aggregate eligibility. Unsupported required semantics reject execution or leave criteria inconclusive. Samples cannot supply aggregate totals/tails, and representative runs cannot certify a full-demand boundary. [DP-19](./19-capacity-search.md) owns search budgets, tested brackets, unknown points, and non-monotonic results.

## Reproducibility and compatibility

[DP-01](./01-demand-data-and-formulas.md) owns ProjectFile v4 migration: an empty planning catalog preserves v3 execution, with older imports continuing through existing migrations. Use explicit component/adapter versions for new semantics, including contention; never silently reinterpret legacy projects. OpenAPI/DBML remain API/data adapters, not planning authorities.

Saved results retain source/profile hashes, semantic topology revision, experiment ID, normalized phases, selected sources, formulas, patches/locks, all component/adapter/formula/compiler/solver/runtime versions, predicate, mode, seed, windows, budgets, warnings, and run IDs. Runs remain immutable; autosave, import/export, undo/redo, and comparison reuse existing commands. [DP-20](./20-calibration-and-sensitivity.md) owns evidence compatibility and calibration invalidation.

## Verification and completion policy

Each part must pass its positive/negative acceptance cases, schema/migration and result-changing tests for new executable fields, and relevant UI checks. Use independent numeric fixtures and dimension-specific monotonicity checks where valid. Defaults are decimal bytes/bits, zero optional overhead, and unit amplification; fix seed, timing, bounds, initial state, and windows, accounting for discrete boundary work in tolerances.

Record changed areas, checks/results, limitations, and commit reference in the owning spec. Update current model assumptions only when behavior ships. Implementation parts require focused checks and complete `pnpm check` before completion/integration; do not mark unfinished dependent parts or a milestone complete. Documentation edits require content/link lint and diff validation only. Milestone outcomes stay in the roadmap and detailed completion checklists in each spec.
