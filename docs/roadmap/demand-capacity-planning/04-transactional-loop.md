# DP-04: Transactional planning loop and evidence

> Status: not started. Depends on DP-03. Completes M1.

[Roadmap and part index](./README.md) · [Shared contracts](./shared-contracts.md)

## Outcome and scope

A user can edit business demand, inspect a Service recommendation, apply or manually tune it, run the current design, and compare results. Deliver this before adding more component adapters. Introduce evidence eligibility and three-state verdicts now; automatic searching waits for DP-19.

## Input and output contract

Inputs are the selected project/experiment, planning scenario, source-mode selections, generated workload snapshot, adapter proposals, and an observation plan. Commands return an updated project revision or field-scoped validation errors. Runs return immutable snapshots, full-run metrics, a structured stop reason, and per-criterion verdicts; comparisons reference those run IDs rather than mutable current totals.

## UI and command contract

The Capacity view contains Demand, Derived values, and Current/Required/Recommended resources, with formula inspection and contributing Canvas path focus. Each numeric control displays units; missing assumptions and estimated-only dimensions remain visible.

Source-mode changes, demand edits, locks, profile edits, and recommendation application use existing project commands, autosave, and undo/redo. Apply-all is atomic; per-row application validates dependencies and reports the remaining unsatisfied constraints. Preview recalculates after semantic input changes and cannot apply stale patches. Run uses current config, not an unapplied recommendation.

Comparison displays baseline and candidate run IDs, immutable snapshots, demand/config changes, offered and achieved rates, latency population, failures, unfinished work, queue trends, and formula-versus-run differences. Capacity tuning comparisons require the same workload/faults/seed/windows/engine; a demand-change comparison is labeled a different experiment condition.

## Evidence contract

`PassPredicateV1` contains named criteria with target scope, threshold/operator, metric basis, required execution mode, and evidence requirements. `EvidenceVerdict` is `pass | fail | inconclusive` with per-criterion reasons, measured window, denominator/sample count, and referenced full-run metrics. Apply the [shared evidence and pass rules](./shared-contracts.md#evidence-and-pass-predicates).

`ObservationPlanV1` records warm-up interval, sustained observation interval, planned arrival cutoff, optional drain interval, minimum completed samples, slope window/tolerance, and generation/event budgets. All intervals are explicit and non-overlapping where required; drain begins after arrival cutoff. Presets are labeled teaching defaults and are stored as resolved values, not hidden constants.

Execution records planned versus realized offered roots, admitted roots, admission rejections, terminal failures, successful completions, unfinished roots, cancellation, and a structured stop reason. Distinguish a planned end, planned drain, `maxRequests`, event-budget exhaustion, and cancellation. Add missing full-run counters rather than deriving totals from retained traces.

For each criterion:

- Queue slope uses a stored linear-fit rule over timestamped queue samples in the sustained observation window, including its start/end. Require the declared minimum window and sample count; do not substitute the drain interval. Utilization is time-weighted busy capacity divided by time-integrated available capacity.
- Root outcome ratios refer to roots offered in the selected window; attempt counters are separate. Admission rejections count as offered roots. Drain can resolve their outcomes, but unresolved roots remain unfinished, not successes.
- Latency reports its exact completed-success population. A latency-only predicate cannot pass while required outcome completeness is unknown; display accompanying errors and unfinished work.
- A complete observed violation can establish failure before a truncated end. Missing required observation cannot establish pass. Unsupported metrics are inconclusive.
- Trace limits change retained detail only. Expected Poisson counts are estimates; natural seeded variation is not generation truncation.

## Acceptance cases

1. An isolated API Service receives 120/s, holds 10 slots for 0.2 seconds each, and begins with one replica. Over a sufficient sustained window with no jitter/errors and a large queue, backlog grows. DP-03 proposes three replicas at U=0.8; applying and rerunning removes sustained growth.
2. The browser flow edits population, inspects the rate and replica formulas, applies, runs, compares, then undoes. The previous config and demand are restored; saved runs remain immutable.
3. Manually setting two replicas after a proposal makes the next run use two. Applying an old proposal after that edit is rejected as stale.
4. A run that hits `maxRequests` early and drains its queue cannot pass the requested sustained-load criterion. A normally completed observation followed by planned drain remains eligible.
5. Insufficient completed samples makes a requested latency quantile inconclusive. An observed queue overflow still yields a failed overflow criterion even if latency is inconclusive.
6. Reducing trace retention does not change counts, verdicts, or bottleneck overlays. Equivalent seed/snapshot runs reproduce evidence.
7. Import/export and autosave preserve planning/source selections. An imported legacy project has no implicit planning-generated traffic.

## Completion evidence

- [ ] Browser workflow and saved comparison pass on a generic transactional fixture and a second independently constructed topology.
- [ ] Verdict, window, truncation, accounting, and trace-independence cases pass.
- [ ] Focused checks and `pnpm check` pass; M1 limitations and commit are logged here.
