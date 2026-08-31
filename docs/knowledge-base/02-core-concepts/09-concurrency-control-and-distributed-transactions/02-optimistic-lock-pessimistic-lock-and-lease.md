# Optimistic Lock, Pessimistic Lock and Lease

## 1. First look at the conflict rate and holding time

```text
Low conflicts, short updates: prioritize optimistic concurrency control
High conflict, very short transactions: consider pessimistic row locking or serialization
Cross-process, long-term exclusivity: use Lease and configure fencing token
```

"Distributed Lock" is not a universal correctness service. You must answer where the lock is, when it will expire, and whether you can continue writing after the old holder is restored.

## 2. Optimistic locking: Version / ETag / CAS

When reading the object, we get version 8, and when we save it, we declare "overwrite only if it is still version 8":

```http
PUT /items/report-42/definition
If-Match: "etag-8"
```

Database update:

```sql
UPDATE items
SET definition_version = 9, version = version + 1
WHERE item_id = :item_id AND version = 8;
```

A number of 0 affected rows indicates a conflict. The client can reread, merge, or prompt the user.

Suitable:

- Documentation and configuration editing;
- less conflict;
- Don't want users to hold database locks while editing.

Not suitable for: High-conflict rush sales of popular inventory. A large number of requests will read successfully, eventually concentrating on conflicts and retrying repeatedly.

Case: [Multi-tenant data platform save Item](../../06-case-design/03-platform-system/01-multi-tenant-data-platform/01-system-design-mainline/07-workload-and-item.md).

## 3. Pessimistic lock

The transaction acquires an exclusive or update lock while reading, and other conflicting transactions wait:

```sql
BEGIN;
SELECT * FROM seats
WHERE show_id = :show_id AND seat_id = :seat_id
FOR UPDATE;

-- Verify status and update
COMMIT;
```

Suitable:

- High probability of conflict;
- The critical section is very short;
- All conflicting writes go through the same database.

risk:

- Put external payment or RPC in the transaction, the lock will be held for several seconds or even longer;
- Inconsistent locking order for multiple rows will result in deadlock;
- Hot guilds will queue all requests;
- After timeout, the entire transaction needs to be rolled back and retried.

Only perform local, fast, and predictable operations in database transactions. Don't hold a row lock waiting for users to pay.

## 4. Lease: ownership with a term

When the Worker receives the task, write:

```text
(operation_id, attempt_id, lease_until, fencing_token)
```

Workers must renew their lease periodically. After the crash, the Lease expires and another Worker can claim it. Lease solves "how to continue after the holder disappears", but it alone does not prevent the old Worker from resuming and writing.

## 5. Why do we need fencing token?

Timeline:

```text
Worker A gets token=10
Worker A has a long GC Pause and the Lease expires.
Worker B gets token=11 and starts execution
Worker A recovers and still considers himself the owner
```

The downstream store must only accept commits greater than the current token:

```text
last_fencing_token = 11
reject commit(token = 10)
```

Otherwise, no matter how accurate the Lease service is, it will not be able to prevent the old process that resumes after being paused from overwriting the new results.

Case: [Operation and Job Scheduling Domain](../../06-case-design/03-platform-system/01-multi-tenant-data-platform/02-business-domain-design/05-operation-and-job-scheduling-domain.md).

## 6. Applicable boundaries of distributed locks

You can use:

- Reduce repetitive background work;
- Leader Election；
- Protect maintenance tasks that cannot be run concurrently;
- As a performance optimization, let most competitors exit early.

It cannot be relied upon alone to ensure financial and inventory correctness. Correctness should still be guaranteed by authoritative stored versions, unique constraints, state machines, or fencing tokens.

## 7. Select table

| Scenario | Selection | Failure Handling |
|---|---|---|
| Two people occasionally edit Report at the same time | ETag/CAS | Return 409, re-read and merge |
| Hot seat conversion in single database | Conditional updates or short row locks | Explicit failure for non-updaters |
| Worker receives long task | Lease + fencing token | Create new Attempt upon expiration |
| Schedule cleaning tasks to avoid duplication | Distributed locks can be used as coordination | The tasks themselves still need to be idempotent |
| Payment deduction | Idempotent state machine and ledger constraints | Query, callback, reconciliation |

## 8. Interview Checklist

- What are the conflict probabilities and critical section times?
- Should writing stop or continue when the lock service fails?
- Who controls the Lease clock and renewals?
- After the old holder is restored, how does the downstream reject it?
- Will lock timeouts break external side effects being executed?
- Can Source-of-Truth Constraint hold Invariant even if Lock fails?
