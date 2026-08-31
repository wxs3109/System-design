# Concurrent Update and Isolation Level

## 1. The question is not "can the database be concurrent", but whether the invariant will be destroyed

Assume that there is only one seat left and two requests are executed at the same time:

```text
Request A: Read available = true
Request B: Read available = true
Request A: write held_by = A
Request B: write held_by = B
```

Both requests may declare to the user that the lock socket was successful. This is a classic check-then-act race. It is not enough to simply make reading and writing into atomic operations. **Conditional judgment and state changes must be located on the same atomic boundary**.

## 2. The most practical solution: conditional update

```sql
UPDATE seats
SET state = 'HELD',
    hold_id = :hold_id,
    expires_at = :expires_at
WHERE show_id = :show_id
  AND seat_id = :seat_id
  AND state = 'AVAILABLE';
```

Success is only achieved if the number of affected rows is 1. Source-of-Truth Database completes checking and modification in the same Atomic Write.

Suitable:

- Individual seats or inventory items;
- The state transition conditions are simple;
- The hotspot is not so high that the database cannot handle it.

Note: The application cannot read the status once and then `UPDATE` unconditionally. The read results used for display may expire at any time.

## 3. Common concurrency exceptions

| Exception | Meaning | Example |
|---|---|---|
| Lost Update | Write later and overwrite first | Two people edit Item at the same time |
| Dirty Read | Read uncommitted data | See balances that will be rolled back later |
| Non-repeatable Read | The same transaction reads the same row twice with different results | Order status changes during the review process |
| Phantom | A new row appears in the query with the same condition | The number of valid reservations counted twice is different |
| Write Skew | Each of the two strokes of writing is legal, but the combination breaks the constraints | Two doctors on duty went offline at the same time |

The stronger the isolation level, generally the higher the conflict, wait, Abort, and coordination costs. Not all APIs require Serializable.

## 4. How to choose isolation strength

### Read Committed

Suitable for normal CRUD and conditional updates by primary key. It avoids Dirty Read, but the compound "check multiple rows first, then write based on the total result" can still go wrong.

### Repeatable Read / Snapshot Isolation

Suitable for transactions that require stable reading of snapshots, such as generating a consistent report slice. Write Skew may still occur with Snapshot Isolation, and cross-row invariants must be protected with unique constraints, explicit locks, or Serializable.

### Serializable

Suitable for critical invariants that must behave like serial execution of transactions, such as complex allocations of scarce inventory. The cost is more lock waits or transaction retries.

Don't just report the name of the isolation level during the interview; explain the specific exception and whether the database is implemented by locking or SSI and other mechanisms.

## 5. Push down invariants to authoritative storage

Preferred use:

- Unique constraint: the same business key can only be created once;
- Check Constraint: illegal status cannot be written;
- Condition update: only the old status can be converted if it meets the conditions;
- Transaction: related lines are submitted together;
- Version/CAS: Reject overrides based on older versions.

```sql
UNIQUE (show_id, seat_id)
UNIQUE (merchant_id, idempotency_key)
```

Cache locks or in-app Mutexes do not replace database constraints: processes are restarted and requests may bypass the same instance.

## 6. Case: lock seat

In [Ticket Reservation System](../../06-case-design/02-specific-application-system/08-ticket-booking/README.md):

1. `Seat` is the inventory fact and the database is the authoritative source.
2. Conditional update makes `AVAILABLE -> HELD` an atomic state transition.
3. `hold_id` is the stable identity of this lock base.
4. `expires_at` prevents resources from being permanently occupied due to the disappearance of the client.
5. When the payment is successful, the status can only be changed from the same `hold_id` to `SOLD`.
6. Conditional updates are also used for expired releases to avoid releasing seats that have been renewed or sold.

A single event may become a hot spot when it goes on sale. At this time, you should route to Single Writer/Partition according to `show_id`, use Queue Buffering to absorb short-term peaks, or pre-allocate inventory instead of relaxing the invariant of "not oversold".

## 7. Trade-off and misunderstandings

| Solution | Advantages | Cost |
|---|---|---|
| Conditional update | Simple, atomic, no need to read first | Limited expression of complex cross-line rules |
| Row lock | Intuitive semantics | Dangers of queuing, deadlock, and long transactions in hot spots |
| Serializable | Protect complex invariants | Abort/retry too many, throughput reduced |
| Single partition serialization | Simple conflict logic | There is an upper limit on hotspot partition throughput |
| Asynchronous Queue | Queue Buffering, control sequence | The user cannot know the final result immediately |

A common misunderstanding is to use Redis `SETNX` to lock the seat, but there is no unique constraint in the database. Duplicate Writes may still occur during Lock Expiration, Failover, or process suspension; ultimately the Source-of-Truth Store must reject illegal results.
