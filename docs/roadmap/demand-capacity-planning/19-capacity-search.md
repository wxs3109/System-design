# DP-19: Capacity boundary search

> Status: not started. Depends on DP-04. Part of M7; may ship earlier for eligible discrete scenarios. Aggregate search additionally requires DP-18 and the necessary adapter opt-ins.

[Roadmap and part index](./README.md) · [Shared contracts](./shared-contracts.md)

## Outcome and scope

Find a conditional passing/failing bracket for one demand dimension while holding the design fixed. Report every tested point and unknown interval honestly. This part searches demand only; configuration iteration and calibration belong to DP-20.

## Input and output contract

`CapacitySearchV1` contains a base project/experiment snapshot, selected scalar input or named demand multiplier, minimum/maximum values, initial probe, bracketing factor, absolute/relative tolerance, run/refinement budgets, explicit seed list and aggregation policy, fixed observation plan, fixed execution mode, and `PassPredicateV1`.

Supported initial search dimensions are a nonnegative scalar multiplier over selected activities or one explicitly identified numeric demand input. Store which fields are scaled: occurrence rate, concurrency, or bitrate are different searches. Preserve operation mix and phase timing unless the selected input explicitly changes them. Topology, capacity config, source assumptions, fault schedules, and predicate stay fixed.

`CapacitySearchResultV1` stores every proposal/probe in execution order, exact run IDs/configs, per-criterion verdicts, aggregate verdict, counts, stop reason, last passing/first failing tested bounds where found, uncertain intervals, and observed bottlenecks. Bounds always refer to tested points; do not interpolate an untested pass.

## Search algorithm

1. Preflight semantic support and budget for each candidate before executing it. Budget rejection or unsupported criteria produces an inconclusive point with reasons, not a failure capacity point.
2. Evaluate the initial point. If passing, grow by the configured factor within maximum until finding a failing point; if failing, decrease within minimum to seek a pass. Handle zero explicitly without repeated multiplication by zero.
3. If no pass is found in the allowed range, return `no-passing-point`; if no failure is found, return `no-failing-point` and a tested lower bound only. Neither is an exact maximum.
4. Once supported passing/failing endpoints exist, bisect the bracket. Stop when `width <= max(absoluteTolerance, relativeTolerance * max(abs(lower),abs(upper)))` or budget/cancellation prevents more work.
5. An inconclusive probe never replaces either endpoint. A predeclared bounded retry may increase samples or refine an aggregate bucket; record it. If unresolved, retain the unknown interval and stop refinement of that interval rather than pretending it passed or failed.
6. Evaluate configured nearby probes around the candidate boundary when budget permits, and check all observed points for inversions. A fail below a pass invalidates the single monotonic-boundary claim; return sampled intervals instead. Finite probes establish only sampled consistency, not global monotonicity.
7. With multiple seeds, the initial policy is all seeds pass to pass, any sufficiently evidenced failure to fail, otherwise inconclusive. Store individual seed outcomes; do not label a confidence interval without a statistical procedure. Each seed is individually reproducible.
8. Report the limiting criterion and observed bottleneck at each point. If multiple criteria first violate within one observation resolution, report them together rather than inventing temporal ordering.

## Experiment controls

- Warm-up, sustained observation, and optional drain use DP-04 eligibility. Reaching generation limits early cannot create a pass because the remaining queue drains.
- Do not switch between discrete and aggregate modes midway through a bracket. Changing mode or evidence scope creates a new search. Aggregate refinement retains mode but records bucket size and must satisfy DP-18 convergence requirements.
- Optional fault-survival predicates use the same fault scenario and timing at every point. Storage predicates evaluate the same horizon/retention assumptions while the selected demand input changes.
- User edits invalidate the active search snapshot for application/comparison purposes; already completed probe records remain immutable. Cancellation preserves useful tested bounds and marks unresolved work.

## Acceptance cases

1. Against a deterministic test evaluator that passes through x=10 and fails above 10, search within `[1,20]` returns tested opposite-verdict bounds containing 10 within tolerance. An isolated runtime fixture separately verifies real queue/utilization integration.
2. If every tested point up to the maximum passes, return a tested lower bound and `no-failing-point`. An infeasible locked design can return `no-passing-point` without changing config.
3. A probe truncated by `maxRequests` is inconclusive for missing sustained evidence; it cannot advance the passing bound.
4. Observed results pass at 1, fail at 2, and pass at 3 produce sampled non-monotonic intervals, not one exact maximum.
5. Insufficient latency samples, mixed seed outcomes, cancellation, and run-budget exhaustion retain all probe reasons and never fabricate a bracket.
6. Browser `Find limit` shows progress, cancellation, tested points, uncertain intervals, and bottleneck focus. Reopening the saved result preserves exact inputs and verdicts.

## Completion evidence

- [ ] Bracketing, bisection, inconclusive, seed, monotonicity, and budget cases pass.
- [ ] Discrete end-to-end search and optional eligible aggregate search reconcile with their evidence contracts.
- [ ] Browser workflow, focused checks, and `pnpm check` pass; search limits and commit are logged here.
