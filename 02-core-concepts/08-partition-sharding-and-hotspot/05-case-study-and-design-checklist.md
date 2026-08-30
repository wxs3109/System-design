# Case study and design checklist

## 1. News Feed: Why separate Feed Inbox by viewer?

The main access to the home page is to "read a user's recent FeedItem and perform cursor paging". Sharding by `viewer_id` enables reading, sorting, and paging to fall into one logical partition.

The price is that Fan-out on Write needs to write to a large number of Viewer partitions, and Celebrity Author posts will produce extreme Fan-out. The solution is not to change to a global random key, but to Hybrid Fan-out: ordinary authors write to Inbox asynchronously; Celebrity Author maintains the Author Timeline and merges it when reading. For the case, see [News Feed Sharding Extension](../../06-case-design/02-specific-application-system/03-news-feed/07-sharding-extension-news-feed/README.md).

## 2. Chat: Session order and very large sessions

Sharding by `conversation_id` allows the same session to be assigned increasing sequence numbers by an authoritative partition, making regular reads and writes local. Large group chats can create hot spots:

- Message facts are still ordered by the session partition;
- Online push is performed in parallel by receiver or Gateway partition;
- History records are stored as `(conversation_id, time_bucket)`;
- Use stable Cursor for cross-bucket paging;
- Member changes are versioned to prevent old members from receiving new messages.

This separates "sequential facts" from "Fan-out derivation work" rather than giving up conversational order for throughput.

## 3. Ticket Booking: Consistency-first hotspot

The popular event became a hot spot for single-partition writing as soon as it went on sale. Can:

- Entrance queue and issue short-term admission token;
- Pre-zoning by seat area, and continuous seat query spans a small number of areas;
- Reserve usage conditions writing and expiration time;
- Only the inventory owner of the current epoch is allowed to confirm;
- The seat map is read from the cache and the confirmation is still returned to the authoritative shard.

Multiple Regions cannot confirm the same seat and then merge it later; this will violate the overbooking policy. Choosing lower write availability is a clear trade-off of the consistency boundary.

## 4. Multi-tenant platform: Directory + Cell

Small tenants share the Cell, and large tenants can migrate to dedicated Cells. Control plane maintenance `tenant_id -> cell_id, placement_epoch`; data plane request carries mapping version, old Cell rejects newer epoch.

Migration uses snapshots, incremental catch-up, verification, and short cutovers. Analysis tasks, backfill, and online queries use independent concurrency budgets to prevent migration traffic from creating noisy neighbors. For the case, see [Multi-tenant Platform](../../06-case-design/03-platform-system/01-multi-tenant-data-platform/README.md).

## 5. Common mistakes

| Expression | Question | What should be added |
|---|---|---|
| "Hash by user ID, the data will be uniform" | User load is highly skewed | Top-K, large splitters and hotspot paths |
| "Adding nodes will automatically balance" | Data migration is not instantaneous | Snapshots, log catch-up, epoch, verification |
| "Each Shard has a unique index" | Not globally unique | Authoritative routing or Registry |
| "Query accesses all Shards concurrently" | P99 and cost scale with N | Derived indexes, fan-out caps, partial results |
| "Dual-write Migration implements Zero Downtime" | Possible Out-of-order, Missing Writes, Hard Rollback | Single Writer, Idempotent Log and Reconciliation |
| "Hotspot solves the problem by splitting Buckets" | Read/transaction costs are transferred | Aggregation, Freshness and Consistency semantics |

## 6. Design Checklist

- What is the measurable hard upper limit that sharding needs to break?
- Why are replicas, caches, indexes, or vertical scaling not enough?
- How many shards do the most common reads and writes access?
- What invariants and ordering requirements must be colocated?
- Are the data volume, QPS, CPU and growth rate of the key uniform?
- Can a single key be split after it becomes hot? How to queue and limit the flow when it cannot be split?
- Who maintains the routing table, and how to detect version expiration?
- How do new writes after the Snapshot catch up to the target during capacity expansion?
- How to ensure a single writer and fencing the old owner during Cutover?
- Does Migration cover Tombstone, Index, Message Offset and Deduplication Record at the same time?
- What are the deadline, partial failure and paging semantics for cross-shard queries?
- Where are global unique constraints enforced?
- Does migration/backfill have independent speed limit, pause and rollback capabilities?
- How to observe loads and hotspots by tenant, key, and partition?

[Previous section: Hotspots and cross-shard operations](04-hotspot-and-cross-shard-operation.md) · [Return to the entrance of this chapter](README.md)
