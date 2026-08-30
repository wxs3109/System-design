# Task Queues and Pub/Sub

Task queues and publish/subscribe both decouple senders from processors, but solve different problems. A task queue assigns a unit of work to one worker; publish/subscribe delivers the same fact separately to multiple subscribers. They are infrastructure: they neither guarantee that business work executes only once nor define what successful processing means for the application.

## Choose a Model Before a Product

| Requirement | Preferred model | Key meaning |
|---|---|---|
| One task needs to be handled by only one worker | Queue | Multiple workers compete for work |
| Search, notifications, and analytics must separately process the same event | Topic + subscription | Each subscription retains its own consumption progress |
| A consumer must later reread from an old position | Event stream | Requires addressable progress and longer retention; see [Event Streaming Platforms](../07-event-streaming-platforms/) |
| A process must persist state across multiple steps, wait for hours, or require human confirmation | Workflow | Requires durable process state; see [Workflow and Long-Running Task Platforms](../08-workflow-and-long-running-task-platforms/) |

Do not default to a topic merely because work is asynchronous. If there is only one kind of background processing, a queue is usually more direct. Independent subscriptions are needed when multiple business consumers must each see the same event.

## Position in the System

```text
Task: Producer -> Queue -> Worker Pool

Broadcast: Publisher -> Topic -> Subscription A -> Consumer A
                              -> Subscription B -> Consumer B
```

The broker sits between producers and consumers and handles buffering, routing, delivery, and consumption progress. Whether the business database has committed and whether a consumer's external side effects have completed remain outside the broker contract. Combining a database, outbox, and broker belongs in [Reliable Event-Publishing Flows](../../05-general-design-patterns/03-reliable-event-publishing-path/).

## Input, Output, and Success Semantics

A message usually contains at least:

- message_id: message identity for tracing and deduplication;
- event_type or task_type: selects the processing logic;
- schema_version: defines how to interpret the payload;
- occurred_at: when the business fact occurred, not the delivery time;
- tenant_id and correlation_id: isolation and tracing context;
- payload: the minimum data required to complete the task, or a reference to authoritative data.

Three kinds of “success” must not be conflated:

1. The broker accepts a message: the message enters the durability scope promised by the product.
2. The broker delivers a message: a consumer has received it but may not have finished.
3. The consumer acknowledges a message: the broker can end this delivery attempt; this does not automatically prove that business side effects are correct.

A send timeout has an **unknown outcome**: the broker may not have received the message, or it may have accepted it and lost the response. [Idempotency and Safe Retries](../../02-core-concepts/06-idempotency-retry-and-deduplication/) defines whether the producer retries and how it avoids duplicating business work.

## Common External Contracts

### Delivery

- **At-most-once:** a message may be lost, but the broker does not redeliver it; suitable for advisory work that may be omitted.
- **At-least-once:** a failure or acknowledgment timeout causes redelivery, so the business must tolerate duplicates; this is a common default.
- **Exactly-once:** always ask for the scope. Deduplication inside the broker does not mean that external side effects such as database writes and email sends occur only once.

### Ordering

Products commonly guarantee order “within the same session, message group, or partition key,” not globally across the entire queue or topic. A broader ordering scope usually reduces possible parallelism. If the business requires ordering only within one order, use order_id as the ordering key instead of requesting global order for all orders.

### Acknowledgment and Redelivery

In a pull model, the consumer typically acknowledges explicitly, and the queue redelivers after a visibility timeout or lock expires. In a push model, the consumer's HTTP response usually determines success. In either model, define:

- whether acknowledgment occurs before or after the business commit;
- whether the consumer can renew the lease if processing times out;
- whether the maximum delivery count applies per message, subscription, or queue;
- who repairs, replays, and validates messages after they enter the DLQ.

## Key Configuration

| Configuration | If too small | If too large |
|---|---|---|
| Message retention | Messages expire during a long failure | Storage cost rises and old messages become harder to govern |
| Visibility/lock timeout | Normal work is redelivered concurrently before it finishes | A crashed worker's task takes too long to retry |
| Batch size | High call overhead and low throughput | One failure affects more work; processing latency and memory rise |
| Maximum delivery count | Brief failures send messages to the DLQ | Poison messages repeatedly consume capacity |
| Prefetch/in-flight | Workers are underutilized | One worker hoards tasks and load becomes uneven |
| Message size | More external reads are required | Network and broker cost increase |

Large files usually go in object storage, and the message carries only an object ID, version, and checksum. This prevents the broker from becoming storage for media or export files.

## Capacity and Backlog

Before selecting a product, estimate at least the peak send rate, average message size, number of subscriptions, per-instance consumer processing rate, allowed backlog duration, and burst duration.

If production rate remains above aggregate consumption rate, the backlog necessarily grows. Scaling consumers helps only if the downstream database, third-party APIs, and ordering scope also allow parallelism. State explicitly whether the backlog absorbs a short peak or the system cannot sustainably process its average traffic.

Key observations include:

- oldest message age, not merely message count;
- enqueue, delivery, acknowledgment, and redelivery rates;
- active/in-flight count;
- DLQ growth and primary failure types;
- independent backlog for every subscription.

## Failure and Overload Behavior

| Scenario | What a caller or consumer observes | What the design must verify |
|---|---|---|
| Broker unavailable or throttling | Send failure, timeout, or throttling | Whether the local request may fail; whether a recoverable publication path exists |
| Worker crashes before acknowledgment | Message is redelivered later | Whether side effects may already have occurred |
| Worker crashes after acknowledgment | Broker considers work complete | Whether acknowledgment happened too early |
| Visibility timeout too short | Multiple workers concurrently process the same message | Whether to renew it; whether concurrent duplicates are safe |
| Poison message | Repeated failure, an ordering group blocked, or the message moved to the DLQ | Ownership of isolation, repair, replay, and validation |
| Consumers fall behind | Message age and backlog grow | Whether retention covers the recovery time |
| One subscription fails | That subscription accumulates backlog while others usually continue | Whether the product truly isolates subscription capacity and quotas |

A DLQ is an isolation area, not a recovery solution. Without alerts, repair tools, controlled replay, and business reconciliation, moving a message into the DLQ merely hides the failure.

## Selecting Common Products

| Product form | Typical products | Better suited for | Verify during selection |
|---|---|---|---|
| Managed simple queue | Amazon SQS | Large-scale background tasks with low operational burden | Standard/FIFO differences, visibility, message size, and quotas |
| Enterprise message broker | Azure Service Bus, RabbitMQ | Rich queue/topic, routing, session, and DLQ semantics | Ordering scope, locks, routing rules, and cluster operations |
| Managed publish/subscribe | Google Cloud Pub/Sub, Azure Service Bus Topic | Event distribution to multiple subscribers | Push/pull, subscription retention, flow control, and redelivery |

A product name does not replace its contract. FIFO behavior, transactional sending, deduplication windows, and ordering guarantees all have specific conditions. Use the official contract for the selected SKU, region, and configuration.

## Remaining Application Responsibilities

- Define the message schema, compatibility policy, and business success semantics.
- Design correct behavior for duplicate, out-of-order, and late messages.
- Protect downstream systems so unbounded consumer concurrency cannot overwhelm a database or third-party service.
- Handle unknown send outcomes, partial consumer success, and poison messages.
- Establish DLQ handling, replay, reconciliation, and audit processes.
- Avoid unnecessary sensitive data in messages, and define retention and deletion requirements.

For the principles, see [Synchronous, Asynchronous, and Event-Driven Systems](../../02-core-concepts/05-synchronous-asynchronous-and-event-driven-architecture/) and [Idempotency, Retries, and Deduplication](../../02-core-concepts/06-idempotency-retry-and-deduplication/). Cross-component reliable flows belong in [General Design Patterns](../../05-general-design-patterns/).

## Interview Checklist

1. Do consumers compete for work, or must every subscription receive it?
2. When the API returns success, has the message merely been accepted or has the business work completed?
3. What is the exact scope of delivery, ordering, and deduplication guarantees?
4. What happens after a worker crashes or processing times out?
5. How long does the backlog last at peak, and does retention cover recovery?
6. Who handles the DLQ, and how is replay performed safely and its result proven correct?
