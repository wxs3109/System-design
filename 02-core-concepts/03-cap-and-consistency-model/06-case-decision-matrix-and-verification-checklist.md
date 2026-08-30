# Case Decision Matrix and Verification Checklist

This page is used to quickly bring the previous concepts into `06-Case Design`. The focus is not on memorizing the default configuration of a product, but on deriving mechanisms from invariants, user experience, and failure behavior.

## Typical scene comparison

| Scenario | Facts that cannot be violated | Parts that can be relaxed | Appropriate mechanism | Partition/behavior during failure |
|---|---|---|---|---|
| Payment | Idempotent requests without repeated deductions; ledger debit balance | Notifications, reports, merchant dashboards | Append ledger, Idempotency Key, local transaction or consensus submission, reconciliation | Return `PENDING` if the result is unknown, query according to the original Idempotency Key; never create a new payment |
| Booking | There is at most one valid confirmation for the same seat | Search results, seat map short-term Stale | Seat ownership is in single Shard, Conditional Write/version, Lease with expiration | If the authoritative Shard cannot be accessed, it will not be confirmed, and can be waitlisted or read-only |
| Shopping cart | One operation cannot be repeated without reason; checkout must be re-verified | Multi-terminal shopping cart contents can be temporarily different | Operation IDs, versions or business rules are merged; checkout is strongly verified | Offline editable, merged after recovery; inventory conflicts are handled by checkout |
| News Feed | Authoritative source for Post ontology and deletion status | Fan Inbox, sorting score, count | Outbox, idempotent Fanout, Session Token, filtered when reading and deleted | Posting can still be done when the distribution backlog is in progress; downgrade to Pull or appear later |
| Chat | Message IDs are unique within the same session; confirmed messages cannot be lost for no reason | Global order across sessions, online status | Sorting by Conversation partition, client serial number, deduplication, causal dependency | Offline queuing for resend; interface displays Pending; cross-session total order is not promised |
| Permissions | Unauthorized subjects cannot continue to access the old Cache | New authorization can be propagated later | Authoritative version, short TTL + active Invalidation, sensitive operations go through Authoritative Read | Fail Closed when it cannot be confirmed; Data Plane can use a clear security snapshot |
| Likes/Counts | Likes factually unique for the same user | Impression count allows transient deviations | Unique Key or idempotent collection; Asynchronous counting, periodic calibration | Accept events and replay; User's own button walk Read-Your-Writes |
| Search Index | Authoritative objects cannot be generated out of thin air | New additions/updates can be visible a few seconds later | CDC/Outbox, versioned Upsert, Backfill and validation | Return old results or downgrade when the index falls behind, never block main writes |

## In-depth case one: payment

### Requirements splitting

- `POST /payments` When the network times out, the client cannot determine "definitely failed";
- The same Idempotency Key and the same request body can only correspond to one payment;
- If the same Idempotency Key is reused for different amounts or different payees, it must be rejected;
- The ledger uses immutable entries, and refunds are a new entry;
- Email, Webhook, and analysis are all derived processes.

### Choose and Trade-off

The authoritative payment status is somewhat consistent with the ledger: submission requires a transaction or consensus, and only `PENDING` may be returned during the Partition, sacrificing the availability of "immediate confirmation". What you get in exchange is an account book that won’t be double-deducted or self-contradictory.

Webhooks tend to be available and eventually consistent: using Outbox and At-Least-Once delivery, merchants may receive duplicates, so they must rely on event IDs to remove duplicates. The trade-off is that payment submission is not held up by a slow merchant endpoint.

### Fault inquiry

- The service crashed after deducting the money but before responding: the same result can be found using the original Idempotency Key;
- The message is published twice: Consumer handles it idempotently according to event ID;
- External payment channel timeout: status remains `UNKNOWN`/`PENDING`, relying on active query and reconciliation to converge;
- Disaster Recovery: Check whether the Database Recovery Point, Outbox and Consumer Offset are aligned. Do not assume Exactly-Once.

## In-depth case two: booking tickets

### Data model and writing

Route `(show_id, seat_id)` to an authoritative Shard. The reservation request carries `expected_version` and performs legal state transition:

`AVAILABLE -> HELD(order_id, expires_at, fencing_token) -> CONFIRMED`

Fencing Token must be used to process expired background tasks: an old task cannot release a seat that has been renewed or is held by a new order. The expiration time is determined by the database time or the authoritative Lease service, and the client clock cannot be trusted.

### Partition selection

- The seat map can be read through Cache and copy, and the interface is marked "subject to confirmation";
- Reservation and confirmation must access the authoritative Shard;
- Return "temporarily unconfirmable" when losing Quorum, or write to a waiting queue that does not promise success;
- The two regions must not be independently confirmed and then "pick a winner" afterwards.

This sacrifices some write availability and protects an irrecoverable ownership invariant. If the business allows pre-segmentation of non-overlapping inventory quotas by region, then each region can sell its own share of the quota independently - but the rebalancing between quotas still requires coordination.

## In-depth case three: News Feed

### Hierarchical semantics

- The main Post table and Outbox will only return successful posting after the same transaction is submitted;
- The author's homepage uses Primary, Session Token or merges a layer of newly written Cache to ensure Read-Your-Writes;
- The Inbox of ordinary fans uses asynchronous Fanout, with the goal of 99.9% being visible within 5 seconds;
- Fanout events may be repeated or out of order, so `FeedItem` uses stable ID / Unique Key and is processed according to the Post version;
- When deleting a post, write the authoritative Tombstone first, filter it out during the homepage assembly stage, and then clean up the Inbox and Cache asynchronously.

### Trade-off

Distributed to all fans simultaneously, the delay and availability of posting will be determined by the slowest Consumer. Asynchronous Fanout shortens the write path, at the cost of users temporarily seeing different results, so it must be equipped with backlog alerts, replay, Backfill, and deletion filtering when reading.

The case can continue to read [write reliability] (../../06-Case Design/02-Specific Application System/03-news-feed/08-Recoverable Production Version/09-Write Reliability.md) and [caching and invalidation] (../../06-Case Design/02-Specific Application System/03-news-feed/08-Recoverable Production Version/11-Caching and Invalidation.md).

## In-depth case four: chat

The phrase "chat messages must be in order" must be limited in scope: usually only a stable server sequence number is required within a single Conversation, and it does not require a general order of messages across the entire platform - the latter will tie the system to a global coordination point.

The sending process can be:

1. The client generates a stable `client_message_id` and tries again with the same ID after timeout;
2. The authoritative Writer of the Shard where the session is located is deduplicated and allocated an incremental Server Sequence;
3. After persisting and reaching the promised number of copies, return accepted;
4. Asynchronously push to each member device, and the device will actively replenish the pull after discovering the gap according to the serial number;
5. Reply messages carry parent/dependency to avoid only displaying the reply but not seeing the parent message.

Online status and "typing" can be eventually consistent and even allowed to be lost; message body and session member permissions are much more restrictive. The client should display Pending during the Partition instead of faking a "Sent" checkmark.

## Seven-step template from requirements to solutions

### 1. List Invariants

Write "cannot at any time..." or "must... after success" to avoid unverifiable statements such as "try to be consistent."

### 2. Mark Source of Truth and Derived Data

Explain where Derived Data is rebuilt, how long Events can be retained, and how to verify them during Backfill.

### 3. Limit the consistency range

Is it single Key, single user, single Session, single order, single tenant, or global? Try to use partition keys to make the coordination domain smaller.

### 4. Define user semantics for normal periods

Including Read-Your-Writes, Monotonic Reads, allowed Staleness Window, and which layer of persistence is meant by "returning successful".

### 5. Behavior when defining Partition

Choose one for each key API: reject, wait, queue, read-only, return old value, or continue to accept mergeable writes.

### 6. Define uncertainty and recovery

Handles timeouts, duplications, out-of-order, conflicts, deletions, leader switching, replay and backup recovery.

### 7. Verify with metrics and tests

Eventual Consistency without observable indicators cannot operate; Strong Consistency without failure testing may be just a configuration assumption.

## What should be monitored

| Commitments | Metrics/Checks |
|---|---|
| Replica Freshness | The time difference between Replication Lag and LSN difference, the oldest Replica Age |
| Derived Data Convergence | Outbox oldest unpublished event age, Consumer Lag, number of DLQs, end-to-end Event Age |
| Session Guarantee | The ratio of Token Wait / Primary Read, the number of times the returned version is lower than the Requested Version (should be 0) |
| Conflict handling | Sibling/conflict rate, LWW coverage, manual processing backlog |
| Quorum Health | Number of available replicas, number of requests rejected due to no Quorum, number of Leader/Term changes |
| Data correctness | Authoritative and derived sampling comparison differences, reconciliation differences, and number of repeated business facts |
| Deletion and permissions | Tombstone propagation delay, number of times it can still be accessed after revocation (should be 0) |

Average latency masks tail issues, Replication and event convergence look at at least P95/P99 and max age.

## Must-test fault scenarios

- Create a Network Partition between two replicas that can serve the outside world, and confirm that there will be no double Leader writes to the Invariant;
- Kill the process when the write has been submitted but the response has not yet been sent, and confirm that retries with the same Idempotency Key will not be executed repeatedly;
- Pause Consumer and then resume it to confirm that it can catch up with the latest Offset and that repeated events have no side effects;
- Let events arrive out of order and make sure old updates cannot overwrite new status or Tombstone;
- Switch to a lagging replica and confirm that the RPO, Session Token and read path all match the claims;
- Restore an old Backup and adjust Message Offset simultaneously to check for duplicate and missing records;
- Having a client with an obviously incorrect future timestamp confirm that it does not permanently suppress subsequent normal writes;
- Concurrent reading and writing during expansion and contraction, confirming that member changes will not form two independent Quorums.

## Minimal format for complete answer

> `Seat` is the Source of Truth, and Invariant means that the same seat in the same event can correspond to at most one Confirmed Order. Write to Partition by seat, perform Conditional Update on Leader, and return after Quorum Commit; the seat map on Replica allows short-term Stale. When quorum is lost, old Snapshots can still be read by browsing, but Reserve and Confirm requests should be rejected or entered into a Waitlist that does not promise success. Request using Idempotency Key, Lease with Fencing Token; monitor No-Quorum Rejection Rate, Commit Latency and the number of conflicts of expired tasks, and verify that there is no double-selling through Network Partition drills and old Leader recovery drills.

This paragraph covers objects, Invariants, models, implementations, CAP selection, user experience, failure recovery and verification methods, which is much more complete than just saying "CP database for ticket booking".
