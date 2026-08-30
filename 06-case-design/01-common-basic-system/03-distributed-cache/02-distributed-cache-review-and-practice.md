# Distributed Cache: review and practice

This article does not introduce new knowledge, but only tests whether the design can be re-derived without the document. Read [Progressive Design Mainline](../01-load-balancer/01-load-balancer-progressive-design-mainline.md) first, then close the document and complete it within 45–60 minutes.

Use the same framework for each answer:

```text
stress or malfunction
→ Why the current solution failed
→ Minimal new mechanism
→ Guarantee obtained
→ Cost and Boundary
→ a verification signal
```

Does not require full API, Redis commands, exact node count, hash ring code, migration protocol, or multi-region design.

## 1. Fixed learning contract

Limited to 5 minutes:

1. Describe the responsibilities of Distributed Cache in one sentence.
2. What do `HIT`, `MISS`, timeout and `ERROR` mean respectively?
3. After `SET + TTL` succeeds, what can the caller rely on and what cannot it rely on?
4. Write three data types that cannot inherit the ordinary cache contract.
5. Why does "Cache can be lost" not equal to "Cache does not require high availability"?

Passing Criteria: The Source of Truth is outside the Cache; cache loss does not permanently destroy the truth, but the failure may still cause user error and Origin overload. A normal cache does not promise up-to-date reads, durable writes, or cross-key atomicity.

## 2. Rebuild a single-node minimum system

Limited time 8 minutes:

1. Draw the paths of `Service → Cache` and `MISS → Origin`.
2. Describe the failure after a Hit, a Miss + Fill and a Source write.
3. When Cache Fill fails, should this authoritative read fail? Why?
4. What problems do TTL and Eviction solve respectively? Why does TTL not guarantee that Entry will survive until expiration?
5. Why might precise LRU make each read more expensive? Does the core need to rely on "accuracy"?

Passing criteria: being able to use Cache as an optimization layer instead of a transaction fact, and use Staleness Window to determine TTL instead of just using Hit Rate parameter adjustment.

## 3. Let pressure push out the structure

Don’t draw the final drawing first. Fill in the following:

| Stress or failure | Why current solutions fail | Minimal mechanisms | New guarantees | Costs/bounds |
|---|---|---|---|---|
| Active working set exceeds single node memory | | | | |
| Peak QPS/Bandwidth exceeds single node | | | | |
| Changes in the number of nodes lead to large-area remapping | | | | |
| A Partition Owner failure | | | | |
| Cold Start causes Hit Rate to plummet | | | | |
| One Hot Key is fully occupied by Owner | | | | |

When completed, you should naturally get:

```text
Single node memory cache
→ TTL + Eviction
→ Key Sharding + Routing Snapshot
→ Stable mapping + batch rebalancing
→ Async Replica + Ownership Generation
→ Coalescing + Origin Budget
→ Hot Key isolation, and conditional L1/read replication
```

Passing criteria: Each mechanism has a clear source of stress; "Redis Cluster generally has it" cannot be used as a reason.

## 4. Capacity and return to source estimation

Assume using this case: $N_{active}=10^9$, $B_{value}\approx2\ \text{KB}$, $Q_r=5{,}000{,}000/s$, Origin additional security capacity is $100{,}000/s$.

1. Use $M_{payload}=N_{active}B_{value}$ to estimate the Value Payload. Why do keys, metadata, replicas, shards, and margins need to be estimated later instead of pretending to have the exact number of nodes?
2. Use $BW_{read}\approx Q_rH B_{value}$ to estimate the logical hit read bandwidth when $H=99\%$ and the average Value is 2 KB. Why can it also launch shards independently?
3. Use $Q_{origin}=Q_r(1-H)$ to calculate the back-to-origin QPS when $H=99\%$ and $H=80\%$ respectively.
4. What architectural conclusions are drawn from these results?
5. Why is global hit rate not provably safe? What other distributions should be examined?
6. What real measurements can determine the Shard number, Replica number and recovery speed?

Passing criteria: Value Payload is about $2\ \text{TB}$, logical hit read bandwidth is about $10\ \text{GB/s}$; normal 99% Hit Rate still has $50{,}000/s$ back to the source, and reaches $1{,}000{,}000/s$ at 80%, so neither capacity nor Cold Start can only look at Hit Rate.

## 5. Routing, rebalancing and Failover

1. Why is it easy for `hash(key) mod nodeCount` to create a large area of ​​Cold Miss when the number of nodes changes?
2. What do Logical Partition and Routing Snapshot provide respectively?
3. Why shouldn't the Control Plane enter the `GET` path every time? What can and cannot be done when it is unavailable?
4. When switching Ownership in batches, what indicators determine whether to continue, pause or roll back?
5. If Owner fails before and after asynchronous replication, what might the caller see?
6. Why can’t the old Generation continue to accept requests after the old Owner is restored?

Passing criteria: Member changes only remap part of the Partition; Metadata Authority serializes Failover through Ownership Lease/isolation and monotonic Generation. Replica improves availability, but the recent `SET` can be lost, and the recent `DELETE` can be briefly revived.

## 6. Stampede, Hotspots and Isolation

1. When a Hot Key is Missed at the same time, why does adding a normal Shard have no effect?
2. What can Request Coalescing reduce per instance? Why does Fleet total resourcing still require an executable global/tenant/single Key Budget?
3. What can a TTL Jitter alleviate and what can’t it fix?
4. Distinguish between Hot Partition, Hot Key, Big Key and Hot Tenant, and give a minimum mechanism for each category.
5. When can I use L1 or hot read replicas? What do they sacrifice?

Passing criteria: The recovery goal is to protect Origin and other tenants, not to bring the global hit rate back to a number as soon as possible. L1 and read replication only hold true if staleness is allowed.

## 7. Source of Truth Boundary

Construct the following interleave: Reader reads the old version from Origin and then pauses; Writer commits the new version and deletes the Cache; Reader then backfills the old version.

answer:

1. Why does "write Source first, then delete Cache" still not guarantee that old data will never be read?
2. TTL limits the length of time that can be returned from Fill time; why does it alone not justify the maximum staleness window relative to Source commit time?
3. Which operations are suitable for accepting bounded staleness, and which ones should Bypass Cache or fall back to authoritative reading?

Choose a boundary question: Value only carries Version, why can’t it necessarily prevent Late Fill after the Cache has been deleted? What real requirements warrant reopening a Conditional Fill, Version Floor, or reliable failure event?

Passing criteria: Ability to provide an aging timeline without extending the cache service into a Database-Cache distributed transaction. Stronger semantics for on-demand reading [cache and source data boundaries](./optional/optional-cache-and-source-data-boundaries.md).

## 8. Boundary judgment and completion judgment

Determine whether the following changes should be entered into Optional, Parking Lot, or a separate case, and indicate which contract is changed:

1. Session loss will cause the user to log out.
2. Cached writes must never be lost after a machine failure.
3. Write-Behind accepts writing and then asynchronously logs into the database.
4. The three Regions must not see the old value within 1 second after the permission is revoked.
5. List, Sorted Set, Lua and cross-Key transactions are required to form a complete Redis product.
6. A single Hot Key with more reads and fewer writes has exceeded the Owner limit, but is allowed to be stale for 5 seconds.

Finally, give ten minutes of dictation:

1. 2 minutes: Contracts, minimum nodes, TTL and Eviction.
2. 3 minutes: Sharding rollout from capacity and controlled rebalancing.
3. 2 minutes: Explain Replica, Ownership Generation and Failover boundaries.
4. 2 minutes: Explain Cold Start, Stampede and Hot Key.
5. 1 minute: three trade-offs, a rejection scenario and a stopping point.

After everything is satisfied, this case ends:

- Ability to push components out of pressure rather than product topology.
- Can explain what sharding expands, what Failover preserves, and what Cache may still lose.
- Can estimate the magnitude of working set and Miss QPS.
- Ability to get through a stale race condition and account for caller responsibility.
- Able to keep multi-region, persistent KV, rich product capabilities and governance platform outside the current scope.

Stop after final dictation; no more Distributed Cache product details are added without new real contracts or measurement bottlenecks.
