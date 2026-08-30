# News Feed Evolution Audit Report

## Main issues of original 01–04

### 1. Product function baseline is not trustworthy

Like has appeared in the requirements, tables, SQL, API and graphs of the original 01, but users hope that 01–04 will only do the core scale evolution of News Feed. Yuan 04 once again claimed to "keep the functionality unchanged" and could not explain when Like was added.

Fix: 01–08 explicitly doesn't have Like; Like first appears in 09 and starts with an empty Like Store, doesn't fake historical interactions.

### 2. Only talk about performance without talking about the fact of data loss first

The original route directly enters Read Replica and Redis from a single Primary, without answering the Primary downtime, accidental deletion, unrecoverable backup, and uncertain submission results.

Fix: Added 02 data reliable version, distinguished synchronization Standby and performance Read Replica, supplemented WAL, PITR, RPO/RTO, fencing and recovery drills.

### 3. Jump directly from JOIN to FeedItem

The original 03 introduced Outbox, Topic, Followers, FeedItem, Worker and online read switching at once, unable to isolate event pipeline errors and Feed algorithm errors.

Fix: Added 04 asynchronous index version. First, create Outbox, Timeline, Following, and Followers in the background, and still use the old JOIN online. After passing Backfill (historical data supplementation) and Shadow Diff (bypass result difference) verification, FeedItem will be cut in 05.

### 4. Data model upgrade without migration explanation

The original 01 Follow is physically deleted when exiting; the final game suddenly has follow_id, followed_at, and unfollowed_at history. Old cycles that have been deleted are virtually irrecoverable.

Fix: 05 Generate initial follow_id for Follow that is still valid when switching; acknowledge that the history ended before Traffic Cutover (traffic cutover) is unrecoverable; save the complete life cycle from the switch point.

### 5. FeedItem does not have Historical Backfill and Traffic Cutover

Only consuming Posts after going online will make the switching user's historical feed empty; there is no rollback path for switching all reads directly.

Fix: 05 Added retention window Backfill, real-time task overlap idempotence, Shadow Read (bypass read), 1% grayscale, difference indicators, old JOIN fallback and final retirement steps.

### 6. Original 04 Solving too many problems at the same time

Hybrid distribution, sharding, hotspots, cached versions, Reconciliation (difference checking and repair), DLQ, observability and disaster recovery are stuffed into the same level and cannot be derived item by item from the previous version.

Fix: split into 06 mixed distribution, 07 shard expansion, 08 resumable production. Feed algorithms, data placement, and operational recovery evolve separately.

## Repaired step-by-step causal chain

| From | Observed Questions | To | New Answers |
|---|---|---|---|
| 01 | Primary is a single point, confirmed writes may be lost | 02 | Synchronous replication, backup, PITR, failover |
| 02 | Feed query occupies Primary resources | 03 | Read Replica, Redis, Database Fallback Protection |
| 03 | cache miss still duplicates JOIN | 04 | Reliable events and derived indexes with Shadow Validation |
| 04 | Asynchronous indexing is stable, but online calculations are still performed on-site | 05 | FeedItem, fan-out, Backfill and Traffic Cutover |
| 05 | Celebrity Account produces extreme Write Amplification | 06 | WRITE/READ mixed distribution |
| 06 | Single cluster capacity, hot key and fault domain to the top | 07 | Sharding by access mode and online migration |
| 07 | Silent Missing Writes and cross-component recovery difficulties | 08 | Versions, Reconciliation, Replay, disaster recovery and drills |
| 08 | The scale base is stable and more product capabilities are needed | 09 | Like, rich media and public interaction |

## Data security conclusion

- User, Post, Follow are factual data for 01–08.
- Cache, Timeline, Following, Followers and FeedItem are all rebuildable.
- "Reconstructable" does not mean allowing Missing Writes to exist for a long time; Freshness (data visibility delay) monitoring and Reconciliation must be performed before online use.
- Successful returns must be bound to clear persistence boundaries, and Queue or Redis cannot be used as fact confirmation.
- Migration must have snapshot point, clear catch-up watermark/offset, Shadow Validation, single authoritative writer and rollback window.
- Copy protects against hardware failure, and backup protects against logical deletion; the two cannot replace each other.

## Follow-up review checklist

Check before each new level:

- Whether to secretly add external functions or APIs;
- Whether the new fields can be reliably Backfilled from old data;
- Is irrecoverable history clearly stated;
- Which side is the authoritative writer during dual writing;
- Whether there is Shadow Read before Traffic Cutover;
- How to determine whether a request has been submitted when it times out;
- Whether Queue re-investment is idempotent;
- How Missing Writes are discovered, not just how to retry;
-Whether rolling back will lose the data generated by the new version;
- Whether the RPO/RTO has been physically drilled.

[Return to News Feed evolution path](README.md)
