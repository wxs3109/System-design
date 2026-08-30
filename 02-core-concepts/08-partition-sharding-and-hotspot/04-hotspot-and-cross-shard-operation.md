# Hotspot and Cross-shard Operation

## 1. There are different types of hotspots

| Types | Examples | Common Signals |
|---|---|---|
| Hot keys | Star posts, popular products | Single key QPS/lock conflict is high |
| Hot partition | Large tenants, popular events | Single partition CPU, queue, P99 high |
| Hot Range | Monotonic Time Write End | Last Range Write IOPS High |
| Hot nodes | Multiple medium-hot partitions accidentally co-located | Node load is high but no single hot spot |
| Hot dependency | All Shards access the same Registry | Each shard is normal and public services are saturated |

Average QPS masks hotspots; Top-K, skew factor, and queue age must be logged by key/partition/tenant.

## 2. Read hot topics

Can be combined with: CDN/multi-level caching, request merging, read replicas, precomputation and hotspot replication.

After copying a hot key, reads are more dispersed, but write failure and consistency are more complicated. Inventories, permissions, and balances cannot be finalized by stale cache alone; they can be exposed to read cache and confirmed writes back to authoritative shards.

## 3. Write hot spots

Writing hotspots is harder because the same invariant usually needs to be serialized. Options include:

- **Batch/Combiner**: Combine Like, View, etc. Commutative Increment;
- **Striped Counter**: Split the count into multiple buckets and sum them when reading;
- **Single Writer + Queue**: Keep the order and do Queue Buffering, but there is still an upper limit on Throughput;
- **Pre-allocation**: Allocate detachable inventory/Quota to multiple Sub-partitions;
- **Change business path**: Celebrity Account switches from Fan-out on Write to Fan-out on Read.

Trade-off is the exact real-time value, Write Throughput, Read Cost and implementation complexity. For example, Bucketed Counter can improve Write Throughput, but the real-time accurate total requires querying all Buckets; Async Aggregation will generate Freshness Window.

## 4. Cross-shard reading

Scatter-gather will cause the number of requests and tail latency to grow with the number of shards:

$$
P(\text{At least one shard is slow}) = 1 - (1-p)^N
$$

If the probability of a single-shard slow request is $p$, the probability of at least one slow request after accessing $N$ shards will be magnified. Common optimizations:

- Create derived indexes organized by query dimensions;
- Limit the number of fan-outs and deadlines;
- Hierarchical aggregation, returning partial results and indicating completeness;
- Top-K first partially truncates each shard and then merges it;
- Co-locate high-frequency paging data by owner.

Derived indexes reduce read costs but increase write amplification, asynchronous consistency, and reconstruction processes.

## 5. Cross-shard writing and transactions

Prioritize changing the data model so that invariants fall on a single shard. When you really need to cross shards, choose:

- 2PC: Strong atomicity, but high coordination, lock holding and failure recovery costs;
- Saga: Each step is submitted and compensated locally, suitable for compensable business processes;
- Reservation/Escrow: Reserve quota locally first and then complete the business;
- Asynchronous derivation: Only one fact is submitted synchronously and the rest are updated via Outbox.

Transfers, locks, etc. cannot just rely on "eventual post-consistency correction" to hide invariants; notifications, search indexes, and statistics can usually be asynchronous.

## 6. Multi-tenant hot spots and fairness

A large tenant can overwhelm a shared shard. In addition to migrating to dedicated shards, limit ingress concurrency, queue weights, background replay rates, and storage quotas on a per-tenant basis. Otherwise, even if the data is uniform, expensive queries from a certain tenant will still form noisy neighbors.

[Previous section: Rebalancing and migration](03-rebalancing-migration-and-failure.md) · [Return to the entrance of this chapter](README.md) · [Next section: Cases and checklist](05-case-study-and-design-checklist.md)
