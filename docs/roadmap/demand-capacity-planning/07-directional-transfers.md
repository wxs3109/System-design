# DP-07: Directional transfers and connection metrics

> Status: not started. Depends on DP-06. Part of M3.

[Roadmap and part index](./README.md) · [Shared contracts](./shared-contracts.md)

## Outcome and scope

Make request and response transfer consume shared capacity on Network paths, expose full-run connection metrics, and recommend bandwidth. Keep CDN/Object Storage and sessions for DP-08. Shared contention is a new explicit behavior version; imported legacy Network behavior keeps its previous execution until upgraded.

## Input and output contract

A compiled transfer identifies operation/action, payload source, physical path, forward or reverse direction, pool IDs, and logical transfer ID. For a planning-generated root response, size precedence is scenario activity override, activity value, selected source-workload override, then the bound successful API response estimate; manual roots use their workload override then the API estimate. Internal actions use their explicit action override then the called API estimate and never inherit the root response override. Record the winning source in the compiled transfer. Missing size remains unknown for planning; execution requires an explicit inherited/default size or an actionable error for that transfer.

The Network version adds directional aggregate capacities, duplex mode (`full` or `shared`), byte admission bound, and overflow policy. Existing request parallelism remains a separate admission constraint. In full duplex, each direction owns a pool; in shared duplex both directions use the same pool.

Connection aggregates include calls/outcomes, offered/served/rejected/cancelled/outstanding request and response bytes, achieved bits/s over the selected window, pool utilization, byte backlog, transfer admission wait, and completion duration. Pool counters own capacity totals; connection rows attribute contributions and are not summed as independent copies of the pool.

## Execution and sizing rules

- Charge each logical request once for each traversed physical resource; sequential links can each serve the same payload because they are different resources. Do not additionally charge an edge for a Network-node pool already representing that same link.
- Execute a response over the reverse of the actually selected forward path, not a newly sampled route or a requirement for a reverse Canvas edge. Apply direction-scoped faults. Record behavior for paths unavailable at response time.
- Transfer service consumes the rate pool. Propagation latency is separate and does not hold byte capacity; remove the old per-request throughput delay in the upgraded behavior to prevent duplicate serialization cost.
- Synchronous completion waits for modeled response transfer. Retries create separately attributed attempts; cancelled partial transfers retain served bytes and report remaining cancelled bytes. Error responses use an explicit error-size assumption if modeled; they do not automatically use successful response size.
- Required full-duplex bandwidth is calculated independently for each direction: `bitsPerSecond / targetUtilization`. Shared duplex uses the sum on the same time axis. Round to the knob's declared increment and respect locks.
- Edge bandwidth-drop and node faults modify the bound resource once. Time-integrated available capacity changes utilization denominators. Pool failure at zero capacity can stall until timeout; it must not clamp to one byte/s.
- Canvas overlays use full-run connection/pool aggregates, with trace samples only for drill-down.

## Acceptance cases

1. Two simultaneous one-MB responses on an 8-Mbit/s pool require two seconds of aggregate service under DP-06 sharing, excluding separate propagation latency.
2. A 1,000-byte request and 9,000-byte response report those exact directional byte totals. Increasing response size changes response completion time and egress demand.
3. Simultaneous one-MB upload and download finish their transfer work in one second with independent 8-Mbit/s directions and two seconds on one shared 8-Mbit/s pool.
4. A selected route's response returns over that route even when forward routing weights later change. Missing reverse Canvas edges do not erase response bytes.
5. A 50% bandwidth fault halves shared capacity once. Cancelling a partly served response conserves bytes and does not report it as a complete response.
6. Applying a bandwidth proposal reduces the isolated link backlog; increasing Service replicas alone does not fix it. Trace retention does not change overlays or totals.
7. Legacy fixture results are unchanged on import. Explicit behavior upgrade changes its snapshot/version and recomputes planning results.

## Completion evidence

- [ ] Direction, response ownership, shared contention, faults, and compatibility cases pass.
- [ ] Network adapter and Canvas congestion browser flow pass.
- [ ] Focused checks and `pnpm check` pass; transfer approximations and commit are logged here.
