# Concept to case index

This index is used to review concepts when doing cases. First find the symptoms or questions in the case, and then enter the corresponding chapter.

## 1. Check according to symptoms

| Symptoms or questions | Concepts that should be reviewed | Typical cases |
|---|---|---|
| Average Latency is OK, but few requests are slow | P95/P99, Queueing, Fan-out, Deadline | [API Gateway](../06-case-design/01-common-basic-system/02-api-gateway/README.md), [News Feed](../06-case-design/02-specific-application-system/03-news-feed/README.md) |
| Slow downstream causes all threads to be exhausted | Timeout, Backpressure, Bulkhead, Load Shedding | [API Gateway fault degradation](../06-case-design/01-common-basic-system/02-api-gateway/04-timeout-retry-and-fault-degradation.md) |
| A sudden increase in write volume cannot be processed | Async, Queue, Backpressure, Queue Buffering, DLQ | [Notification](../06-case-design/01-common-basic-system/07-notification-system/README.md), [Job Scheduler](../06-case-design/01-common-basic-system/06-job-scheduler/README.md) |
| The database submission was successful but the message was not sent | Transactional Outbox, Relay, at least one delivery | [News Feed Asynchronous Index](../06-case-design/02-specific-application-system/03-news-feed/04-asynchronous-index-version-news-feed/02-outbox-events-and-derived-indexes.md) |
| Duplicate messages lead to duplicate counts or deductions | Idempotent keys, unique constraints, Consumer Dedup | [News Feed write reliability](../06-case-design/02-specific-application-system/03-news-feed/08-resumable-production-version-news-feed/09-write-reliability.md), [Payment](../06-case-design/02-specific-application-system/09-payment-processing/README.md) |
| Message disorder leads to the resurrection of deleted content | Entity Version, state machine, rejection status regression | [News Feed deletion](../06-case-design/02-specific-application-system/03-news-feed/08-resumable-production-version-news-feed/07-post-deletion-and-consistency.md) |
| Two users grab the same seat | Condition update, unique constraint, isolation level | [Ticket Booking](../06-case-design/02-specific-application-system/08-ticket-booking/README.md) |
| Payment timed out, not sure whether to deduct money | Uncertain results, idempotent, status query, reconciliation | [Payment](../06-case-design/02-specific-application-system/09-payment-processing/README.md) |
| Cross-service is only half done | Saga, compensation, state machine, Outbox, reconciliation | [Ticket Booking](../06-case-design/02-specific-application-system/08-ticket-booking/README.md) |
| Replica reads old data | Consistency model, replication latency, Read-your-writes | [News Feed read extension](../06-case-design/02-specific-application-system/03-news-feed/03-read-the-extended-version-news-feed/03-caching-replicas-and-consistency.md) |
| Whether to accept writes when the network is partitioned | CAP, Quorum, Leader, business-level C/A selection | [Object Storage](../06-case-design/01-common-basic-system/05-object-storage/README.md), [Ticket Booking](../06-case-design/02-specific-application-system/08-ticket-booking/README.md) |
| Single machine capacity is not enough | Sharding, shard key, Rebalancing | [News Feed Sharding Extension](../06-case-design/02-specific-application-system/03-news-feed/07-sharding-extension-news-feed/README.md) |
| A large customer or account overwhelms the system | Hot Key, Noisy Neighbor, Isolation and Fair Scheduling | [News Feed Celebrity Account](../06-case-design/02-specific-application-system/03-news-feed/08-resumable-production-version-news-feed/05-celebrity-account-judgment-and-mode-switching.md), [Multi-tenant Platform](../06-case-design/03-platform-system/01-multi-tenant-data-platform/README.md) |
| There are copies, but they cannot be recovered after being accidentally deleted | Replication vs Backup, PITR, RPO/RTO | [News Feed Data Reliable Version](../06-case-design/02-specific-application-system/03-news-feed/02-data-reliable-version-news-feed/README.md) |
| I don’t know where to switch after a Region failure | Failover, Fencing, Cell, disaster recovery drills | [Multi-tenant platform evolution](../06-case-design/03-platform-system/01-multi-tenant-data-platform/01-system-design-mainline/12-evolution-route-and-current-boundary.md) |
| Duplicate or missing records when turning pages | Stable sorting, Cursor, Snapshot | [News Feed home page reading](../06-case-design/02-specific-application-system/03-news-feed/08-resumable-production-version-news-feed/04-home-page-reading-and-feeditem.md) |
| After the Worker lease expires, the old Worker is restored | Lease, fencing token, Attempt | [Operation scheduling domain](../06-case-design/03-platform-system/01-multi-tenant-data-platform/02-business-domain-design/05-operation-and-job-scheduling-domain.md) |

## 2. Back-check by case

### News Feed

Key concepts:

- Read-write ratio, tail latency and cache;
- Replication, backup, RPO/RTO;
- Outbox, asynchronous indexing, at least once delivery;
- Fan-out on Write / Read；
- Idempotence, out-of-order, Replay and Reconciliation;
- User Sharding、Celebrity Account Hotspot；
- Cursor Pagination and stable sorting.

Entrance: [News Feed Progressive Evolution](../06-case-design/02-specific-application-system/03-news-feed/README.md).

### API Gateway

Key concepts:

- Stateless horizontal expansion;
- Delay budget and tail delay amplification;
- Timeout, Retry, Backoff and Jitter;
- Circuit Breaker、Bulkhead、Load Shedding；
- Asynchronousization of long tasks;
- Rate Limiting, fairness and observability.

Entrance: [API Gateway](../06-case-design/01-common-basic-system/02-api-gateway/README.md).

### Payment and Booking

Key concepts:

- Condition writing, transaction isolation, and overselling prevention;
- Idempotency Key and unknown results;
- State machine, Saga and compensation;
- Immutable ledger;
- External callbacks and reconciliations;
- Consistency-first inventory/balance facts.

Entrance: [Payment](../06-case-design/02-specific-application-system/09-payment-processing/README.md), [Ticket Booking](../06-case-design/02-specific-application-system/08-ticket-booking/README.md).

### YouTube

Key concepts:

- Control plane and media data plane;
- Partial uploading and idempotent completion;
- Transcoding asynchronous Pipeline;
- Queue Backpressure and failure retry;
- Object storage, replication and CDN;
- Popular videos, bandwidth and tail latency.

Entrance: [YouTube](../06-case-design/02-specific-application-system/05-video-streaming/README.md).

### Multi-tenant data platform

Key concepts:

- Stateless Control Plane and Stateful Data Plane;
- Tenant, Workspace and Capacity isolation;
- Operation, Attempt, Lease and fencing token;
- Fair scheduling of interactive requests and background jobs;
- Version/ETag of Item Definition;
- Snapshot atomic commit;
- Cell, fault domain and cross-region recovery.

Entrance: [Multi-tenant data platform](../06-case-design/03-platform-system/01-multi-tenant-data-platform/README.md).

## 3. Review problem

After completing a case, review it with the following questions:

- Which data is factual and which is cached or derived index?
- What are the success, failure and unknown results of each API?
- Which steps are synchronous, which are asynchronous, and when are they visible to the user?
- When the network is partitioned, is each key operation selected consistent or available?
- How to deal with message duplication, disorder, backlog and permanent failure?
- How does concurrent writing rely on maintaining invariants?
- Does the shard key match the access pattern and where are the hot spots?
- Which segment is dominant in P99, and how to discard work when it is overloaded?
- What faults do replicas, backups, failovers, and reconciliations solve respectively?
- When does the current solution reach what target does it need to evolve?
