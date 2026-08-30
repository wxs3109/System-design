# FeedItem Backfill (historical data supplement), Traffic Cutover (traffic switching) and reliability

## Small link diagram

[Open editable Draw.io diagram](assets/post-fanout-write.drawio)

## Synchronization part

Post Service continues to commit in a local transaction:

- Post；
- PostCreated Outbox records.

This is the 04 proven success boundary. 05 Does not change the return semantics of the posting API.

## Asynchronous part

1. Outbox Relay publishes PostCreated to PostEvents.
2. Coordinator reads Followers (Alice) in pages and creates persistent Fan-out Job and batch.
3. The batch enters the Queue according to the target FeedItem partition.
4. Worker writes FeedItem idempotently to each fan.
5. Confirm the Queue message after persisting the batch progress.

## History FeedItem Backfill

You cannot only distribute Posts after they go online, otherwise the home page will only have new content after Traffic Cutover:

1. Fixed feed retention window, such as the last 30 days.
2. The Post and the Follow cycle in effect at that time are not deleted within the scanning window.
3. FeedItem is generated only if `followed_at <= rank_time` and the period is valid at that time.
4. Backfill uses the same `unique(user_id, post_id)` as real-time distribution, allowing overlap.
5. Compare the sampling results of the new FeedItem to the old JOIN by user partition.

## Canary Cutover (low traffic switching)

1. Shadow Read: JOIN is still returned online, and FeedItem results are compared in the background.
2. Internal accounts and 1% of users read FeedItem first, and fall back to the old JOIN if it fails.
3. Observe the missed post rate, duplication rate, short page rate, P99 and bounce rate.
4. Gradually expand to 100%, retaining the old path for a rollback window.
5. Stop the old JOIN only when the difference and SLO are met.

## Minimum reliability rule

| Risks | Processing |
|---|---|
| Relay goes down after publishing and before marking | Accept duplicate messages |
| Worker crashes after finishing writing and confirming | Retry the original task |
| Duplicate FeedItem | `unique(user_id, post_id)` |
| Temporary storage error | Exponential backoff retry |
| Permanent format error | Entering DLQ, retaining event_id and post_id |
| Initial Backfill missing partition | History feed becomes shorter after user Traffic Cutover | Partition list, checksum, Shadow Diff (bypass result difference) |
| Queue message is lost but Job is not completed | Batch generates permanent Missing Writes | Job Scanner re-delivers unfinished Batch |
| Followers Index is missing one valid follower | The corresponding FeedItem is missing silently | 04 index difference threshold, sampling old JOIN comparison; 08 systematic Full Reconciliation (difference inspection and repair) |

This version guarantees "repeatable messages and non-repeatable results" and uses persistent jobs to discover known unfinished tasks. System-wide Silent Missing Reconciliation and recovery platform rolled out in 08.

[Return to the fifth edition directory](README.md)
