# List of roles, components and data

## Purpose of this chapter

This chapter determines which boxes should appear in the architecture diagram, and what each box is responsible for, reading, and writing.

Component boundaries confirmed. The Draw.io diagram below strictly maps nodes and connections according to this list; when the architecture is subsequently modified, the diagram and this list need to be updated simultaneously.

## Editable architecture diagram

[Click the link to open the thumbnail: post, follow, read the homepage, and close](assets/flows/README.md)

[Open the full Draw.io overview](assets/news-feed-large-architecture.drawio)

The figure includes four pages: component overview, writing and asynchronous distribution, home page reading path, fault recovery and Reconciliation (difference checking and repair).

## 1. User role

The same user can play different roles in different requests. Here we break it down by behavior to see the system path clearly.

| Role | Behavior | Portal API |
|---|---|---|
| Feed Reader | Open and page the homepage | `GET /feed` |
| Author | Post or delete | `POST /posts`, `DELETE /posts/{id}` |
| Follower | Follow or unfollow the author | `POST /follows/{id}`, `DELETE /follows/{id}` |
| Operator | View alarms, Replay DLQ, start Reconciliation | Internal operation and maintenance portal |

## 2. Synchronization Service

The Sync Service handles client requests directly. They should remain stateless, with state written to the backend database or cache.

### 1. API Gateway / Auth

Responsibilities:

- TLS termination, authentication, flow limiting and request routing;
- Get `current_user_id` from token;
- Pass request_id, trace_id and `Idempotency-Key`;
- News Feed business data is not saved.

Call downstream: Post Service, Follow Service, Feed Query Service.

### 2. Post Service

deal with:

- `POST /posts`；
- `DELETE /posts/{id}`。

Read:

- Author Mode Cache / Store, obtain the author's current `distribution_mode` and `mode_version`;
- Post Store, handles idempotent retries and permission checks.

Write:

- Post Store；
- Post Outbox in the same transaction as Post.

Key Rule: Solidify `rank_time`, `distribution_mode` and `mode_version` when Post is created. Subsequent Workers will not re-judge the author's current mode.

### 3. Follow Service

deal with:

- focus on;
- Take off;
- Query necessary relationship status.

Read:

- User Store, confirm that the target user exists;
- Follow Store to check if there is currently a valid relationship.

Write:

- Follow cycle in Follow Store;
- Follow Outbox in the same transaction as Follow.

Focus on creating new `follow_id`. Unlock and write `unfollowed_at` without deleting historical facts.

### 4. Feed Query Service

Handles `GET /feed`, which is the primary read path.

Read:

- Feed Head Cache / FeedItem Store: WRITE Post candidate;
- Following Cache / Following Index: current author and follow_id;
- Author Mode Cache: Which authors are in the READ mode range in the feed window;
- Author Timeline Cache/Store: READ Post candidate;
- Post Cache / Post Store: text and deletion status;
- Follow Store: Verify follow facts when the cache or index version is uncertain.

Internal processing:

1. Select candidates from two types of sources.
2. Press `(rank_time, post_id)` to merge.
3. Press post_id to remove duplicates.
4. Filter deleted Posts and invalid follow_id.
5. Continue to select candidates until 20 items are returned or the scanning limit is reached.

Writing: usually no business facts are written, only access indicators are recorded, and the cache is Backfilled (historical data supplementation) when a cache miss occurs.

### 5. Distribution Policy Service

This is an internal control plane and is not on the synchronization critical path for each feed request.

Responsibilities:

- Calculate the author mode based on the number of fans, posting frequency, active fan ratio and queue backlog;
- Maintain `WRITE / READ` current mode and mode history;
- Add `mode_version` when the mode changes;
- Post the AuthorModeChanged event to update the cache.

The Post Service reads the current mode when creating a Post. Feed Query Service reads author mode history in batches and determines which Author Timelines need to be pulled.

## 3. Asynchronous Worker

### 1. Post Outbox Relay

Input: Unpublished Outbox records in the Post Store.

Output: PostEvents topic.

Events include PostCreated and PostDeleted. Relay allows repeated publishing, and consumers must be idempotent.

### 2. Follow Outbox Relay

Input: Unpublished Outbox records in the Follow Store.

Output: FollowEvents topic.

Events include FollowStarted and FollowEnded.

### 3. Author Timeline Worker

Consume PostEvents.

- PostCreated: idempotent writing to Author Timeline;
- PostDeleted: mark or remove Timeline item;
- Update persistence `timeline_version`;
- Post TimelineChanged.

All Posts enter the Author Timeline, not just Celebrity Account Posts. When the feed is read, press `distribution_mode` to select READ Post.

### 4. Follow Index Worker

Consume FollowEvents.

- Update Following Index;
- Update Followers Index;
- Carry original `follow_id`;
- Update `follow_version`;
- Post FollowingChanged / FollowersChanged.

When the index write fails, it is rebuilt from the Follow Store. The two indexes cannot determine the facts of each other.

### 5. Fan-out Coordinator

Consume PostCreated:

- `distribution_mode = READ`: Does not create FeedItem job;
- `distribution_mode = WRITE`: Read Followers Index in pages and create Fan-out Job.

The Coordinator will verify `followed_at <= rank_time` to avoid adding users who followed after publishing to the task.

It splits into batches by target FeedItem shard and puts the batches into the FanoutBatch Queue.

### 6. Fan-out Worker Pool

Consume FanoutBatch Queue.

Only write one target FeedItem shard per batch:

- Write to `user_id`, `post_id`, `author_id`, `follow_id`, `rank_time`, `inserted_at` and `mode_version`;
- Rely on `(user_id, post_id)` to only guarantee idempotence;
- Update Fan-out Job/Batch status;
- Update the user's persistence `feed_version`;
- Publish FeedChanged.

### 7. Cache Invalidation Worker

Consumes FeedChanged, TimelineChanged, FollowingChanged, PostDeleted and AuthorModeChanged.

Responsibilities:

- Update Version Cache;
- Delete the old Redis key, or write the new version value;
- Retry on failure;
- Long term failure goes to DLQ.

### 8. Cleanup Worker

Responsible for physical cleanup that does not affect immediate visibility:

- Delete the old FeedItem and Timeline item corresponding to the deleted Post;
- Clean up the old FeedItem corresponding to the ended follow_id;
- Clean up FeedItems that have exceeded the retention period;
- Clean up expired Outbox, Job and tombstone.

Cleanup failures should not make deleted or disabled content visible again, as the read path is still filtered by the fact.

### 9. Reconciliation Worker

Perform Reconciliation on a regular basis or by incident scope:

- Post → Author Timeline；
- Follow → Following / Followers；
- WRITE Post + currently valid Follow → FeedItem;
- Persistent Version → Cache Version.

Reconciliation must be rate-limited, idempotent, and executed according to time windows or shards.

### 10. DLQ Replay Worker

Started by the Operator after root cause remediation.

Using the original event_id, job_id and batch_id Rate-limited Replay, new business identities cannot be generated. Targeted Reconciliation is executed after Replay.

## 4. Messages and queues

### Why is there both Topic and Queue?

- Topic is used for an event to be processed independently by multiple consumers, such as PostCreated driving Timeline and Fan-out at the same time.
- Task Queue is used for a job to be collected by a Worker in the Worker pool, such as a Fan-out batch.

| Name | Type | Producer | Consumer | Main content |
|---|---|---|---|---|
| PostEvents | Kafka/Pulsar topic | Post Outbox Relay | Timeline Worker、Fan-out Coordinator、Cleanup Worker | PostCreated、PostDeleted |
| FollowEvents | Kafka/Pulsar topic | Follow Outbox Relay | Follow Index Worker、Cleanup Worker | FollowStarted、FollowEnded |
| AuthorModeEvents | Kafka/Pulsar topic | Policy Service | Cache Invalidation Worker | AuthorModeChanged |
| FanoutBatch Queue | SQS/RabbitMQ/Kafka task topic | Fan-out Coordinator | Fan-out Worker Pool | A batch for a target shard |
| DerivedChangeEvents | topic | Timeline / Follow Index / Fan-out Worker | Cache Invalidation Worker | TimelineChanged、FollowingChanged、FeedChanged |
| Retry Queue | Delay Queue | Each Consumer | Original Consumer | Temporarily Failed Task |
| DLQ | DLQ | Retry System | Operator / Replay Worker | Tasks exceeding automatic retry budget |

The reference implementation can all use Kafka/Pulsar, but the logic still needs to distinguish between "broadcast events" and "tasks that can only be completed by one Worker".

## 5. Factual data and database

Factual data requires correctness, idempotent constraints, and outbox atomic commits. The reference implementation prefers distributed SQL such as Google Spanner, CockroachDB, or routed MySQL/PostgreSQL shards.

| Database | Type | Primary Key / Sharding Key | Primary Data | Why |
|---|---|---|---|---|
| User Store | Distributed SQL or sharded relational library | `user_id` | Basic user information | Unique username and account transactions |
| Post Store | Distributed SQL | `post_id` | Post, deletion status, distribution mode, Post Outbox | Post and Outbox require local transactions; support idempotent unique keys |
| Follow Store | Distributed SQL | `follower_id` | Follow cycle, Follow Outbox | Follow and follow need to update facts and events consistently |
| Mode Store | Strongly Consistent KV or Distributed SQL | `author_id`, `mode_version` | Current mode and Mode History | Post creation requires a certain version |

### Post record

| Field | Example |
|---|---|
| post_id | post-123 |
| author_id | Alice |
| content | Hello |
| rank_time | 10:00 |
| distribution_mode | WRITE |
| mode_version | 7 |
| deleted_at | null |

### Follow Fact Record

| Field | Example |
|---|---|
| follow_id | F2 |
| follower_id | Bob |
| followee_id | Alice |
| followed_at | 15:00 |
| unfollowed_at | null |

## 6. Derived index and database

Derived indexes emphasize high-throughput reading and writing by partition key and time sorting. The reference implementation uses Cassandra, ScyllaDB, DynamoDB, or Bigtable.

| Database | Type | Partition key | Sort / clustering key | Value |
|---|---|---|---|---|
| Author Timeline Store | Wide Column/KV | `author_id` | `rank_time DESC, post_id DESC` | mode, mode_version |
| FeedItem Store | Wide column/KV | `user_id`, add time bucket if necessary | `rank_time DESC, post_id DESC` | author_id, follow_id, inserted_at, mode_version |
| Following Index | Wide Column/KV | `follower_id` | `followee_id` | follow_id, followed_at |
| Followers Index | Wide Column/KV | `followee_id` | `follower_id` | follow_id, followed_at |
| Fan-out Job Store | Distributed SQL or persistent KV | `job_id` | `batch_id` | Target shards, status, retries |

### Where to put the persistent version?

Version metadata should be placed in the same logical partition as the corresponding derived data and updated atomically whenever possible:

| Version | Location |
|---|---|
| `feed_version(Bob)` | Bob’s FeedItem partition metadata |
| `timeline_version(Alice)` | Alice's Author Timeline partition metadata |
| `follow_version(Bob)` | Bob's Following partition metadata |
| `post_version(post-123)` | Post Store |

The Version Cache in Redis is just a fast copy of these persistent versions.

## 7. Cache

### Redis Cluster

| Key | Value |
|---|---|
| `post:post-123` | Post text, deleted, post_version |
| `feed:Bob:head` | Recent candidate ID, rank_time, feed_version |
| `following:Bob` | author_id、follow_id、followed_at、follow_version |
| `author:Alice:timeline` | Recent Timeline item, timeline_version |
| `mode:Alice` | Current mode and limited history window |

### Apply local cache

Only put extremely hot, small, short TTL data such as Author Mode, Post tombstone, and routing information.

Local cache invalidation is more difficult to synchronize than Redis, so it cannot be used to independently determine the visibility after deletion or removal.

## 8. Observability storage

| Data | Recommended Types | Examples |
|---|---|---|
| Metrics | Time series database | Prometheus, Mimir, Azure Monitor |
| Logs | Log index + object storage | Elasticsearch/OpenSearch, Loki |
| Traces | Trace Store | Tempo、Jaeger、Application Insights |
| Long-term auditing and incident data | Object storage | S3, Azure Blob, GCS |

Business databases should not be responsible for high-cardinality Log and Trace queries.

## 9. Component dependency matrix

| Component | Read | Write/Publish |
|---|---|---|
| Post Service | Mode Cache、Post Store | Post Store + Post Outbox |
| Follow Service | User Store、Follow Store | Follow Store + Follow Outbox |
| Feed Query Service | Redis, FeedItem, Following, Mode, Timeline, Post, Follow if necessary | Cache Backfill, Metrics |
| Timeline Worker | PostEvents | Author Timeline、timeline_version、TimelineChanged |
| Follow Index Worker | FollowEvents、Follow Store | Following、Followers、follow_version |
| Fan-out Coordinator | PostEvents、Followers Index | Job Store、FanoutBatch Queue |
| Fan-out Worker | FanoutBatch Queue, Follow Store if necessary | FeedItem, Job status, feed_version, FeedChanged |
| Cache Invalidation Worker | DerivedChangeEvents | Redis、Version Cache |
| Reconciliation Worker | Fact Store and Derived Store | Missing derived data, repair tasks |

## 10. Core process list

### Post WRITE Post

`Client → Gateway → Post Service → Post Store + Outbox → PostEvents → Timeline Worker + Fan-out Coordinator → FanoutBatch Queue → Fan-out Worker → FeedItem Store → FeedChanged → Cache Invalidator`

### Publish READ Post

`Client → Gateway → Post Service → Post Store + Outbox → PostEvents → Timeline Worker → Author Timeline → TimelineChanged → Cache Invalidator`

Fan-out Coordinator ends after seeing READ mode without creating a batch.

### Read Feed

`Client → Gateway → Feed Query Service → Following + Mode History → Feed Head + Author Timeline → merge/dedupe → Post Cache/Store → Follow validation → response`

### Follow or unfollow

`Client → Gateway → Follow Service → Follow Store + Outbox → FollowEvents → Follow Index Worker → Following + Followers → FollowChanged → Cache Invalidator`

### Delete Post

`Client → Gateway → Post Service → Post soft delete + Outbox → PostDeleted → Post cache tombstone + Timeline/Feed cleanup`

## 11. Nodes that must appear in the future architecture diagram

### Online request

- Client；
- API Gateway / Auth；
- Post Service；
- Follow Service；
- Feed Query Service；
- Distribution Policy Service。

### Asynchronous processing surface

- Post / Follow Outbox Relay；
- PostEvents / FollowEvents；
- Timeline Worker；
- Follow Index Worker；
- Fan-out Coordinator；
- FanoutBatch Queue；
- Fan-out Worker Pool；
- Cache Invalidation Worker；
- Cleanup / Reconciliation / Replay Worker。

### Data surface

- Post Store + Outbox；
- Follow Store + Outbox；
- Mode Store；
- Author Timeline Store；
- Following / Followers Index；
- FeedItem Store；
- Fan-out Job Store；
- Redis Cluster + Version Cache；
- Metrics / Logs / Traces。

## 12. Don’t draw things as independent sources of fact

- FeedItem is not a Post Store.
- Following / Followers are not two independent business facts.
- Redis is not a persistent database.
- Outbox is not a message queue, it is a record to be published in the fact database.
- Author Timeline does not only belong to Celebrity Account; all Posts are written, and Feed only pulls READ Posts.
- `distribution_mode` cannot only be drawn on the author node, it is also solidified on each Post.

[Return to the eighth edition directory](README.md)
