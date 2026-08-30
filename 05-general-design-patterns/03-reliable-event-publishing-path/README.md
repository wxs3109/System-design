# Reliable Event Publishing Path

The reliable event publishing link solves a specific problem: the business database has been submitted, but the corresponding events cannot be permanently lost. A common combination is Database + Transactional Outbox + Relay/CDC + Broker + Consumer.

This section explains how these components work together. For the principles of At-least-once Delivery, Idempotency and Retry, see [Synchronization, Asynchronous and Event-Driven](../../02-core-concepts/05-synchronous-asynchronous-and-event-driven-architecture/) and [Idempotent, Retry and Deduplication](../../02-core-concepts/06-idempotency-retry-and-deduplication/); for Broker’s External Contract, see [Task Queue and Pub/Sub](../../04-Infrastructure-Components/06-task-queues-and-pub-sub/) and [Event Streaming Platform](../../04-Infrastructure-Components/07-event-streaming-platforms/).

## 1. Why is the simplest solution not enough?

Direct double writing usually has two orders:

### Write Database first, then send Broker

The process crashed after the Database was submitted, and the Broker had no events. The facts exist, but the downstream never knows.

### Send Broker first, then write Database

The consumer may see the event first, but the database eventually fails to write. This resulted in non-existent business results downstream.

Retrying does not eliminate this window because after the timeout the producer has no way of knowing whether the previous action was successful. What really needs to be bound is "the existence of authoritative facts" and "the existence of a record that can be republished."

## 2. Invariant and participants

| Participants | Responsibilities | Status held |
|---|---|---|
| Business Service | Submitting Facts in Local Transactions with Outbox | Business Operations Context |
| Database | Atomicly save business facts and records to be released | Authoritative facts, Outbox |
| Relay or CDC | Find unpublished records and send | Scan Checkpoint or Log Position |
| Broker | Buffering, retaining and delivering events | Messages, partitions and consumption progress |
| Consumer | Produce idempotent business effects | Derive state, deduplication or source version |
| Reconciler | Compare facts and derived results | Audit progress and remediation tasks |

Must maintain:

1. When business facts are submitted, the corresponding Outbox must exist in the same local transaction;
2. Relay can publish repeatedly, but it cannot permanently skip submitted records due to crash;
3. When Consumer executes it repeatedly, the business effect remains unchanged;
4. Derived results can be verified or reconstructed from authoritative fact and change records.

## 3. Happy Path and Success Semantics

### Phase A: Accepting business writes

1. Service verification request;
2. Write business facts and Outbox in the same Database transaction;
3. Database submission;
4. The API returns "Accepted".

At this point it can be guaranteed that: the business facts exist and the intent to be released can be restored. There are no guarantees: the Broker has received it, the Consumer has processed it, and the user has seen all derived results.

### Phase B: Release

1. Relay polls Outbox, or CDC reads changes from the database log;
2. Relay sends the event to Broker;
3. Broker confirmation;
4. The Relay mark has been released, or the checkpoint can be restored by advancing it.

It crashes when the Broker has confirmed but the Relay has not yet recorded progress, and will be sent again after recovery. Therefore, publishing links are usually designed according to "at least once".

### Stage C: Consumption

1. Consumer receives the event;
2. Use event_id, business unique constraints or source versions to produce idempotent effects;
3. After the business storage is submitted, confirm the message or advance Offset;
4. Update the end-to-end Operation status if necessary.

Successful consumer confirmation means that this consumer is completed, but it does not mean that all consumers are completed. Each Consumer Group has independent progress and SLO.

## 4. Outbox Minimum Data Contract

An Outbox record usually requires:

| Field | Purpose |
|---|---|
| event_id | Stable event identity, used for tracking and deduplication |
| aggregate_type / aggregate_id | Which business object the fact belongs to |
| event_type | A business fact that has occurred, such as PostCreated |
| source_version | Handling reordering and rebuilding |
| occurred_at | Business fact occurrence time |
| payload or reference | fields required by the consumer, or positioning information back to the authoritative source |
| schema_version | Compatible with new and old consumers |
| tenant_id | Isolation, routing, auditing and Rate Limiting |

event_id remains unchanged across Retry, DLQ and Replay. Regenerating the ID bypasses Deduplication protection.

The Outbox does not have to hold the entire database row, but the events must be sufficient to express a stable business fact. Sending only an ambiguous "EntityUpdated" forces the consumer to look back into the producer's internal tables and re-form runtime coupling.

## 5. Relay: Polling or CDC

| Approach | Fit for Starting Point | Main Responsibilities |
|---|---|---|
| Polling Outbox tables | Small, want simplicity | Batch, index, concurrent picks, cleanup, and poll delays |
| CDC reads transaction logs | Large release volume, existing change capture platform | Log Position, Schema compatibility, permissions and failure recovery |

Neither can make Consumer idempotent. CDC reduces polling overhead, but is not "automatic end-to-end Exactly-once".

Outbox tables cannot grow indefinitely. Cleanup must be completed later than demonstrable release, leaving a sufficient audit window. If deleted too early, there will be no basis for restoration when the release status is unknown.

## 6. How does Consumer avoid duplication of business effects?

Prioritize the use of stable constraints of the business itself:

- FeedItem uses user_id + post_id to be unique;
- Status updates only accept higher source_version;
- The payment call provides stable operation_id to the outside;
- When there is no natural unique key, write processed_event and business results in the same target database transaction.

Confirming the message before the result is submitted by the Consumer will result in missed processing; confirming the message after the result is submitted may be processed repeatedly. Reliable links usually accept the latter, and then use idempotent to obtain a service effect.

Deduplication Retention must override possible Replay Window. The detailed strategy will not be repeated here, see [Message Idempotence, Deduplication and Out-of-Order](../../02-core-concepts/06-idempotency-retry-and-deduplication/03-message-idempotency-deduplication-and-out-of-order.md).

## 7. Failure and Recovery

| Fault location | What state will be left | Recovery action |
|---|---|---|
| Crash before transaction commit | Neither fact nor Outbox exists | Caller retries with idempotent request |
| Crash after transaction commit but before response | Facts and Outbox already exist, response unknown | Same idempotent key query already has results |
| Relay crashes before publishing | Outbox still pending | Resume scan or continue from Checkpoint |
| Broker has received, Relay has not recorded progress | Possible duplicate events | Re-release, Consumer is idempotent |
| Consumer crashes before submission | No business results | Broker re-invests |
| Consumer crashes after submission but before confirmation | The result already exists, the message will be re-delivered | Idempotent return of existing results |
| Permanent format or business error | Repeated failures of the same event | Isolate to DLQ, use the original identity to limit the rate after repair Replay |
| Code error causing Silent Missing Writes | Broker indicators may be normal | Business reconciliation and repair from authoritative facts |

Automatic Retry only handles temporary failures. After Retry is exhausted, there must be Owner, Alarm, DLQ, Repair and Replay processes, and DLQ cannot be regarded as the end point of success.

## 8. Reconciliation is part of the link

Only monitoring the Outbox backlog and Consumer Lag will not detect error filtering, incorrect version judgment, or the program mistaking failure for success. Expected results should be derived from authoritative facts and the derived results should be compared:

- Compare counts with High Watermark by time, Tenant or Business Partition;
- Sample and compare source versions, content and permission status;
- After discovering the discrepancy, first generate a read-only report and then fix it at a limited speed;
- Fixed using stable business ID to avoid repeated side effects.

"Theoretically it can be replayed" does not mean it has been verified. Practice the Replay of the specified Time Window or the specified Tenant at least once, and observe the impact on online traffic.

## 9. When not to use Outbox links

- Fact and derived query tables can be placed in the same local transaction, no Broker is required;
- Events can be lost and are only used for low-value sampling or telemetry;
- Small-scale systems can directly derive results from the database on a regular basis, and the latency can also meet the requirements;
- The business requires that all steps be completed before the API returns. At this time, you should first determine whether synchronous transaction boundaries are more appropriate.

If there is compensable business state across multiple services, not just "publish facts", the problem has entered [Saga with Business Workflows](../06-saga-and-business-workflow/); Don't use Outbox to pretend to get cross-service atomic transactions.

## 10. Capacity and Observation

Plan at least:

- Business write peak, number of events generated by each write, and event size;
- The number of Outbox backlog items, the age of the oldest record and the cleaning speed;
- Relay publishes throughput, failure rate and repetition rate;
- Lag and oldest event age of each Consumer Group;
- Number of DLQs, oldest age and Replay Rate;
- P95/P99 delay in fact submission to visibility of each derived result;
- Business reconciliation discrepancies, not just infrastructure error rates.

Release, Replay, and Backfill all compete with online operations for Database, Broker, and downstream capacity. Recovery Throughput requires a separate budget and rate limit switch.

## 11. Reuse method

- News Feed: Reliably updates Author Timeline and FeedItem after Post submission;
- Search: Reliably update the Search Index after the Item is submitted;
- Notification: a notification task is generated after the order or social fact is submitted;
- Analysis: Business facts enter a Replay-enabled Event Stream and build analysis data.

The case only needs to declare events, authoritative transactions, Consumer effects, visibility SLO and reconciliation methods, and there is no need to re-tell the Outbox principle.

## Checklist

- [ ] The business fact is in the same local transaction as Outbox;
- [ ] API success, Broker release, and Consumer completion are different boundaries;
- [ ] Relay can recover from persistent checkpoints and allow repeated publishing;
- [ ] event_id, business ID, source_version and tenant_id are stable;
- [ ] The effect of each Consumer can be idempotent;
- [ ] DLQ has Owner, Alarm, Repair and Rate Limiting Replay processes;
- [ ] Have business reconciliations based on authoritative facts;
- [ ] Recovery and Backfill will not hit online paths unboundedly.
