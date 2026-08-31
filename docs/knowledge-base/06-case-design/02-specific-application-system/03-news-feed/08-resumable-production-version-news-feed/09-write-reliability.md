# Write reliability

## Why does asynchronous writing cause errors?

After Alice publishes a Post, the system must at least complete:

1. Save the post.
2. Publish the PostCreated event.
3. Write Author Timeline.
4. If Post is in WRITE mode, write FeedItem for fans.

These operations span databases, queues, and workers, and there is no global transaction covering all components. Any step may crash between "actual success" and "confirmed success".

So it will appear:

- Missing Write: Post exists, but Timeline or part of FeedItem is missing.
- Repeated writing: The message is re-delivered and the Worker performs the same task again.
- Delayed Write: The task is still in the queue, but processing is lagging behind.

## Post and Outbox atomic commit

Post Service saves in the same local transaction:

- Post；
- PostCreated Outbox event.

When Post is submitted, the event to be published must exist. Relay scans the Outbox and sends to the message queue.

The Relay may go down when "the message has been sent and the Outbox status has not been updated", so the queue may receive duplicate events. The system accepts at least one delivery and keeps consumers idempotent.

## What does the PostCreated event require?

| Field | Purpose |
|---|---|
| `event_id` | Identify duplicate events |
| `post_id` | Post ID |
| `author_id` | Author ID |
| `rank_time` | Post publishing time and Feed sorting time |
| `distribution_mode` | `WRITE` or `READ` |
| `mode_version` | Pattern version as published by the author |

`distribution_mode` comes from Post, not the author's current status as requeried by the consumer.

## The first consumer: Author Timeline Worker

All Posts, whether WRITE or READ, must be written idempotently to the Author Timeline:

> unique(author_id, post_id)

In this way, the Author Timeline can support READ Post and can also be used as an index and recovery source for author posts.

If the Timeline Worker writes successfully but crashes before confirming the message, the message will be re-delivered; the unique key prevents repeated execution from generating a second message.

Author Timeline is a derived index. Reconciliation (difference checking and repair) can scan Post and fill in missing items.

## The second consumer: Fan-out Coordinator

Coordinator first reads the mode solidified on Post:

- `READ`: Flag fan-out not applicable, no FeedItem job created.
- `WRITE`: Read Followers Index, create Fan-out Job and batch.

Each batch is saved:

- `job_id` and `batch_id`;
- `post_id`；
- target FeedItem fragment;
- Fans `user_id` and corresponding `follow_id`;
- Batch status and number of attempts.

Create independent batches based on target shards. When a certain shard fails, only the relevant batch will be retried.

## FeedItem idempotent writing

The unique keys for FeedItem are:

> (user_id, post_id)

Writes include `follow_id`, `rank_time`, `inserted_at`, and `mode_version`.

The order of workers is:

1. Write FeedItem.
2. Confirm that the storage is persisted.
3. Update batch progress.
4. Finally acknowledge the queue message.

Writing first and then confirming may result in retries, but confirmed tasks will not be missed. Unique keys eliminate duplicate results.

## Followers Index What to do if you are temporarily behind?

Followers is just the reverse index of Follow, which may temporarily have one less or more one.

- Multiwrite: Read paths are filtered by `follow_id` and the current Follow fact.
- Missing Write: Relationship index Reconciliation first repairs Followers; FeedItem Reconciliation then fills in the missing items.

The judgment conditions for FeedItem repair are:

- Post is WRITE mode;
- There is currently a valid follow_id;
- `followed_at <= rank_time`；
- The corresponding `(user_id, post_id)` does not exist yet.

Re-following generates a new follow_id, and the new followed_at is later than the old Post, so the old post will not be replenished.

## Retry and DLQ

Timeouts, current limits, and temporary sharding failures use exponential backoff and add jitter (random jitter). Permanent errors such as data format errors cannot be retried indefinitely.

Tasks that exceed the automatic retry budget enter DLQ and retain event_id, post_id, job_id, batch_id, target shard, error code, and number of attempts.

After repairing the root cause, use the original ID to do Rate-limited Replay. Because Timeline and FeedItem writes are idempotent, it is safe to replay the entire Batch.

## Three types of Reconciliation

| Reconciliation | Source of Truth | Restoration Goals |
|---|---|---|
| Timeline Reconciliation | Post | Missing Author Timeline item |
| Followers Reconciliation | Currently active Follow | Following / Followers Index |
| FeedItem Reconciliation | WRITE Post + currently valid Follow | FeedItem with missing or wrong follow_id |

Reconciliation is executed according to time windows, shards or abnormal tasks, and the entire database is scanned infrequently. Reconciliation writes must also be idempotent and rate-limited.

## Finally, remember only four sentences

1. **Post and Outbox are submitted together** to ensure that subsequent tasks are not lost.
2. **Author Timeline writes** to all Posts, and then WRITE Posts continue fan-out.
3. **Messages are allowed to be repeated, and the results must be idempotent**.
4. **Known failures rely on retrying, and silent omissions rely on Reconciliation**.

[Return to the eighth edition directory](README.md)
