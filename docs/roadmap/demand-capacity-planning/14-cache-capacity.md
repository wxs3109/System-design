# DP-14: Cache capacity

> Status: not started. Depends on DP-04. Extension milestone: M5.

[Roadmap and part index](./README.md) · [Shared contracts](./shared-contracts.md)

## Outcome and scope

Explain Cache request capacity, entry limits, and memory working-set estimates without claiming an arbitrary cache size guarantees a hit rate. This part covers the generic Cache behavior; CDN byte-hit and delivery resources remain owned by DP-08.

## Input and output contract

Inputs reference cache-key contracts, projected get/put/delete rates, key and value-size distributions, declared target working set, TTL, entry overhead, and current entry/concurrency limits. A target working set is an explicit assumption or compatible observation, never automatically the full population.

Outputs separate request slots, logical entry count, payload bytes, estimated memory bytes, hit/miss assumptions, observed hits/misses/evictions, and downstream demand. Recommend supported entry capacity and request concurrency; node/server counts and physical memory remain estimated-only unless a later behavior implements them.

## Execution and sizing rules

- Request-slot sizing uses operation-weighted executed holding time and utilization. Working-set sizing uses declared live entries and value/key/metadata sizes, with TTL and eviction assumptions visible.
- A count-based cache can apply an entry-capacity proposal. Its memory estimate cannot be treated as an enforced byte limit. The adapter lists entry capacity as executable and memory bytes as estimated-only for that version.
- Do not convert memory bytes into entries using an unexplained average when a size distribution is available. Report mean estimate and declared high-size scenario separately; unknown overhead remains incomplete.
- Increasing entries can change cache outcomes and downstream demand. Freeze branch assumptions within one analytic proposal and require a rerun/recalculation before claiming the new hit rate validates downstream sizing.
- Keep request hit ratio and byte hit ratio distinct. Cache replication and shared node counts require an explicit physical ownership model; a generic multiplier cannot create executable replicas.
- Hot keys constrain the actual modeled cache/shard resource only where such a resource exists. Do not invent contention from key popularity alone.

## Acceptance cases

1. A declared working set of 1,000 entries with 100-byte values and 20-byte key/metadata overhead requires an estimated 120,000 memory bytes before explicit reserve. A 1,000-entry limit remains a count constraint.
2. An equal-size fixture with capacity below its working set exhibits the runtime's documented eviction behavior. Increasing entry capacity changes observed cache outcomes without guaranteeing a universal hit percentage.
3. A missing overhead assumption leaves memory sizing incomplete while request-slot sizing remains available.
4. A changed cache capacity invalidates calibrated downstream miss demand; old observations are not silently reused as compatible evidence.
5. A request-hit fixture with unequal item sizes reports a different byte-hit ratio and preserves downstream byte attribution.

## Completion evidence

- [ ] Entry/byte distinction, working-set inputs, eviction comparison, and calibration invalidation pass.
- [ ] Adapter support labels and Cache control/formula browser flow pass.
- [ ] Focused checks and `pnpm check` pass; unsupported physical dimensions and commit are logged here.
