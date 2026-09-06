# DP-02: Workload compilation and projection

> Status: not started. Depends on DP-01. Milestone: M1.

[Roadmap and part index](./README.md) · [Shared contracts](./shared-contracts.md)

## Outcome and scope

Compile transactional activities into existing executable workloads and explain how root demand reaches each Service and connection. Reuse the operation compiler's resolved paths and behavior semantics. Start with unconditional actions and fixed routing; expose explicit coefficients or incomplete results for conditional/dynamic behavior. Do not implement broker delivery, session lifetimes, or shared bandwidth here.

## Input and output contract

Inputs are a validated demand model, scenario overrides, project semantic revision, selected experiment, and a source-mode map selecting `manual` or `planning-generated` for each Traffic Generator. Scheduler bindings wait for DP-17.

Output is an immutable generated-workload snapshot plus demand rows. Record source hashes, normalized half-open phases `[startSeconds,endSeconds)`, integrated expected roots, selected API/Interaction versions, arrival pattern and seed, and projection completeness. Preserve manually authored workloads; generated snapshots are not editable source truth.

Each projection contribution identifies activity, root operation, action or routing step, node, connection/direction where known, phase, dimension, coefficient, and provenance. Unsupported dimensions do not erase supported rows. Compiler errors prevent execution; analytic unknowns can still allow execution of an otherwise valid workload.

## Traffic semantics

- All activities share experiment-relative seconds. Source periods and simulation windows are different fields. A repeated daily profile can be sampled over a shorter explicit experiment window without relabeling its daily count.
- `flat` uses the derived average rate.
- `factor` declares a period T, average rate, and non-overlapping peak/burst windows with explicit offsets and multipliers. To preserve count, baseline multiplier is `(T - sum(duration_i * multiplier_i)) / (T - sum(duration_i))`. Reject negative baselines, windows outside T, and overlap; if windows fill T, their weighted multiplier must equal one.
- `phases` declares non-overlapping absolute rates or multipliers. Its integrated count is authoritative and displayed as a stress scenario; a conflicting count-derived source must be explicitly overridden rather than silently retained.
- Normalize across all activity boundaries. At a node compute `lambda_n(t) = sum_o lambda_o(t) * visits_o,n(t)` and take its peak afterward. A sum-of-peaks envelope is labeled conservative and does not generate a trace until peak placement is explicit.
- Warn when a burst is shorter than the observation sampling interval. Do not widen or discard that burst. Zero-rate spans create no arrivals even if the legacy workload schema needs them omitted.

## Projection and compilation rules

1. Resolve existing executable operation plans; planning must not invent parallelism for an Interaction whose runtime awaits actions sequentially.
2. Combine activities sharing a source into phase-specific rates and operation weights. Preserve each activity's attribution; reject contradictory payload/distribution overrides that cannot be represented by the generated workload contract.
3. Weighted routing normalizes eligible edge weights; fan-out visits each executed branch once. Count root entry calls through the same action accounting as internal calls.
4. Conditional branches require a probability scoped to the condition and dependency context, or a compatible calibration. Unknown context leaves dependent projections incomplete. Explicit failure assumptions can estimate bounded retries, but overload-induced attempts remain unknown before execution.
5. One owner counts each fan-out, retry, message copy, and transfer. An override that duplicates a known owner is rejected. Future adapters add coefficients through the same attribution contract.
6. Request/response bytes are projected separately. Existing response fields may remain estimated-only until DP-07 executes them.

## Acceptance cases

1. A flat 100 roots/s constant source over `[0,10)` generates exactly 1,000 roots with sufficient budget. Phase fixtures specify the first-arrival convention and any boundary rounding explicitly.
2. Average 100/s over 3,600 seconds with a 600-second peak multiplier of 4 produces baseline multiplier 0.4 and integrates to 360,000 roots.
3. Two activities alternate between 100/s and 10/s. Their shared node peaks at 110/s; the conservative coincident-peak envelope is 200/s and visibly distinct.
4. A root calling the same downstream Service in two explicit actions produces coefficient 2, not 4. Weighted 25/75 routing produces the corresponding expected loads.
5. An unknown cache-miss probability leaves downstream sizing incomplete; it does not prevent a supported discrete cache run.
6. Generated mode and manual mode never execute both workload sets on one source. Switching modes preserves authored data and is undoable when wired by DP-04.
7. Identical semantic inputs compile identically. Payload, operation mix, fan-out, or phase changes invalidate the snapshot; Canvas movement does not.

## Completion evidence

- [ ] Phase conservation, projection ownership, bindings, negative cases, and real Worker execution pass.
- [ ] Estimated-only response handling and unsupported projection semantics are listed.
- [ ] Focused checks and `pnpm check` pass; results and commit are logged here.
