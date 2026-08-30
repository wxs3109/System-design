# Observability and recovery

## A specific accident

Alice publishes a WRITE Post at 10:00. The goal is for 99% of FeedItems to be visible within 10 seconds, but by 10:02, some fans are still not visible.

Need answer:

1. At which stage is the problem stuck?
2. Which posts, attention periods and users are affected?
3. Which tasks should be replayed after repair?
4. How to confirm that there are no silent omissions?

## Observation link

> Post commit → Outbox → Queue → Timeline Worker → Fan-out Job → FeedItem batch → cache visible

| Signal | Purpose |
|---|---|
| Metrics | Discover latency, errors, and capacity anomalies |
| Logs | Explain why a task failed |
| Traces | Stringing together cross-service and asynchronous phases |

Metrics are responsible for discovery, logs are responsible for interpretation, and Trace is responsible for correlation.

## The most important user metrics

### Home page request

- `GET /feed` success rate;
- P50, P95, P99 delays;
- Return the proportion of less than 20 items;
- The number of candidates to be scanned every 20 returned.

### Feed Freshness (data visibility delay)

Regular author:

> FeedItem visible time - Post rank_time

Celebrity Account：

> Author Timeline visible time - Post rank_time

Monitor P50, P95, and P99 respectively, and do not mix the WRITE and READ paths into an average value.

## Positioning along the pipeline

### Outbox

- The age of the oldest PENDING event;
- Release success and failure rates;
- Number of event categories such as PostCreated, PostDeleted, FollowChanged, etc.

Post has been submitted but the event is PENDING for a long time, indicating that Relay is lagging behind.

### Queue

- consumer lag；
- The age of the oldest message;
- Quantity produced and consumed per second;
- Number of retry queues and DLQs.

The age of the oldest message is usually a better indicator of how long the user has been waiting than the total number of messages.

### Timeline Worker

- Timeline update delay and error rate;
- timeline_version backwardness;
- Reconciliation diff for missing Timeline item.

The freshness of READ Post is mainly determined by this path.

### Fan-out Worker

- Job completion rate of WRITE Post;
- Success, failure and retry batch numbers;
- FeedItem writes per second;
- P99 latency and error rate for each target shard.

## Structured log fields

| Field | Example |
|---|---|
| `trace_id` | trace-001 |
| `event_id` | event-789 |
| `post_id` | post-123 |
| `distribution_mode` | WRITE |
| `mode_version` | 7 |
| `job_id` | job-456 |
| `batch_id` | batch-17 |
| `target_shard` | feed-shard-8 |
| `attempt` | 3 |
| `error_code` | DB_TIMEOUT |

Just writing "database error" cannot determine the scope of impact. Stable IDs allow multiple retries of the same task to be correlated.

## Fan-out Job Progress

| Field | Example |
|---|---|
| `job_id` | job-456 |
| `post_id` | post-123 |
| `mode_version` | 7 |
| `expected_batches` | 100 |
| `succeeded_batches` | 93 |
| `failed_batches` | 7 |
| `status` | PARTIAL |

Each batch saves the target shard, fan user_id and follow_id range, status, number of attempts and recent errors.

If all failed batches point to feed-shard-8, only this shard will be processed and the other 93 successful batches will not be replayed.

## The first step in recovery: stop bleeding first

Immediate retries amplify failures when the downstream is still overloaded.

1. Reduce or pause the consumption rate sent to the failed shard.
2. Keep the unfinished message without confirming the success or discarding it.
3. Let retries use backoff and jitter.
4. Expand the capacity, cut off the main server or repair the downstream.
5. Confirm the online request error rate and start recovery.
6. Then gradually increase the backlog consumption rate.

New traffic, historical backlog, and retry traffic must share the capacity budget.

## Recovery step two: Replay failed task

### Timeline failed

Replay Timeline Worker using original event_id and post_id. `unique(author_id, post_id)` is guaranteed to be idempotent.

### Fan-out failed

Only Replay failed batches. `unique(user_id, post_id)` ensures that FeedItems will not be generated repeatedly even when a batch was halfway completed last time.

### Relational index failed

Rebuild Following and Followers based on the record of `unfollowed_at IS NULL` in Follow Store, and carry the original follow_id.

## The third step of recovery: Targeted Reconciliation

### How to judge FeedItem

You cannot simply use a Followers Index that may be lagging behind. For FeedItems that should still be visible currently, the correct conditions are:

1. Post’s `distribution_mode = WRITE`;
2. There is a currently valid relationship in Follow Store, namely `unfollowed_at IS NULL`;
3. The attention period satisfies `followed_at <= rank_time`;
4. FeedItem records the corresponding current follow_id;
5. `(user_id, post_id)` unique.

If the user has unfollowed, there is no need to replenish the FeedItem for the ended cycle; if the user re-follows, the followed_at of the new cycle is later than the old Post, and the old content will not be replenished.

### Reconciliation scope

- Failure time window;
- Failed target sharding;
- a specific post_id, job_id or batch_id;
- DLQ related tasks;
- Sample users.

Avoid frequent full database scans. The Reconciliation program must also be speed-limited, idempotent, and obey the shard capacity budget.

## Cache recovery

- Feed Head is rebuilt from FeedItem Store with latest feed_version.
- The Author Timeline cache is rebuilt from the persistent Timeline.
- The Following cache is rebuilt from the Following index and verified with Follow Store if necessary.
- Post cache is rebuilt from Post Store.

After a Redis failure, limit Database Fallback concurrency and warm up the Hot Key first to prevent all application instances from overwhelming the database at the same time.

## Minimal dashboard

| Region | Indicator |
|---|---|
| User experience | Feed success rate, P95/P99, short page ratio |
| Freshness | WRITE FeedItem delay, READ Timeline delay |
| Pipeline | Outbox age, Queue lag, Worker throughput and error rate |
| Sharding | QPS per shard, P99, capacity, replication latency, hot key |
| Data Quality | Timeline, Followers, FeedItem Reconciliation Differences |
| Cache | Hit Ratio、Version Lag、Invalidation Event Age、Database Fallback QPS |

## Trace phase

| Span | Stage |
|---|---|
| CreatePost | Write Post and Outbox |
| PublishEvent | Relay publish event |
| UpdateTimeline | Update Author Timeline |
| CreateFanoutJob | Create a job for WRITE Post |
| ProcessBatch | Process a target shard batch |
| UpdateFeedVersion | Publish cached version of feed |

There is no need to create a span for each FeedItem. Use batch granularity and increase the sampling rate for errors and high-latency tasks.

## Complete accident process

1. **Discovery**: WRITE Freshness P99 and shard-8 error rate alarm.
2. **Positioning**: Failed batches all point to shard-8.
3. **Stop bleeding**: Reduce shard-8 consumption rate.
4. **Fix**: Restore shard capacity or complete master node switching.
5. **Replay**: Rate-limited Replay failed batch.
6. **Verification**: The age of the oldest task and the error rate decrease.
7. **Reconciliation**: Use Post mode and Follow history to fill in missing items.
8. **Review**: Record the root cause, scope of impact and preventive measures.

## Finally, remember only four sentences

1. **Observe WRITE and READ Freshness** respectively.
2. **Stable ID strings together events, jobs, batches and shards**.
3. **Stop bleeding first, then Rate-limited Replay**.
4. **Press Post mode and Follow history Reconciliation, you cannot just see the current fan list**.

[Return to the eighth edition directory](README.md)
