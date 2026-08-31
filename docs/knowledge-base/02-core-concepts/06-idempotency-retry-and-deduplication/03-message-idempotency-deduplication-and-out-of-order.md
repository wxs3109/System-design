# Message Idempotency, Deduplication and Out-of-order

Message systems commonly use "at least once" delivery: the consumer processes successfully but crashes before confirming the message, and the Broker will deliver again. Consumers must accept duplication as normal.

## 1. Solution A: Use business unique key directly

News Feed's Fan-out Worker can be used:

> `UNIQUE(user_id, post_id)`

Repeated insertion does not create a second FeedItem when the same event is replayed. This is usually simpler than maintaining an additional "processed message table" because it directly protects the business invariants.

## 2. Option B: Inbox / Processed Events

When the business write does not have a natural unique key, `event_id` is saved in the consumer database:

```sql
BEGIN;

INSERT INTO processed_event(consumer_name, event_id, processed_at)
VALUES (:consumer, :event_id, CURRENT_TIMESTAMP)
ON CONFLICT (consumer_name, event_id) DO NOTHING;

-- Business updates within the same transaction will only be performed if the insertion is successful.
UPDATE account_summary SET ...;

COMMIT;
```

"Record Processed" and "Business Write" must be in the same transaction. If you write the deduplication first and then write the business, processing will be missed after the crash; if you write the business first and then separately log the duplication, the processing will be repeated after the crash.

The correct order is usually:

1. Receive message;
2. Remove duplication and submit business results in a local transaction;
3. Confirm the message after the transaction is successful.

## 3. Solution C: State machine and version condition writing

For stateful objects such as orders and tasks, use legal state migration:

```sql
UPDATE orders
SET status = 'PAID', payment_id = :payment_id, version = version + 1
WHERE order_id = :order_id
  AND status = 'PAYMENT_PENDING'
  AND version = :expected_version;
```

Duplicate `PaymentSucceeded` will not be migrated again. Versions also prevent old messages from overwriting new status.

## 4. How to choose the deduplication window

The retention time of deduplicated records covers at least:

$$
T_{dedupe} \ge T_{broker-retention}+T_{max-retry}+T_{max-replay}+T_{clock-skew}
$$

If messages are retained for 7 days and the DLQ may be replayed within 30 days, there is no point in retaining only 24 hours of deduplication records. In high-risk businesses such as financial transactions, unique business keys or ledger identities should often be retained permanently instead of relying on expired cache keys.

Redis `SETNX` can absorb short-term duplication, but it cannot alone guarantee strong business idempotence if Redis loses data, TTL expires, or writes are decoupled from business transactions.

## 5. Why is Exactly Once usually only a partial guarantee?

Broker's Exactly Once often only covers specific boundaries, such as consumption and production within the same stream processing engine. Whenever processing also involves external databases, mail services, or payment gateways, the crash point reappears.

A more reliable end-to-end goal is:

> At least once delivery + Idempotent effect + Reconciliable recovery

The transport layer can be repeated, and the final effect of the business only appears once. For actions that are not naturally idempotent, use business ledgers, state machines, compensation, and manual review to maintain correctness.

## 6. In addition to duplication, we also need to deal with disorder

Deduplication does not prevent old events from arriving late. For example:

1. `OrderPaid(version=3)` comes first;
2. `OrderPending(version=2)` will arrive later.

If the consumer only overrides status in order of arrival, the order will be regressed. Common processing methods:

- The same aggregate ID is fixed to the same ordered partition;
- Events carry monotonic versions or sequence numbers;
- Conditional writing only accepts higher versions;
- When a version gap is found, pause, make up for it, or rebuild from the source;
- Use commutative operations when the business is naturally commutative, rather than writing the last win.

## 7. Selection Guide

| Scenario | Preferred Mechanism |
|---|---|
| There is a clear business unique relationship | Database unique key |
| There is no natural unique key, but consumption is written to the same database | Inbox and business write the same transaction |
| Event update of stateful entities | State machine + version condition writing |
| External side effects | Opposite idempotent key + local ledger/Outbox |
| High-frequency short-term repetitions that can expire | Durable constraints plus cache deduplication |

[Return to detailed directory](README.md)
