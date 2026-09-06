# DP-18: Aggregate capacity runtime

> Status: not started. Depends on DP-05 and DP-07. Completes M6 independently of broad adapter coverage.

[Roadmap and part index](./README.md) · [Shared contracts](./shared-contracts.md)

## Outcome and scope

Run full-rate conservation calculations within a bounded resource/time-bucket budget when discrete events are too numerous. This is a separately versioned execution mode with declared approximations. V1 supports fixed-coefficient Service/Worker, acknowledged Queue, and Network rate paths; additional adapters opt in only with their own conformance fixtures.

V1 does not simulate latency quantiles, per-key cache state, dynamic retry storms, per-request ordering, synchronous fork/join completion, or arbitrary cyclic flow. Required unsupported semantics fail preflight or remain explicitly outside a user-selected analysis scope. The engine does not quietly drop unsupported nodes from a requested full-topology validation.

## Input and output contract

`AggregateScenarioV1` contains a finite set of operation classes, piecewise-constant offered rates, an acyclic flow graph, fixed routing/amplification coefficients, service-work/byte coefficients, initial queue work, resource capacities, bounded storage for pending work, and supported time-varying capacity/fault schedules.

`AggregateRunConfigV1` records bucket seconds, numerical tolerance, maximum buckets/resource steps/classes, trace sample budget, observation plan, and approximation declarations. Preflight calculates a bounded work estimate by model size and time span; business population does not allocate actors or request events.

Outputs contain full-rate expected root/message/byte flows, admissions, completions, explicit rejects/drops, residual queues, utilization, and stop reason. Fractional expected counts are valid and visibly distinguished from discrete integer events. A small optional trace sample is illustrative and never controls aggregate totals or percentiles.

## State-transition semantics

1. Split buckets at demand, capacity, fault, and observation boundaries. Within each piece, rates are constant; integrate queues through empty/full crossings rather than clamping a negative balance and losing accounting.
2. Each resource has explicit incoming, served, rejected/cancelled, and residual work. `initial + incoming = served + rejected + cancelled + final` within numerical tolerance. Service is bounded by available integrated capacity and available work.
3. Service effective rate derives from occupied-slot work and any opted-in rate constraints. Preserve class-specific work costs; never treat one cheap read and one expensive write as equal service work without the declared mix conversion.
4. Propagate served flow in topological order using fixed coefficients. V1 treats traversal as fluid flow with no per-request transit latency; queues reflect rate imbalance. This approximation cannot generate end-to-end latency or synchronous fork/join evidence.
5. Queue admission/acknowledgement boundaries follow the opted-in DP-05 variant. Asynchronous copies have their own flow identities and do not inflate root completion counts. A coefficient requires an explicit production/consumption owner.
6. Byte resources use the same canonical capacities and work ownership as DP-06/DP-07, adapted to continuous work balances. Finite bounds explicitly reject/drop overflow; no bytes disappear through rounding.
7. Dynamic routing, failures, and retries are fixed declared coefficients only when the selected analysis explicitly accepts that approximation. A fixed failure ratio does not claim simulated failure causality. Node/zone faults are supported only if the chosen adapter maps them to known capacity schedules.
8. Bucket/resource budget exhaustion and cancellation retain partial counters and an inconclusive incomplete observation. Never silently enlarge buckets mid-run. A refinement run is a separate recorded run with its own config.

## Eligibility and reconciliation

Publish the [execution capability matrix](./shared-contracts.md#execution-capability-matrix) in the mode selector and result. p95/p99 criteria are unsupported regardless of trace sample count. Storage horizons remain separate DP-09/DP-10 estimates. A representative subset is another optional experiment and cannot certify the full demand level.

For an eligible isolated fixture, compare aggregate and discrete offered/served work and backlog, accounting for start/end in-flight work and the declared fluid approximation. Record absolute and relative discrepancies. Near a selected threshold, repeat aggregate calculation at half the bucket size within budget; if the verdict changes or the configured convergence tolerance is exceeded, mark that criterion inconclusive. A small bucket is not proof of omitted semantics.

## Acceptance cases

1. Empty fluid queue, arrivals 120 units/s, service 100 units/s, unbounded waiting, ten seconds: incoming 1,200, served 1,000, residual 200.
2. The same fixture with a 50-unit waiting bound serves 1,000, retains 50, and rejects 150 units. It conserves work through the exact full-queue crossing.
3. Initial backlog 600, arrivals 120/s, service 150/s drains in 20 seconds. With arrivals zero it drains in four seconds; service stops when available work is exhausted.
4. Two declared byte flows share a 100-byte/s pool; total served bytes stay within its integrated capacity, including a zero-capacity fault interval.
5. Raising population from one million to one billion with unchanged model dimensions changes calculated work amounts, not allocated event count. Preflight rejects a bucket/resource budget that is too small.
6. A cache-dependent retry topology without an opted-in model is rejected for full-topology aggregate validation. A requested p99 criterion is inconclusive, even with illustrative traces.
7. Trace budget changes do not affect counters. Bucket refinement, full/empty transitions, and deterministic replay meet declared tolerance fixtures.

## Completion evidence

- [ ] Every opted-in adapter passes flow/work conservation and finite-bound cases.
- [ ] Discrete reconciliation, refinement, preflight budgets, mode labels, and unsupported criteria pass.
- [ ] Focused checks and `pnpm check` pass; approximation table, performance results, and commit are logged here.
