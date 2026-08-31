# Product Capability and Application Responsibility

Many hosting products already have built-in replication, automatic failover, sharding, backup, and monitoring. Using them can reduce implementation and daily operation and maintenance, but cannot omit topology selection, business semantics and recovery design.

| Capabilities | What the product generally delivers | The application remains responsible |
|---|---|---|
| Database transactions | Atomic commit, isolation level, constraints | Business invariants, transaction boundaries, timeout retry |
| Replication | Replica, primary election, failover | Read-write consistency, stale window, unknown result |
| Auto-sharding | Routing, migration, node expansion | Sharding keys, hotspots, cross-shard queries and transactions |
| Message Queue | Persistence, Redelivery, DLQ | Dual Write, Idempotency, Poison Message, Backlog and Reconciliation |
| Kafka/Event Streaming | Partition Log, Offset, Replay | Partition Key, Schema, Business Sequence, Repeating Side Effects |
| Workflow engine | Timer, state persistence, activity retry | State machine, compensation, activity idempotence, manual processing |
| Redis Cache | TTL, Eviction, Cluster | Key, Invalidation, Cache Stampede, Origin Protection and Staleness Tolerance |
| Search engine | Inverted index, correlation, aggregation | Data synchronization, versions, permissions, deletion and reconstruction |
| Object Storage | Large Object Persistence, Lifecycle | Metadata Transactions, Orphan Objects, Access and Recovery |
| CDN | Global Edge Cache、Origin Fetch | Cache Key、TTL、Private Content、Active Invalidation |
| Hosted monitoring | Basic indicators and log exports | SLI/SLO, business alarms, Trace and response processes |

## Multi-region and disaster recovery still need to be decided

Synchronous replication reduces the risk of confirmed write loss, but increases latency and may reject writes when there are insufficient replicas; asynchronous replication has lower latency, but risks replication lag and loss of recent writes during failover.

Active-Active must also answer: Can the same object be modified concurrently in two regions, how to resolve conflicts, and whether funds, inventory, and permissions are allowed to be merged. Writes that cannot be safely merged should generally retain a single authoritative order.

A copy is not a backup. Accidental deletions and logical corruption may be replicated to all online replicas, and RPO, RTO, backup retention, immutability, recovery sequence and business reconciliation need to be independently defined.

## Three types of responsibilities that cannot be completely outsourced

- **Business Semantics**: The product does not know that a ticket can only be sold once and the refund cannot exceed the original payment. These invariants must be expressed by data models, conditional updates, and state machines.
- **Cross Product Boundaries**: Database, Broker, Search, Cache and Object Storage generally cannot participate in the same simple atomic transaction, requiring Outbox, CDC, Idempotence, Replay and Reconciliation.
- **Acceptance and Recovery**: The console shows that the copy is healthy, which does not mean that the user data is correct. Still need to verify that orders and ledgers, objects and metadata, indexes and fact sources match.

## Product Contract Template

Every time a product is introduced, at least six items should be recorded: product name, problem solved, relied-upon guarantees, non-provided guarantees, application responsibilities, and fault recovery methods.

For example, managed Kafka addresses event persistence, consumer decoupling, and replay; the design relies on ordering within partitions. It does not guarantee global ordering or business side effects across partitions exactly once, so the application still requires Outbox, event idempotence, Schema compatibility, backlog alerts, replay, and reconciliation.

[How to correctly understand product warranty](01-correctly-understand-the-product-has-been-made.md) · [Return to navigation entry](README.md)
