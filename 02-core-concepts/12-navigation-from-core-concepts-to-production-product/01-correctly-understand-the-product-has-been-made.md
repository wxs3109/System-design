# Correctly understand "the product has been made"

Mature products have indeed implemented many difficult mechanisms: database replication, leader election, shard routing, message persistence, consumer groups, cache eviction, and object multiple copies. Application designers generally should not re-create this infrastructure.

The problem is that "the product supports a certain capability" does not mean "the business is automatically correct."

## Switch from product name to usage contract

Don't just say:

> Use Kafka, so messages are not lost.

It should be said:

> Use managed Kafka to save the event stream; the producer waits for the specified confirmation and the topic sets enough replicas. The database generates events through Outbox, and consumers are idempotent by event ID. The system monitors the age of the oldest messages and handles omissions through replay and source-of-fact reconciliation.

The first sentence only contains the product name, while the latter sentence explains the design-dependent guarantee and application responsibility.

## A pledge to ask at least six questions

1. **Object scope**: Is the guarantee for a single key, a single partition, a single transaction, or globally?
2. **Operation scope**: Are ordinary read and write, conditional write, batch operation and transaction the same?
3. **Topology scope**: Are single node, single availability zone, same region and cross-region the same?
4. **Configuration conditions**: What are the read and write levels, number of replicas, number of acknowledgments, and routing mode?
5. **Failure Semantics**: Does Timeout indicate failure, or is the result unknown? Reject or continue to accept during partition?
6. **Recovery Semantics**: Is it possible for old reads, duplicates, rollback of confirmed writes or conflicts after failover?

Therefore, it is not appropriate to permanently label a product as "CP database" or "AP database". The actual semantics of MongoDB, Cassandra, Cosmos DB, and DynamoDB are all affected by operations, configuration, index type, geographic topology, and how clients read and write.

## What can be abstracted?

Application-level system design can usually consider the following as internal product implementations:

- Message format and election code of consensus protocol;
- The specific layout of the storage engine page, WAL or SSTable;
- Internal state machine of Broker Controller;
- Implementation of hash slot migration for distributed cache;
- How each copy is placed inside the object store.

But these external behaviors cannot be abstracted:

- How many confirmations are needed for successful writing;
- Will the reading become stale;
- To what granularity is the order guaranteed?
- Whether duplicate delivery is possible;
- Single key, single partition and cross-partition restrictions;
- RPO, RTO, backup and recovery verification;
- Quotas, hotspots, capacity and costs.

## When you need to know more

When encountering the following situations, you should drill down to one level of mechanism:

- Product warranty cannot explain online anomalies;
- P99, cost or hot spots have become core bottlenecks;
- Need to design database, messaging system or scheduling platform itself;
- The interviewer clearly asked about the principles of replication, Quorum, Consumer Rebalance, etc.;
- Evaluating two seemingly identical products with different failure semantics.

The goal of drill-down is still to support decision-making, not to recite the implementation source code.

[Product capabilities and application responsibility boundaries](05-product-capability-and-application-responsibility.md) · [Return to navigation entry](README.md)
