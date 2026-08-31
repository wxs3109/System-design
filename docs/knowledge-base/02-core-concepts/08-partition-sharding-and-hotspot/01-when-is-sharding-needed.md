# When is Sharding needed?

## 1. First use evidence to prove that a single node is the bottleneck

Make sure there is at least one hard constraint before considering sharding:

- The data set or index is close to the safe capacity of a single node;
- Peak write throughput, IOPS, CPU, or number of connections cannot be met within the SLO;
- Single node maintenance, backup, recovery or reconstruction time exceeds RTO;
- Need to segregate data by tenant, geography or compliance boundaries;
- The impact scope of a single fault domain is too large and needs to be cellized.

Just because "users may grow" is not enough. Sharding introduces routing metadata, migration, cross-shard aggregation, distributed uniqueness, and operational tools immediately, while the benefits may not appear until years later.

## 2. Alternatives before sharding

| Bottleneck | Try first | When sharding is still needed |
|---|---|---|
| Read QPS | Cache, read-only replica, index, request merging | Working set and read throughput still exceed the capabilities of a single cluster |
| Write latency | Shorten transactions, batch processing, asynchronous derived writes, optimize indexes | Authoritative write throughput still reaches the upper limit |
| Storage | Archiving cold data, compressing, detaching blobs | Online data still exceeds safe capacity |
| Hotspot query | Dedicated cache, precomputation, read replica | Writing hotspot or single key is still a bottleneck |
| Impact of failure | Multiple replicas, multiple availability zones | Single cluster blast radius/RTO is still too large |
| Multi-tenant interference | Quotas, connection pools, and queue isolation | Large tenants require independent capacity or compliance isolation |

Vertical expansion and replication are usually simpler, but have hard upper limits; sharding can approximately expand the total capacity horizontally, but cannot automatically solve a single hotspot key.

## 3. Define the sharding boundary first

When selecting boundaries, give priority to co-locating the following objects:

- Data that are often read together;
- Transactions or conditions are required to write data that holds the same invariant;
- Events with strict sequence requirements;
- Same data lifecycle and data residency requirements.

For example, ticketing can use `show_id` as the inventory partition boundary. Seat locks and confirmations for the same event fall in an authoritative shard, so it is easy to maintain "no overbooking"; if divided by `user_id`, two users competing for the same seat will be coordinated across shards. The price is that popular events become hot spots and may require queuing or further dividing the event into seating areas. However, after splitting, cross-region seat search will be more complicated.

## 4. Separate logical partitions from physical shards

Do not pin `hash(key) % Current number of machines` directly. When the machine increases from 16 to 17, almost all keys are remapped, and the migration is uncontrollable. A more stable model is:

```text
Business key -> A large number of logical partitions/virtual nodes -> A small number of physical shards
```

The number of logical partitions is significantly greater than the number of machines. During expansion, only some logical partitions are moved; the routing table is versioned and managed by the control plane. The trade-off is the need for metadata services, cache flushing, and migration protocols.

## 5. Cell is a coarser-grained partition

When the goal is to limit the explosion radius rather than just increasing database capacity, a group of calculations, queues, caches, and storage can be composed into a Cell, and tenants or users can be mapped to the Cell.

Benefits: A single cell failure only affects a subset of users, and capacity and distribution can be managed on a cell-by-cell basis. Cost: More complex cross-cell queries, global uniqueness, tenant migration, and control plane mapping. Fragmentation may still continue within the Cell.

[Return to the entrance of this chapter](README.md) · [Next section: Sharding keys and routing](02-shard-key-and-routing-strategy.md)
