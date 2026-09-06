# DP-20: Calibration, sensitivity, and recorded iteration

> Status: not started. Depends on DP-19. Completes M7 for the selected supported adapters.

[Roadmap and part index](./README.md) · [Shared contracts](./shared-contracts.md)

## Outcome and scope

Let users explicitly reuse compatible run observations, vary one input at a time, and inspect a bounded sizing/simulation iteration. The solver remains deterministic. This part does not learn hidden parameters, search for a cheapest topology, or optimize multiple demand dimensions without a defined objective.

## Input and output contract

`CalibrationProposalV1` identifies a target assumption, previous source/value, proposed value, observation population/window, sample count, source run and engine/behavior versions, compatibility fingerprint, and invalidation dependencies. Provenance remains `simulated-observation`.

`SensitivityExperimentV1` specifies one input path, an ordered finite value grid, a fixed baseline snapshot, seed list, mode, predicate, and run budget. Outputs include normalized demand, recommended config, estimated constraints, simulated metrics/verdicts, and missing evidence at each value.

`PlanningIterationV1` records each step's source assumptions, analytic proposal, validation scope, candidate config, run IDs, reconciliation differences, selected next proposal, and stop reason. Candidate configs live in experiment snapshots; applying a final result to the project uses the ordinary explicit preview/undo command.

## Calibration rules

- Eligible observations include branch frequency, expected attempts, local slot holding, and byte/request hit ratios only when the relevant adapter exposes the correct denominator and scope. Insufficient samples produce an incomplete proposal.
- Compatibility is metric-specific. Cache-hit reuse depends on key/size distribution, TTL, capacity, initial/cache warm-up state, and access mix; local service-time reuse depends on behavior/action work, relevant payload/mix, and timing settings. A run ID alone is not compatibility.
- Measured production benchmarks and simulated observations remain different source types. A calibrated value cannot overwrite an explicit scenario override without the user's source selection.
- A completed throughput measurement under low offered load is not a sustainable capacity benchmark. Overload retry/failure observations are tied to their capacity/demand regime and cannot be transplanted to a changed design as intrinsic failure assumptions.
- Approving calibration creates a new planning revision and invalidates affected projections/proposals. It never rewrites the source run or retroactively changes its verdict.

## Sensitivity and iteration rules

- Vary exactly the selected input while holding the rest of the declared baseline fixed. Mark whether a chart shows the unchanged current design, independently recommended candidates, or applied manual alternatives; these are different comparisons.
- Plot missing/unsupported values as gaps and inconclusive verdicts as such, never as zero. Integer sizing steps and non-monotonic behavior remain visible.
- A closed-loop run begins only after the user starts that bounded experiment. It may size and simulate candidate snapshots within the declared step/run budget, but it cannot silently apply them to the live project.
- After each run, compare projected visits/bytes/work with observed counters using explicit absolute/relative tolerances. Label sources of disagreement as demonstrated or unresolved; do not invent a causal explanation from correlation alone.
- Recalibration within an iteration uses only the preselected eligible observation rules. Freeze other assumptions. Stop on all required criteria passing, infeasible locks/bounds, missing evidence, budget exhaustion, cancellation, repeated candidate hash, or a detected cycle.
- Preserve failed and rejected proposals as well as successful ones. Each bottleneck transition cites its limiting dimension, resource config change, and supporting run/metric.

## Acceptance cases

1. An observed 20% cache miss ratio can become a selected assumption for a compatible snapshot. Changing cache capacity invalidates its reuse for the new candidate until the user selects compatible evidence or an explicit assumption.
2. A run offered only 50/s cannot be imported as proof that per-server capacity is exactly 50/s. An overload retry ratio retains its load/capacity dependencies.
3. A replica-sizing sweep shows integer steps and keeps current-design metrics separate from newly sized candidate metrics. Unknown branch input yields a visible gap.
4. Two alternating candidate hashes terminate an iteration as a cycle while preserving both proposals and runs. A locked infeasible knob stops with an unmet constraint.
5. A successful candidate does not alter the project until applied. Applying and undoing it preserve earlier run and calibration history.
6. Browser calibration preview, one-input chart, step history, cancellation, and saved comparison expose sources and unresolved evidence.

## Completion evidence

- [ ] Compatibility, precedence, invalidation, low-load benchmark rejection, and sensitivity cases pass.
- [ ] Iteration stop rules, immutable history, and explicit application pass.
- [ ] Focused checks and `pnpm check` pass; supported calibration metrics, limitations, and commit are logged here.
