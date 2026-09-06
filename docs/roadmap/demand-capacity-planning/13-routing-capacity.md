# DP-13: Routing capacity

> Status: not started. Depends on DP-04. Extension milestone: M5.

[Roadmap and part index](./README.md) · [Shared contracts](./shared-contracts.md)

## Outcome and scope

Add Load Balancer and Global Router adapters for their existing executable routing resources. Keep routing throughput separate from the capacity of selected targets. Physical router server/NIC inventory is estimated-only until a behavior-specific binding exists; DP-11 initially binds Service servers only.

## Input and output contract

Inputs are projected routing visits by phase, existing algorithm and target weights, lookup/routing work, current capacity, and supported health/cache/failover settings. Global Router also uses declared workload cohort/Region identity; it does not infer one lookup per real user from population alone.

Outputs report routing/lookup operations, concurrent routing slots, target traffic distribution, current/required capacity, source assumptions, and separate routing versus target constraints. A cached route decision is attributed according to the runtime's actual resource usage.

## Execution and sizing rules

- Reuse the behavior's actual routing-slot holding time. If cached decisions still consume a modeled slot, the planner must include it; if they bypass a lookup resource, use the explicit lookup fraction.
- Recommend the existing routing capacity knob from summed per-phase slot work and target utilization. Keep configured routing latency and lookup latency as user-controlled assumptions.
- Static weighted or round-robin distributions can be projected. Health-aware or geo routing uses known eligible targets and declared Region shares; future fault-dependent redistribution requires a selected fault snapshot or remains incomplete.
- A route-cache hit fraction is estimated or observed under a specific cohort/TTL model. DAU does not define DNS/query concurrency or cache-key cardinality.
- Changing routing capacity does not increase backend capacity or remove failover delay. Report target saturation separately, and show when a previously blocked target becomes the next bottleneck.
- Server/zone availability claims require executable placement for those actual routing nodes. An extra target or configured lookup capacity does not prove router redundancy.

## Acceptance cases

1. At 10,000 routing operations/s and 0.2 ms holding time, occupied-slot demand is 2; U=0.5 requires four routing slots.
2. A 25/75 fixed split of 1,000/s projects 250/s and 750/s to eligible targets. Increasing router capacity leaves these proportions unchanged.
3. An unknown Region share produces incomplete regional target estimates rather than uniform distribution by default.
4. Reducing lookup frequency via a compatible route-cache model changes only the resource work that the executable behavior actually bypasses.
5. A health-aware failover run can overload the surviving target even when router capacity passes. The finding identifies target headroom separately.

## Completion evidence

- [ ] Load Balancer and Global Router adapter conformance and result-changing capacity tests pass.
- [ ] Formula/target attribution, unknowns, and browser bottleneck focus pass.
- [ ] Focused checks and `pnpm check` pass; supported dimensions and commit are logged here.
