# Optional: Semantic implementation reference

These snippets are only used to bring the core semantics down to transaction boundaries, not the complete schema, runnable code, or specific database implementation.

## 1. Enqueue is the same transaction as Outbox

```sql
BEGIN;

UPDATE executions
SET status = 'QUEUED'
WHERE execution_id = :execution_id
  AND status = 'SCHEDULED';

-- Insert only if the update affects a row
INSERT INTO execution_outbox(message_id, execution_id, status)
VALUES (:message_id, :execution_id, 'PENDING');

COMMIT;
```

Semantics: Either the state transition and the sending intention exist, or neither exists. Publisher marks `SENT` after receiving MQ persistence confirmation.

## 2. Worker CAS and ACK

```sql
BEGIN;

UPDATE executions
SET status = 'RUNNING',
    current_attempt_id = :attempt_id,
    lease_token = :lease_token,
    lease_expires_at = :expires_at
WHERE execution_id = :execution_id
  AND status = 'QUEUED';

-- Create an Attempt only if the update affects a row
INSERT INTO attempts(...) VALUES (...);

COMMIT;
```

```text
Transaction failed → No ACK
Affected zero rows → Duplicate/Expired messages, ACK
Submit successfully → ACK, then execute the business
```

MQ Consumer Ownership does not replace this authoritative database preemption.

## 3. Reaper and Fencing conditions

Attempt and Lease observed during Reaper write-time revalidation scan:

```sql
UPDATE executions
SET status = 'RETRY_WAIT',
    next_attempt_at = :next_attempt_at
WHERE execution_id = :execution_id
  AND status = 'RUNNING'
  AND current_attempt_id = :observed_attempt_id
  AND lease_token = :observed_lease_token
  AND lease_expires_at <= :observed_expiry;
```

The result reported by the Worker also carries the current `attemptId + leaseToken`. The affected zero line means that the lease has been renewed, taken over or entered into a final state, and the current situation cannot be overwritten.

If the downstream supports fencing, it can use monotonic `attemptNumber` to reject writes that are older than the seen version.

## 4. Keyset Pagination

```sql
SELECT execution_id, scheduled_at
FROM executions
WHERE status = 'SCHEDULED'
  AND scheduled_at <= :cutoff
  AND (scheduled_at, execution_id) > (:last_time, :last_id)
ORDER BY scheduled_at, execution_id
LIMIT :batch_size;
```

Stable compound sorting avoids large offsets. Cursors only optimize scan progress; losing a cursor should result in overlapping scans rather than permanently skipping tasks.

## 5. Implement boundaries

It is deliberately not specified here:

- Complete fields, DDL, indexes and error codes;
- Fixed Lease, Heartbeat or Batch parameters;
- Specific MQ/database products;
- Fixed Shard number, ID bit layout and migration protocol.

These decisions require real workloads, benchmarks, and product contracts. If a piece of implementation cannot explain which invariant it protects, it should not enter the core design.
