# Core concepts

This is not a dictionary of terms, but a set of design decision-making tools. Each topic answers: when is it needed, why is it needed, how to implement it, what is the cost, how to recover after failure, and is connected to the specific system in 06-Case Design.

When learning for the first time, read [How to use core concepts] (00-How to use core concepts.md); when doing cases or review, you can use [Concept to Case Index] (11-Concept to Case Index.md) to check back according to symptoms.

## Learn the main line

1. [Availability, Reliability and Scalability](01-availability-reliability-and-scalability/): Write the goal as SLI/SLO, identify Failure Domain and growth dimension.
2. [Latency, Throughput and Tail Latency](02-latency-throughput-and-tail-latency/): Determine capacity bottlenecks from load, Critical Path, Queueing and P99.
3. [CAP and Consistency Model](03-cap-and-consistency-model/): Select consistency by business object and operation instead of labeling the entire system with CP/AP.
4. [Stateless and Stateful Service](04-stateless-and-stateful-service/): Determine who owns the State and how to restore it after the Instance disappears.
5. [Synchronous, Asynchronous and Event-driven](05-synchronous-asynchronous-and-event-driven-architecture/): Determine success boundary, Message Model, Reliable Delivery and Backlog processing.
6. [Idempotency, Retry and Deduplication](06-idempotency-retry-and-deduplication/): Handle "unknown result" and repeated Side Effect caused by Timeout.
7. [Fault Tolerance, Graceful Degradation and Disaster Recovery](07-fault-tolerance-graceful-degradation-and-disaster-recovery/): Limit Blast Radius, protect critical invariants, and recover by RPO/RTO.
8. [Partition, Sharding and Hotspot](08-partition-sharding-and-hotspot/): Select Shard boundary and handle Hotspot, Migration and Cross-shard Operation.
9. [Concurrency Control and Distributed Transaction](09-concurrency-control-and-distributed-transactions/): Protect invariants with Conditional Update, Lock, Lease, Saga and Reconciliation.
10. [Time, Ordering and Unique ID](10-time-ordering-and-unique-id/): Handle Clock Skew, Event Ordering, ID and Stable Pagination.
11. [Core concept to real product navigation] (12-Real implementation of core concepts/): Map concepts to real capabilities in subsequent chapters, and do not maintain product encyclopedias in core concepts.

## Shortest reading path

If you want to get into case design as soon as possible, it is recommended to read:

1. [Six-step design decision-making method] (00-How to use core concepts.md#1-Six-step design decision-making method);
2. [When to asynchronously](05-synchronous-asynchronous-and-event-driven-architecture/01-when-to-asynchronously-determination-methods-and-counterexamples.md);
3. [When does CAP need to be discussed](03-cap-and-consistency-model/02-cap-partition-and-pacelc.md);
4. [Timeout and safe retry](06-idempotency-retry-and-deduplication/01-timeout-and-safe-retry.md);
5. [Failure Model, Timeout and Overload Protection](07-fault-tolerance-graceful-degradation-and-disaster-recovery/01-failure-model-timeout-and-overload-protection.md);
6. [Concept to Case Index](11-concept-to-case-index.md).

If you have understood the concept and are making specific selections, you can use [Real Product Navigation] (12-Real Implementation of Core Concepts/) to find the corresponding chapter.

##Boundary of this chapter

This chapter only solves one problem: **What semantic and mechanism trade-offs must be made when a distributed system is running? **

| This chapter is responsible | This chapter is not responsible | Where to go |
|---|---|---|
| Define availability, consistency, order, idempotence and success semantics | Teach how to allocate interview time | [Interview method] (../00-Interview method/) |
| Explain why Async, Replication, Sharding, Retry, Graceful Degradation occur and their cost | Recalculate DAU, QPS, storage and bandwidth | [Back-of-the-Envelope](../01-Back-of-the-Envelope/) |
| Describe state ownership, fault behavior, recovery methods and verification signals | Expand internal algorithms such as B-tree and LSM-tree | [Data and Storage] (../03-Data&Storage/) only retains the performance guarantee required for selection |
| Establish a decision-making framework of "Problem → Mechanism → Trade-off" | Introduce Kafka, Redis or database configuration item by item according to the product manual | [Real Product Navigation] (12-Real Implementation of Core Concepts/) is responsible for offloading; the database belongs to `03`, and the non-storage components belong to `04` |
| Use a short case to prove how the concept changes the design | Write a complete set of YouTube, Booking or News Feed | [Case Design] (../06-casedesign/) |

### This chapter unifies the granularity

Each concept can answer at most the following six types of questions. Excessive implementation details are transferred to subsequent chapters:

1. **Trigger condition**: What needs, scale or failures are observed before it needs to be considered;
2. **Protection Objective**: Which business invariant or SLO does it protect;
3. **Minimum Mechanism**: Understand the working methods required for design and do not expand the internal algorithm of the product;
4. **Cost**: What is exchanged between latency, availability, consistency, complexity and cost;
5. **Failure and Recovery**: What state will be left after failure, how to Retry, Compensation, Replay or Reconciliation;
6. **Case landing point**: Point to the specific link in the case instead of copying the entire set of cases.

### Handover with previous and subsequent chapters

```text
01 Order of magnitude estimation
Output: Peak QPS, Bytes, Working Set, Growth and Failure Margin
        ↓
02 Core concepts
Output: Consistency, Sync/Async, State, Sharding, Failure and Recovery semantics
        ↓
03 Data and Storage / 04 Infrastructure Components
Output: Storage types and ready-made components that satisfy these semantics and scale
        ↓
05 Universal Design Patterns
Output: recurring combinations of multiple components
        ↓
06 Case design
Output: A complete system evolving step by step around specific business links
```

Therefore, this chapter will say that "inventory deductions require conditional updates and protection from overselling", but it will not double-count booking QPS, it will not talk about how the database index is rotated internally, and it will not draw the complete Booking architecture here.
