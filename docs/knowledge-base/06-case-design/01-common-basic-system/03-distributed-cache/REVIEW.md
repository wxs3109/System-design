# Distributed Cache Refactoring Review

## in conclusion

The original README is a 47-line list of topics: the content direction is mostly correct, but algorithms, application models, cluster internals, and production items appear side by side. There is no explanation of why the mechanism was introduced, and there are no exercises and stopping conditions.

After refactoring there is only one default path:

```text
README
→ 01-Progressive design main line
→ 02-Review and practice
→ Stop
```

## What remains in the main line?

Keep only content that changes the cache service contract, schema, dominant capacity, or failure consequences:

- Cache is a lossy derived copy, Source of Truth is external.
- Different semantics of `HIT / MISS / ERROR`, TTL and Eviction.
- After the working set and QPS exceed a single node, it is divided according to Key.
- Routing Snapshot, Ownership Generation and Controlled Rebalancing.
- Asynchronous Replica improves availability, but recent cache writes may still be lost.
- Origin Miss QPS, Cold Start, Stampede and Fallback Budget.
- Different borders for Hot Partition, Hot Key, Big Key and Hot Tenant.

The causal chain becomes:

```text
Repeated reading
→ Single node memory cache
→ Limited memory
→ TTL + Eviction
→Insufficient capacity of a single node
→ Key Sharding
→ Member changes
→ Version routing + batch rebalancing
→ Node failure
→ Async Replica + Failover
→ Miss Zoom and Hotspot
→ Coalescing + Origin Budget + Quarantine
```

## What is isolated?

[`optional/Cache and source data boundary.md`](optional/optional-cache-and-source-data-boundaries.md) Only reserved:

- Deleting the Cache after submitting the Source still has a stale window.
- Late Fill timeline.
- Upgrade conditions for Conditional Fill, Version Floor and reliable failure.

[`optional/Shard Migration and Hotspots.md`](optional/optional-shard-migration-and-hotspots.md) Only reserved:

- Selection boundaries for Logical Partition, Consistent Hashing and Rendezvous.
- Client / Proxy Routing。
- The trade-off between Lazy Fill, Pre-warm and Copy.
- Classification of Hot Partition, Hot Key and Big Key.

Multi-Region, Write-Behind/Persistence KV, full Redis product, and membership management protocol in [Parking Lot](PARKING-LOT.md).

## What is omitted

- Redis/Memcached command and product feature matrix.
- Accurate LRU/LFU implementation, hash ring code and number of virtual nodes.
- Fixed number of nodes, timeouts, memory Watermarks and migration thresholds.
- Complete API, Key encoding, Value Schema and serialization specifications.
- Complete Cache-Aside, Read-Through, Write-Through and Write-Behind tutorials.
- Metadata consensus, split-brain recovery and online migration state machine.
- Complete monitoring, RBAC, auditing, billing, console and DR runbooks.

This content has engineering value but should not block first-time learning.

## Current granularity and stopping point

- `README.md`: Learning Contract, External Contract, Architecture Map and Completion Standards.
- `01-Progressive Design Main Line.md`: The only main line of knowledge.
- `02-Review and Practice.md`: Closed-book derivation, capacity, faults, races, and boundary acceptance.
- `optional/`: Two on-demand puzzles that are not prerequisites for completion.
- `PARKING-LOT.md`: Only record reopening conditions.

This case ends after the learner can introduce sharding, rebalancing, failover and origin protection from a single node in a closed book, explain cache loss, staleness and hotspot boundaries, and complete a working set and Miss QPS estimation.
