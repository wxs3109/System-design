# The boundary between Transaction Isolation and Distributed Consistency

ACID Transaction, Consistency Model and CAP are often confused, but they actually focus on different levels:

- **Atomicity**: A group of writes either all occur or none occur;
- **Isolation**: What concurrent transactions are allowed to observe each other;
- **Replication Consistency**: In what order do different replicas and different clients see these writes;
- **CAP**: When Network Partition occurs, how to choose between consistent response and continuous response;
- **Business Consistency**: Whether Invariants such as balance conservation and no oversold are established.

So this situation is entirely possible: a database's transactions on the Primary fully satisfy ACID, but its read-only copy still exposes old data; or it provides Linearizable single-Key operations but does not provide cross-Key atomic transactions.

## What exceptions does Isolation Level solve respectively?

| Isolation / Semantics | Approximate guarantee | Still need to pay attention |
|---|---|---|
| Read Committed | Uncommitted data will not be read | Whether Non-Repeatable Read, Phantom Read, Lost Update, Write Skew occurs depends on the implementation |
| Repeatable Read | Repeated reads within the same transaction are relatively stable | Each product has different definitions of Phantom Read and snapshot semantics |
| Snapshot Isolation | Transactions read a consistent snapshot, which usually blocks Write-Write conflicts | Write Skew may still corrupt cross-row Invariant |
| Serializable | The result is equivalent to a certain serial execution order | May need to be retried and may not respect the true time order |
| Strict Serializable | Serializable plus real-time sequencing, close to transaction-level Linearizability | The highest cost of coordination, latency and availability |

The specific behavior must be subject to the documentation of the database you are using - it is also called Repeatable Read, and the implementation of MySQL and PostgreSQL is different.

## Example: Write Skew under Snapshot Isolation

The hospital requires at least one doctor on duty at any time. In the initial state, both A and B are on duty:

1. Transaction T1 reads A and B and sees that B is on duty, so it changes A to rest;
2. Concurrent transaction T2 reads the same snapshot and sees that A is on duty, so it changes B to rest;
3. The two transactions write different lines, there is no Write-Write conflict, and both are submitted successfully;
4. Eventually no one was on duty - the Invariant across rows was destroyed.

There are three ways to fix it: upgrade to Serializable, explicitly lock a common schedule aggregate row, or remodel it into an authoritative object that can do Conditional Update (such as a row `on_duty_count`).

This shows that "I used a transaction" does not mean that all business Invariants are automatically established - transactions protect rows, and this Invariant spans rows.

## Example: The transaction is successful, but the read replica is still old

The user uses a transaction on the Primary to change both the nickname and the avatar, and the submission is successful; the next GET is routed to an asynchronous Follower, and the old information is returned. The Atomicity of the original transaction is not broken at all, but the bad thing is that the read path does not have Read-Your-Writes.

Solution:

- Read Primary within a short time after writing;
- Bring Commit LSN and wait for Follower to catch up to this position;
- The response returns Version Token, and declares a minimum version when reading;
- or explicitly accept the old value - but that doesn't usually make sense for the "edit profile" scenario.

## Prioritize single-database transactions, don’t use distributed transactions too early

If a strong Invariant can be restricted to a single database/single shard through partition keys and data modeling, let local transactions take care of it. Cross-service Two-Phase Commit will bring about coordinator recovery, long-term lock holding, participant blocking, cross-region delay, and operation and maintenance complexity.

For example: If orders and inventory must be submitted strictly atomically, you can consider putting inventory reservation and order core status into the same authority boundary; if they really belong to two independent services, you must clearly choose a path:

- **Distributed Transaction**: get atomic commit, but bear the availability cost caused by the coordinator; or
- **Saga/Workflow**: Use a series of local transactions plus compensation to achieve final business consistency, at the cost of making the intermediate state visible to the outside world.

## Cross-service transactions: You just need to draw a clear boundary here

A travel booking Saga might reserve flights, hotels, and rental cars in that order. The hotel's failure to cancel the flight is a new business operation, and it does not erase the fact that the user or external system has seen that the flight has been reserved.

The point is: CAP, Transaction Isolation, and cross-service atomicity are three different issues. For complete selection of Saga, 2PC, Lock, compensation and reconciliation, see [Concurrency Control and Distributed Transactions](../09-concurrency-control-and-distributed-transactions/); in the chapter on consistency, you only need to check these boundaries:

- Which services, shards and external systems this consistency requirement spans;
- Whether the user can see the intermediate state, and whether it can be undone after seeing it;
- During Partition or timeout, choose to block, reject, or accept first and compensate later;
- Replica Read and Cache will not let the workflow see the old state.

For the capital ledger, a reverse entry is usually added instead of deleting the entry that has already occurred - this is business compensation, not database rollback.

## Dual Write: Database and messages cannot be solved by adjusting the execution order.

The business writes the database first and then sends the message: the process may crash just in between, and the status is submitted and the event is lost. On the contrary, if the message is sent first and then the library is written, the consumer may see a state that does not yet exist or even eventually fail. There is no atomicity between two independent systems, and changing the order is just a different way of failure.

The idea of ​​Transactional Outbox is:

1. In the same database transaction, write business records and Outbox records at the same time;
2. The Relay process continues to read the Outbox and publish events;
3. Publishing may be repeated, so the event must have a stable ID, and the Consumer must be idempotent;
4. Monitor the age of the oldest unpublished event and support replay.

Note that what it provides is that "business facts and to-be-published intents are atomically persisted", not Exactly-Once magic. Events delivered to Consumer are usually still At-Least-Once. Check the News Feed case's [Outbox Events and Derived Indexes](../../06-case-design/02-specific-application-system/03-news-feed/04-asynchronous-index-version-news-feed/02-outbox-events-and-derived-indexes.md).

## Consistency boundaries must also cover Cache and Index

Database submission is only one stage in the entire chain. Also ask:

- Cache-Aside Should I delete the cache first or last? When a race condition occurs, how long will the old value survive?
- What is the latency target from CDC/Outbox to Search Index?
- After permission is revoked, when will the CDN and service cache at all levels become invalid?
- Will the deletion be overwritten by an older update due to out-of-order events?
- After backup and restoration, do the Message Offset and the Recovery Point of the database match?

For security and deletion paths, "authority check + derived cleaning" is commonly used: authoritative status prohibits access first, and asynchronous cleaning is only to reduce storage and cache pollution. For the addition of ordinary content, it is enough to allow the Derived View to appear later.

## Decision order

1. Write down the business Invariant and its scope;
2. Try to include Invariants into a single transaction or a single Partition;
3. Select a sufficient Isolation Level and process the transaction again;
4. Redefine Replica Read and Session Guarantee;
5. For cross-border processes, clarify whether to use Distributed Transaction or Saga;
6. Use Outbox/CDC to reliably generate derived updates;
7. Design Recovery for Cache, Index, Backup and Message Offset.

Following this order can not only avoid using Eventual Consistency to cover up a Dual Write vulnerability, but also avoid turning the entire system into an expensive global synchronization transaction for the sake of a local Invariant.
