# How to use core concepts

Core Concepts is not a glossary of terms, but a sequence for making design decisions. When faced with a case, don’t start with “Should I use Kafka, Redis, or Cassandra?” but answer the business semantics first.

## 1. Six-step decision-making method

```text
business action
-> Invariants and success semantics
-> Scale and SLO
-> Sync/Async, Consistency and State Boundaries
-> Specific mechanism
-> Failure, recovery and verification
```

### Step one: What is the business action?

Don’t just generically say “design a News Feed.” First choose a path:

```text
User posts
User opens home page
User deletes post
User follows or unfollows
```

Different actions have different correctness and delay requirements, and the same sentence "eventually consistent" cannot be used.

### Step 2: Define invariants and success

| Scenario | Invariants that must be maintained | What does API success mean |
|---|---|---|
| Post | Post facts are created at most once | Post is persisted; feed distribution can be completed later |
| Locked seats | A seat has at most one valid holder | Authoritative inventory has been atomically changed to HELD |
| Payment | The same business intention cannot be deducted repeatedly | The status may be success, failure or unknown, and the determined result cannot be forged |
| Delete post | Cannot be visible again after deletion | Visibility in Source of Truth has changed; Derived Index can be cleaned up asynchronously |
| Data Job | The same Operation can be retried, but only one valid result is submitted | The output Snapshot has been submitted atomically |

Invariants determine whether conditional writes, transactions, idempotent keys, state machines, or stronger consistency are required.

### Step 3: Define scale and SLO

At least state:

- Peak QPS, concurrency and data volume;
- P50/P95/P99 delay;
- Availability SLO；
- Freshness or Consistency Window;
- RPO/RTO；
- Are the hot spots even?

Without goals, it's impossible to judge whether the trade-offs between asynchronous replication, caching, queuing, or cross-region make sense.

### Step 4: Select semantics

Ask in turn:

1. Do users have to synchronize to get the final results?
2. Which Derived Work allows asynchronous? How long are you allowed to lag behind?
3. Which readers must see the data just written?
4. When a network is partitioned, should writes be denied or old data allowed?
5. In which authoritative system is the status placed?
6. Does concurrency conflict occur in a single object, a single partition, or across services?

Determine the semantics first, then select the database and middleware.

### Step 5: The mechanism must respond to specific problems

| Mechanism | Problem solved | Not automatically solved |
|---|---|---|
| Cache | Reduce read latency and backend load | Authoritative consistency, data durability |
| Queue | Queue Buffering, Decoupling, asynchronous processing | Consumer Idempotency, business correctness |
| Replica | Read expansion or failure redundancy | Backup, zero RPO, automatic and safe master switching |
| Shard | Single machine capacity or throughput upper limit | Hot spots, cross-shard transactions |
| Retry | Recover temporary failures | Non-idempotent side effects, permanent errors |
| Circuit Breaker | Stop applying pressure in case of failure | Business degradation plan |
| Distributed Lock | Coordination critical section | Old holder write, authority constraints |
| Outbox | Atomic submission of business facts and event intentions | Exactly-once consumption |

### Step 6: Reverse verification from the point of failure

Ask hop by hop along the write path and read path:

- After the request times out, is the result a failure or unknown?
- What happens if messages are lost, duplicated, out of order, or backlogged?
- Worker crashes halfway through execution, is the half-finished product visible?
- Who can read and write the Primary and Replica partitions?
- Can Cache, Search or Lineage be reconstructed if they are all lost?
- How much data can be lost due to Region failure and how long does it take to recover?
- Will Rollback, Replay and Reconciliation overwhelm online traffic?

## 2. A complete example: why News Feed should be asynchronous

### Original synchronization scheme

When a user posts a Post, he or she needs to write a FeedItem to 1 million fans. If the API waits for everything to be written:

- Response time increases with the number of fans;
- Any slow downstream will prolong P99;
- Burst posts directly impact the Feed Store;
- User timeout retries may result in repeated distribution.

### Redefine success

```text
Post successful = Post fact and Outbox have been committed in the same transaction
Not equal = All fan homepages have been updated
```

Derived Fan-out can be executed asynchronously as long as the product allows the homepage to update within seconds:

```text
Post API -> Post DB + Outbox -> Queue -> Fan-out Workers -> Feed Store
```

### New problems brought by asynchronous

- At least one delivery will produce duplicates and requires the `(user_id, post_id)` unique key;
- Celebrity Account generates Hotspot and needs to be switched to Fan-out on Read;
- Queue Lag determines content freshness and must have SLO;
- DLQ and Silent Missing Writes require Replay and Reconciliation;
- Deleting a post must first change the authority visibility and cannot wait for asynchronous cleanup.

For the complete case, see [News Feed Evolution](../06-case-design/02-specific-application-system/03-news-feed/README.md).

## 3. A complete example: when CAP is needed

Assume that the same seat inventory accepts writes across two Regions, and the network between Regions is interrupted:

```text
Region A does not know whether Region B has sold seats
Region B also doesn’t know if Region A has sold seats.
```

At this time it is not possible to guarantee both:

- Both sides continue to accept lock seats immediately;
- And a seat will never be sold separately from both sides.

Ticketing systems usually choose to maintain de facto consistency in the inventory: only allowing the Region/Partition with write rights for the event to continue, and rejecting or forwarding write requests on the other side. Cache Read that searches for event and seating maps can temporarily return Stale Data.

The key is not to call the entire system CP or AP, but to choose operation by operation:

| Action | Select when partitioning | Reason |
|---|---|---|
| Search sessions | Allow old reads | Availability is more important |
| View Seating Map | May be temporarily aged, but markings are ultimately subject to lock seats | Display is not a stock commitment |
| Lock seats | Reject when authoritative write cannot be confirmed | Cannot oversell |
| Send Notification | Delay and Retry | Derive Side Effects Recoverable |

For the case, see [Ticket Booking](../06-case-design/02-specific-application-system/08-ticket-booking/README.md).

## 4. Interview expression template

Each choice can be explained as follows:

> The key invariant of this path is ______. The user successfully responds to the request ______, and ______ allows final completion within ______ time. Because the peak is ______, synchronous execution results in ______, so use ______. The cost is ______, I will pass the ______ test, and pass the ______ recovery.

For example:

> The invariant of posting is that the Post fact is created at most once. A successful response requires that the Post and Outbox have been submitted, but the FeedItem is allowed ten seconds to complete. Because a large account may have millions of fans, synchronous distribution will amplify delays and glitches, so use at least one asynchronous fan-out. The cost is duplication and backlog, handled through unique keys, Queue Lag, DLQ, Replay and Reconciliation.

## 5. The difference between concepts and components

```text
Core concept: Why do we make this trade-off? What are the semantics?
Infrastructure: What components are used to implement it?
Case design: How do these concepts and components combine into a complete system?
```

- This directory answers decision semantics such as Consistency, Async, Idempotency, Tail Latency, and Fault Tolerance.
- [Infrastructure Components] (../04-Infrastructure-Components/README.md) discusses components such as Load Balancer, Cache, Queue, and Storage.
- [Case Design] (../06-Case Design/README.md) applies them to News Feed, Payment, YouTube and multi-tenant platforms.
