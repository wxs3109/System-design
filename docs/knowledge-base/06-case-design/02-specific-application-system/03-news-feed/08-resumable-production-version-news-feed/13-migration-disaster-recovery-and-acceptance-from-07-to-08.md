# Migration, disaster recovery and acceptance from 07 to 08

## Why do we need another level?

07 Horizontal sharding is already possible, but "having copies, Queue, and Redis" does not mean that the system is recoverable. Also missing are unified data versions, silent miss detection, Replay boundaries and cross-region recovery targets.

## Migration steps

### 1. Add the persistent version first

Add a monotonic version for each logical partition:

- `feed_version(user_id)`；
- `timeline_version(author_id)`；
- `follow_version(follower_id)`；
- `post_version(post_id)`。

The version and corresponding derived data are updated in the same logical transaction or conditional write. First, only record and do not force cache verification.

### 2. Shadow Validation compares cached versions

Feed Query records both cached and persisted version differences, but is still returned with the old logic. After confirming that there is no misjudgment, enable "Query the Authoritative Store if the cached version is lagging behind".

### 3. Online Reconciliation (difference checking and repair)

Run a read-only audit first:

- Post → Author Timeline；
- Follow → Following / Followers；
- WRITE Post + Valid Follow → FeedItem;
- Persistent Version → Cache Version.

Only start speed-limiting repair after observing the difference distribution to avoid batch contamination of data by incorrect rules.

### 4. Standardized Retry / DLQ / Replay

All tasks save the original event_id, job_id, batch_id and shard epoch. Replay must be rate-limited and use the original business identity, and cannot generate new events to pretend to be new operations.

## Cross-regional disaster recovery

| Data | RPO | RTO | Methodology |
|---|---:|---:|---|
| Post / Follow Facts | ≤ 5 minutes, less for critical deployments | < 1 hour | Cross-zone replication + WAL/log backup |
| Derived Index | Relaxable | < Hours | Snapshot + Event Replay + Reconciliation |
| Queue / Job | Don't lose confirmed jobs | < 1 hour | Cross-zone copy or rebuild from Outbox/Job |
| Redis | No commitment to durability | < 30 minutes recovery hotspot | Rebuild from persistent storage |

Fact data is restored first; derived indexes can be rebuilt lazily. During disaster recovery, you cannot restore Redis first and then guess the business facts.

## Area switching sequence

1. Fencing writes to the original area to avoid dual masters.
2. Confirm the fact base replication site and acceptable data loss window.
3. Improve the fact base of the target area.
4. Restore API read/write capabilities.
5. Restore Outbox Relay, Queue and Worker, and limit the consumption rate.
6. Rebuild the hotspot cache.
7. Run the fault window Targeted Reconciliation.
8. Finally resume non-critical cleanup and batch processing.

## 08 Acceptance

- Inject Relay, Worker, Redis and single-shard failure, the user semantics are still correct;
- Ability to locate which event/job/batch/shard a Post stops at;
- Ability to Rate-limited Replay for a specified time window and verify the results;
- Any derived partition can be rebuilt after clearing it;
- The backup can be actually restored, and the RPO/RTO has drill evidence;
- Like is still not present in the API, Store, and graphs of 01–08.

[Return to the eighth edition directory](README.md)
