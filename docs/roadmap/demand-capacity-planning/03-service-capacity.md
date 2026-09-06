# DP-03: Service capacity contract and sizing

> Status: not started. Depends on DP-02. Milestone: M1.

[Roadmap and part index](./README.md) · [Shared contracts](./shared-contracts.md)

## Outcome and scope

Produce the first useful capacity recommendation: replica count for an existing Service from projected slot demand. Introduce versioned adapters and dimension support so later components extend the same mechanism. Keep per-replica concurrency and service-time inputs manually editable. Server placement, CPU, memory, NIC, and executable benchmark rate limits belong to DP-11.

## Input and output contract

An adapter registered beside a behavior version exposes `describeKnobs`, `describeSupport`, `deriveCurrentEnvelope`, `projectDemand`, `recommend`, and `toConfigPatch`. Contexts contain validated immutable inputs and resolved execution semantics; adapters cannot mutate projects or schedule runs.

A capacity profile identifies node and behavior version, assumption sources, utilization policy, bounds, and locked config paths. A recommendation records ID, target knob, current/required/proposed values, dimension constraints, formula references, scope, provenance, support, patches, prerequisites, and unmet reasons. Reasons distinguish `unknown-input`, `unsupported`, `locked`, `schema-bound`, and `incompatible-source`.

| Dimension | Runtime binding in this part | Evidence |
|---|---|---|
| Occupied request slots | `replicas * concurrencyPerReplica` | Busy capacity, utilization, queue depth |
| Local slot holding time | Configured Service work plus executed action handler work and supported timing modifiers | Local service duration |
| Sustainable requests/s | Derived from slot work and current mix | Completion rate under sufficient demand |
| Measured per-replica or server benchmark | Estimated-only comparison; no hidden runtime rate limiter | Source benchmark reference, no simulated benchmark pass |
| Servers, NIC, memory, CPU | Unsupported execution here | No runtime verdict |

## Sizing rules

For a phase, total occupied-slot demand is `A = sum_o(lambda_o,n * meanSlotHoldingSeconds_o,n)`. With C slots per replica and target utilization U in `(0,1]`, `R_required = ceil(A / (C * U))`. Take the maximum R across phases. With default increase-only policy, `R_proposed = max(R_current, R_required)`; obey the component minimum even at zero demand. M1 has zero failure reserve; nonzero reserve is unverified until DP-11 supports its fault scope.

Slot holding follows actual resource acquisition/release. End-to-end response time and queue wait do not substitute for local work. Account for handler mix and the runtime's jitter/clamping rule; using base time alone where clamping changes the mean must be explicitly approximate. Unknown expected work produces an incomplete recommendation.

Only replicas are auto-sized in this part. The solver must not satisfy a constraint by increasing a user's declared per-replica concurrency or benchmark. Measured throughput sources state whether they are ceilings or already include operating headroom; do not multiply an operating target by utilization again. An unsupported benchmark constraint keeps the overall plan unverified even if the slot constraint passes.

The solver chooses deterministic minimum integers for the supported knob, records all binding constraints, and emits no patch for an infeasible locked or out-of-schema value. Validation checks the complete candidate config before returning a patch. Applying occurs in DP-04.

## Acceptance cases

1. At 120 requests/s, 0.2 seconds holding time, 10 slots/replica, and U=0.8, required replicas are 3. One replica has a modeled service ceiling of 50/s; three have 150/s in the isolated deterministic fixture.
2. Two visits to a Service each hold a slot for 0.05 seconds at 100 roots/s: slot demand is 10, not 5 or 20. The formula tree identifies both actions.
3. Changing end-to-end delay outside the occupied Service slot does not change its required replicas. Changing executed handler time does.
4. A lock at one replica returns an unmet constraint without a patch. A requirement above schema maximum is infeasible, not clamped and labeled sufficient.
5. Current replicas above the requirement remain unchanged unless downsizing is enabled. Changing a planning-only benchmark does not change runtime behavior or create simulated evidence for it.
6. Registering an executable dimension without a resource, config binding, or evidence metric fails conformance validation. An unknown adapter produces a visible unsupported result.

## Completion evidence

- [ ] Adapter conformance, formulas, locks, bounds, provenance, and actual replica-dependent runtime behavior pass.
- [ ] All config patches validate against the target behavior version.
- [ ] Focused checks and `pnpm check` pass; support boundaries and commit are logged here.
