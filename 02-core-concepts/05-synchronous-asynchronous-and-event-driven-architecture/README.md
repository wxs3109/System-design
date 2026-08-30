# Synchronous, Asynchronous and Event-driven Architecture

Asynchronous is not about "adding a Message Queue", but about redefining the success boundary: when a request returns, which facts have been persisted, which results are allowed to be completed later, and who is responsible for recovery after failure. It trades extra state, latency, and operational complexity for caller decoupling, Queue buffering, and independent scaling.

## Remember the conclusion first

- When users must know the business results immediately, or rely on this result in the next step, synchronization is prioritized.
- Consider asynchronous when the work takes a long time, there are traffic spikes, the downstream can be completed later, or there are multiple independent consumers of a fact.
- Queue can only temporarily store pressure, but cannot eliminate it. When the long-term average Producer Rate is higher than the Consumer Rate, the Backlog will definitely increase.
- "Request accepted" does not equal "business completed". The asynchronous API should return a task or resource ID and provide status queries.
- Production practices usually accept At-Least-Once Delivery, and then rely on Idempotency, deduplication, Version Check and Reconciliation to obtain correct results.
- Writing business libraries and sending messages constitute Dual Write, which requires Transactional Outbox, CDC or other explicit solutions.
- Only commit to the Ordering that the business really needs. Global Ordering is very expensive. A common practice is to partition by Entity ID to ensure that the same entity is locally ordered.
- Consumer Lag, Oldest Message Age, Retry, DLQ, Replay and Reconciliation must be designed as part of the system, not added after going online.

## A decision map

```mermaid
flowchart TD
A[Whether this work must be completed before this response] -->|Yes| B[Synchronous call]
A -->|No| C{Whether there are spikes, long tasks or multiple independent consumers}
C -->|No| D[Keep synchronization first to save status and operation and maintenance costs]
C -->|Yes| E{The result of whether the business can accept it will be seen later}
E -->|No| F[Optimize the synchronization link, or reduce the critical path]
E -->|Yes| G[Asynchronous Task or Domain Event]
G --> H [define the boundaries of acceptance, completion and failure]
H --> I[Idempotency, Ordering, Backpressure, Replay and Observability]
```

Synchronization and asynchronousness can also be mixed: payment requests complete authentication, amount verification, and deduction fact submission simultaneously; receipts, points, notifications, and analysis are all asynchronous. The key is not to classify the entire link into a certain pattern, but to find the smallest synchronization correctness boundary.

## Navigation of this chapter

1. [When to become asynchronous: Judgment methods and counterexamples](01-when-to-asynchronously-determination-methods-and-counterexamples.md)
2. [How to asynchronously: Queue, Pub/Sub, Event Stream and Workflow](02-how-to-asynchronously-message-model-and-selection.md)
3. [Reliable Delivery: Success Boundary, Outbox and Consumption Semantics](03-reliable-delivery-success-boundary-and-consistency.md)
4. [Runtime Correctness: Ordering, Backpressure, Retry, DLQ and Observability](04-runtime-correctness-ordering-backpressure-retry-and-observability.md)
5. [Case Study: News Feed, Payment and Image Processing](05-case-deduction-how-does-the-asynchronous-boundary-fall-into-the-design.md)

## Boundaries with other chapters

- Latency budget and queuing effects see [Latency, Throughput and Tail Latency](../02-latency-throughput-and-tail-latency/).
- For Consumer's idempotent keys, backoff and deduplication windows, see [Idempotent, Retry and Deduplication](../06-idempotency-retry-and-deduplication/).
- For fault domain, degradation and disaster recovery, see [Fault Tolerance, Degradation and Disaster Recovery](../07-fault-tolerance-graceful-degradation-and-disaster-recovery/).

## Minimum answer framework in interviews

When proposing asynchronous, at least clarify these six things:

1. **Why**: What work is being removed from Critical Path, in exchange for Latency, Throughput or Fault Isolation.
2. **What is success**: The moment the API returns success, which fact has been persisted and which result may still be delayed.
3. **What is the message**: Command or Event, Queue or Pub/Sub, and what is the Partition Key.
4. **How ​​to ensure that no loss or repeated side effects**: How can the Producer release reliably, and how can the Consumer maintain idempotence.
5. **What to do with Backlog**: What are the capacity, Backpressure, Retry, DLQ and Replay strategies.
6. **What users see**: How to check the status, how long the Staleness can be accepted, and how to notify or compensate for permanent failure.
