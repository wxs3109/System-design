# State Machine, Compensation and Reconciliation

Distributed processes cannot be expressed only with `success: true/false`. Network timeouts, repeated callbacks, and manual processing can create a lot of intermediate states. Explicit state machines are the basis for recovery.

## 1. Why do we need a state machine?

The payment request timeout only means that the caller did not receive the result, but does not mean that the payment failed:

```text
CREATED -> PROCESSING -> SUCCEEDED
                   |
                   +-> FAILED
                   +-> UNKNOWN -> SUCCEEDED / FAILED
```

If the timeout is written directly as `FAILED` and the user is allowed to repay, repeated deductions may occur.

The state machine should define:

- allowed conversions;
- Who can trigger;
- Preconditions;
- Idempotent keys;
- Timeouts and retries;
- Final state and recoverable state;
- How to deal with illegal or late incidents.

## 2. Conditional state transition

```sql
UPDATE payments
SET state = 'SUCCEEDED', provider_txn_id = :txn
WHERE payment_id = :payment_id
  AND state IN ('PROCESSING', 'UNKNOWN');
```

A late `FAILED` callback cannot change the already `SUCCEEDED` state back to failure. State transitions and event logging should be committed in the same transaction.

## 3. How to design compensation

Each Saga step defines at least:

| Content | Questions |
|---|---|
| Forward action | What should I do normally? |
| Idempotency key | Does repeated execution produce a second side effect? |
| Compensation | How to restore business invariants in case of subsequent failure? |
| Retry policy | Which errors are retried and how often? |
| Terminal failure | Who will handle it after permanent failure? |
| Audit data | How to prove what happened? |

The compensatory sequence is usually the reverse of the forward steps, but does not necessarily lead to complete restoration. Refunds, cancellations, and apology notices are all new facts.

## 4. Why is Reconciliation still needed?

Even with Outbox, retries, and idempotence, this can happen:

- The external system succeeds but the callback is permanently lost;
- Bug incorrectly marks certain types of events as consumed;
- Manual operations bypass normal processes;
- After data recovery, the two systems returned to different points in time;
- Long-term failure exceeds the message retention period.

Reconciliation compares two independent Data Sources:

```text
Local Payment Ledger <-> payment channel settlement file
Post fact table <-> Timeline / FeedItem derived index
Object Metadata <-> Actual Object List
```

Discrepancies are queued for remediation and evidence and audit records are retained.

## 5. The Reconciliation Job itself must also be reliable

- Incremental scanning based on time windows or shards to avoid frequent full database scans;
- Use stable cursors and checkpoints;
- Fix operation idempotence;
- Speed ​​limit to avoid restoring traffic from overwhelming online services;
- Record discovery time, discrepancy type, repair results and manual decisions;
- Support Dry Run and sampling verification.

Case: [News Feed Observability and Recovery](../../06-case-design/02-specific-application-system/03-news-feed/08-resumable-production-version-news-feed/12-observability-and-recovery.md).

## 6. The normal path and recovery path must be designed at the same time

Take payment as an example:

```text
Normal path: Create Intent -> Call channel -> Success callback -> Accounting
Recovery path: call timeout -> query status -> wait for callback -> reconciliation -> manual processing
```

An architecture diagram that only draws normal paths is incomplete. You should pick at least one timeout point during the interview to explain:

1. What is the local status;
2. Whether it can automatically retry;
3. How to avoid repeated side effects;
4. Recovery by event, inquiry or reconciliation;
5. What users see;
6. How long does it take for an alarm or manual intervention to occur.

## 7. Monitoring indicators

- Stay time in each state and the oldest unfinished record;
- `UNKNOWN`, `COMPENSATING`, `MANUAL_REVIEW` quantity;
- Callback delays, repetition rates and illegal state transitions;
- Compensation success rate and number of retries;
- Reconcile discrepancy rate, discrepancy age and repair backlog;
- The difference between the ledger and external settlement amounts.

## 8. Trade-off

State machines, compensation, and reconciliation add table, event, worker, and operational costs, but they turn inevitable partial failures into observable, recoverable business states. For payment, inventory, and customer data platforms, this is more realistic than pursuing one “magic atomic transaction” that covers all systems.
