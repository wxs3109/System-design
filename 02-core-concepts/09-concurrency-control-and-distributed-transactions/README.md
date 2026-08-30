# Concurrency Control and Distributed Transactions

This set of concepts solves two different problems:

```text
Concurrency control: Multiple requests modify the same fact at the same time. How to avoid overwriting, overselling or state regression?
Distributed transactions: A business action spans multiple services or storage, how to deal with only part of it being completed?
```

Don't apply distributed locks or two-phase commit as soon as you see multiple services. First find out the business invariants that really must be established atomically, and then narrow the strong consistency boundary.

## When must be considered

- The same seat, inventory, balance or unique username will be modified concurrently;
- Another request may be inserted between "read first then write";
- One action across orders, payments, inventory and notifications;
- After the client times out, it is not known whether the writing has been successful;
- Business requirements cannot be oversold, repeated deductions cannot be made, and the status cannot be reversed.

If you're just updating a rebuildable like count, search index, or recommendation feature, it's usually not worth using strongly distributed transactions.

## Learning sequence

1. [Concurrent updates and isolation level](01-concurrent-update-and-isolation-level.md)
2. [Optimistic Lock, Pessimistic Lock and Lease](02-optimistic-lock-pessimistic-lock-and-lease.md)
3. [Local Affairs, 2PC and Saga](03-local-affairs-2pc-and-saga.md)
4. [State Machine, Compensation and Reconciliation](04-state-machine-compensation-and-reconciliation.md)

## Quick selection

| Problem | Priority | Reason |
|---|---|---|
| Updating multiple rows in the same database | Local ACID transactions | Minimal boundaries and strongest semantics |
| Low-conflict object editing | Version / ETag / CAS | No need to hold long-term locks |
| Hot seat or inventory contention | Conditional updates or short transaction row locks | Atomic decisions at authoritative inventory |
| Long-term exclusive resource | Limited Lease + fencing token | Avoid permanent locks and old holder writes |
| Cross-service orchestration | State machine + Saga + Outbox | Allow long transactions and handle partial failures explicitly |
| Few internal resources that must be synchronized for atomic commits | Evaluate 2PC carefully | Strong semantics but high availability and operation and maintenance costs |
| External payment status is unknown | Idempotent query, callback, reconciliation | Unable to include external institutions into local affairs |

## Case mapping

- [Ticket Reservation](../../06-case-design/02-specific-application-system/08-ticket-booking/README.md): Lock seat, timeout release, anti-oversold.
- [Payment System](../../06-case-design/02-specific-application-system/09-payment-processing/README.md): Unknown status, idempotent deduction, compensation and reconciliation.
- [News Feed Basic Writing](../../06-case-design/02-specific-application-system/03-news-feed/01-basic-news-feed/03-write-operations-and-sql.md): Unique constraints and idempotent keys.
- [Multi-tenant platform save Item](../../06-case-design/03-platform-system/01-multi-tenant-data-platform/01-system-design-mainline/07-workload-and-item.md): ETag, anti-overwrite and immutable version.

## Be clear during the interview

1. What are the invariants, such as "a seat can have at most one valid order".
2. Which store is the authoritative source of that fact.
3. Where conflict occurs and how high the conflict rate is expected to be.
4. What data are covered by atomic boundaries and which steps allow eventual consistency.
5. How to determine success, failure or unknown after timeout.
6. Whether the compensation can really be restored to the original status, and if not, how to reconcile and handle it manually.
