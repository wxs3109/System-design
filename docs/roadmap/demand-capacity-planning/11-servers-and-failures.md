# DP-11: Servers and failure reserve

> Status: not started. Depends on DP-07. Extension milestone: M5.

[Roadmap and part index](./README.md) · [Shared contracts](./shared-contracts.md)

## Outcome and scope

Make Service server count, placement, per-server throughput, and NIC limits executable, and size for explicit server/zone loss. Add these to the existing Service adapter; do not make every component's server control available before its own binding exists. CPU, memory, and IOPS stay estimated-only unless a later adapter implements a named work resource.

Servers, replicas, zones, and NICs are simulated identities, membership, and resource limits. This part does not create machines, containers, operating-system processes, or network interfaces. Its purpose is to show shared-capacity and correlated-failure trade-offs using the smallest placement model that supports the acceptance cases.

## Input and output contract

A new Service behavior version stores executable server inventory/count, replica placement, server zone IDs, optional per-replica and per-server throughput ceilings, and directional NIC capacities. Benchmark provenance remains in the planning profile; the selected executable limits are config values with a visible mapping from that source.

Placement is either explicit or derived by a versioned deterministic balancing rule. Explicit placement is not silently rearranged by the solver. A fault scenario identifies lost replica IDs, server IDs, or a zone; percentage capacity-drop remains a distinct approximation and cannot impersonate a physical placement failure.

Profiles contain target utilization, selected growth snapshot, failure scenarios, maximum counts, and knob locks. Recommendations return separate replica and server requirements, placement consequences, and normal/fault constraint results.

## Execution and solver rules

- Each request is assigned to a live replica/server under the declared placement/routing rule. It consumes the replica slot and the applicable throughput/NIC resources; a planning-only benchmark does not create an implicit rate clamp.
- Throughput is bounded by available replica work, per-replica ceilings when present, and per-server ceilings. `min(R*q_replica, H*q_server)` is an aggregate necessary envelope; per-server placement constraints must also pass, so uneven placement cannot exploit unused capacity on another server.
- Use a deterministic no-burst rate gate for request-start ceilings, documented separately from service holding time. NIC transfer binds to the server pool and its named path segment; do not charge the same NIC again as an edge alias. Multiple distinct physical resources can constrain the path.
- Failure removes exactly the affected replica/server resources, including zero survivors. Queued/in-flight outcomes follow the declared fault policy; existing generic faults that clamp concurrency to one cannot stand in for total server loss.
- For simple interchangeable replicas, `R = ceil(requiredWork / (perReplicaCapacity * U)) + unavailableReplicaReserve`, applying reserve once. Zone loss instead evaluates surviving placement for each selected zone; adding one replica does not by itself prove zone tolerance.
- With both R and H unlocked, enumerate bounded H in ascending order and choose the minimum feasible R for each H, then select lexicographically by H followed by R. Display this count policy; it is not cost optimization. Preserve explicit placement or report it infeasible; balanced placement may be regenerated as a previewed config edit.
- Scale demand for the chosen growth date once before sizing. All locked values and candidate-count budgets are honored. A budget exhausted before feasibility is resolved yields an incomplete proposal, not a claimed optimum.

## Acceptance cases

1. Four replicas at 100/s each on one server capped at 150/s cannot sustain more than 150/s. Adding a second balanced 150/s server raises the modeled ceiling to 300/s, subject to NIC and slot constraints.
2. Replicas concentrated on one server cannot borrow the idle server's throughput. Changing explicit placement changes the constrained server and runtime evidence.
3. At 180/s, per-replica ceiling 100/s, U=0.9, and one unavailable replica, three replicas are required. Two satisfy normal load but fail the selected loss scenario.
4. Losing a zone that hosts all replicas leaves zero available capacity and cannot pass. Losing one server removes every replica placed there.
5. A saturated server NIC remains a bottleneck after adding colocated replicas. Raising a supported per-server limit changes execution; editing estimated CPU/memory alone does not.
6. Locks, explicit placement, and count bounds can make the design infeasible; no topology node is added by the patch.

## Completion evidence

- [ ] Resource bindings, placement, rate gates, zero-capacity faults, and solver constraints pass.
- [ ] Server/replica/NIC controls and normal-versus-fault comparison pass in the browser.
- [ ] Focused checks and `pnpm check` pass; model approximations and commit are logged here.
