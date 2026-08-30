# How to fragment various types of data

## Shard table

| data | type | Partition key | reason |
|---|---|---|---|
| Post | Facts | post_id hash; create another author index | Evenly check to avoid celebrity author_id writing hot spots |
| Follow | Facts | follower_id | The same user's attention cycle is updated in one place |
| Following | Derived | follower_id | Home page answer "Who do I follow" |
| Followers | Derived | followee_id + bucket | fan-out answers "Who follows me", large users need to remove the bucket |
| FeedItem | Derived | user_id + time bucket | Partial reading of home page, very large history bucketed by time |
| Author Timeline | Derived | author_id + time bucket | READ Author reads by time |
| Mode | Control plane | author_id | Check when Post is created |
| Fan-out Job | Task | job_id | Batch progress and retries |

## Follow both directions

Follow Store is the Source of Truth. Following and Followers are Derived Indexes in two query directions, not two independent facts.

Follower Bob follows Alice:

```text
Follow Store: shard(hash(Bob))
Following:    partition(Bob)
Followers:    partition(Alice, bucket(hash(Bob)))
```

In case of index conflict, the valid follow_id in Follow Store shall prevail.

## FeedItem

The unique key is still `(user_id, post_id)` and the read order is still `(rank_time DESC, post_id DESC)`. Time bucket only controls the physical partition size, Feed Query merges the same sort key across adjacent time buckets.

The bucket is determined by the Post's rank_time, so retries of the same `(user_id, post_id)` always fall into the same bucket; otherwise the unique constraint degenerates into "unique within each bucket".

## Cross-shard idempotence and unique constraints

After Post is sharded by post_id, `UNIQUE(author_id, idempotency_key)` of 01 cannot be executed globally by a single Post shard. Add Idempotency Store:

```text
(author_id, idempotency_key) → post_id, request_hash, status
```

It is sharded by author_id and uses a restorable state machine:

1. Conditional writing creates `PENDING(author_id, key, request_hash, post_id)`;
2. Use the reserved post_id to write the target Post shard;
3. After the Post and local Outbox are successfully submitted, the reserved record will be marked COMMITTED;
4. Retries with the same key and the same request_hash continue to complete the same post_id;
5. The same key but different content returns 409;
6. Scan records that have been PENDING for a long time: if the Post already exists, add COMMITTED, otherwise use the original post_id to retry writing.

There are no global transactions between the Idempotency Store and the Post shard, so the state machine must be able to recover from any downtime. Post_id cannot be reassigned after PENDING times out, otherwise the same request may create two Posts.

Follow is sharded by follower_id, and all followees of the same follower are in a logical partition, so conditional writing can ensure that each pair of users can have at most one `unfollowed_at IS NULL` current cycle.

## Fan-out batch

Coordinator first reads Followers in pages, and then groups them according to `feed_shard(user_id)`. A batch only writes to one target shard, and a single shard failure will not require all fans to be retried.

[Return to the seventh edition directory](README.md)
