# Partition, Sharding and Hotspot

Sharding is used to break through the Capacity, Storage or Failure Domain upper limit of a single Node. It's not the default answer to "get bigger": once sharded, Routing, Cross-shard Query, Transaction, Uniqueness, Rebalancing and Recovery all become part of the system protocol.

Answers in this chapter:

- When is sharding really necessary, and when is replication, caching or vertical scaling more appropriate?
- How to select Shard Key from Access Pattern, Invariant and Tenant Boundary;
- Respective trade-off for Range, Hash, Directory and composite partitions;
- How to perform Online Rebalancing without losing writes or duplicating Commits;
- How to handle Hot Key, Noisy Neighbor, Celebrity Account and Cross-shard Query;
- How to use principles for News Feed, Chat, Ticket Booking and multi-tenant platforms.

## Chapter Navigation

1. [When is Sharding needed](01-when-is-sharding-needed.md)
2. [Shard Key and Routing Strategy](02-shard-key-and-routing-strategy.md)
3. [Rebalancing, Migration and Failure](03-rebalancing-migration-and-failure.md)
4. [Hotspot and Cross-shard Operation](04-hotspot-and-cross-shard-operation.md)
5. [Case Deduction and Checklist](05-case-study-and-design-checklist.md)

## Remember three differences first

- **Partition** is a logical partition of data or work; **Shard** often refers to a physical storage unit that hosts one or more partitions. In practice terms may be used interchangeably and should be defined first in the design document.
- **Replication** replicates the same data to improve availability or readability; **Sharding** splits different data to increase total capacity.
- **Uniform data volume** does not equal uniform load. A popular object with a small footprint can also consume a large portion of QPS.

## Core Trade-off

$$
\text{Total capacity improvement} \quad \Longleftrightarrow \quad \text{Routing, coordination, migration and hotspot complexity}
$$

A good sharding scheme is not about making the data look even, but about making the majority of requests fall within a small number, preferably one shard, while limiting strong invariants to the same bounds.
