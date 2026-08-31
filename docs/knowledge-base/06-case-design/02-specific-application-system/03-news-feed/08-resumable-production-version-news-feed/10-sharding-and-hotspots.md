# Sharding and hotspots

## Sharding target

Sharding solves the upper limit of single machine capacity and throughput. The shard key is determined by the primary access path: frequently used queries should target the shard directly, rather than being broadcast to all shards.

## Shard summary table

| data | type | shard key | main query |
|---|---|---|---|
| User | Fact | `user_id` | Read based on user ID |
| Post | Facts | `post_id` | Batch read based on Post ID |
| Follow | Facts | `follower_id` | Query the user's follow history and current relationship |
| Following | Derived index | `follower_id` | Query "Who am I currently following" |
| Followers | Derived Index | `followee_id` | Query "Who is currently following me" |
| Author Timeline | Derived Index | `author_id` | Query the author's most recent Post |
| FeedItem | Derived index | `user_id` | Query user homepage candidates |

Not all data uses the same Shard Key. The same Follow fact will derive two query directions, but Follow Store is the Source of Truth.

## User and Post

User hashes to logical bucket based on `user_id`.

Post locates the shard based on `post_id` and uses primary key lookup within the shard. After the homepage gets a batch of post_ids, it can be grouped by target Post shards and multi-get in parallel.

Post is not stored directly by author_id because the most common text reading entry is post_id. Author dimension queries are supported by the smaller Author Timeline index.

## Follow and bidirectional indexing

### Follow the facts

Follow Store is partitioned according to `follower_id`, and each record saves `follow_id`, `followee_id`, `followed_at` and `unfollowed_at`.

In this way, Bob's attention history and current relationship are located in the same logical shard, and following and removing the relationship can update the fact record.

### Following

Following is also organized by Bob's `follower_id`, saving the current relationship:

| partition key | sort key | value |
|---|---|---|
| Bob | Alice | follow_id = F2 |

### Followers

Followers are organized according to Alice's `followee_id`:

| partition key | sort key | value |
|---|---|---|
| Alice | Bob | follow_id = F2 |

When Alice publishes a WRITE Post, the Coordinator reads Followers (Alice) in pages, obtains Bob and F2, and then writes FeedItem.

When the following and Followers updates fail, they are rebuilt from the valid records in the Follow Store. Two indexes cannot be allowed to decide who is correct.

## FeedItem

FeedItem is fragmented according to the `user_id` that the homepage belongs to. Bob's candidates should be located in the same logical shard as much as possible:

| Field | Example |
|---|---|
| user_id | Bob |
| post_id | post-123 |
| author_id | Alice |
| follow_id | F2 |
| rank_time | 10:00 |
| inserted_at | 10:02 |
| mode_version | 7 |

The home index is `(user_id, rank_time DESC, post_id DESC)` and the idempotent unique key is `(user_id, post_id)`.

This design accepts fan-out writes to multiple user shards in exchange for `GET /feed` typically reading only one FeedItem shard.

## Author Timeline

Author Timeline is divided into `author_id` slices and saved:

| author_id | rank_time | post_id | distribution_mode | mode_version |
|---|---|---|---|---|
| Alice | 10:00 | post-123 | READ | 7 |

It saves the IDs of all Posts, but the homepage pull path only selects READ Posts. Timeline can be rebuilt from Post Store.

## Logical bucket and physical machine

Do not use `hash(user_id) mod current_machine_count` directly. Changes in the number of machines can result in extensive data remapping.

First map to a fixed number of logical buckets, such as 4,096, and then the routing table determines which group of physical nodes each bucket is located on:

> user_id → bucket → shard group

When expanding the capacity, some buckets are migrated and routes are switched in stages. There is no need to move the entire database.

## Hotspot 1: Ordinary authors write FeedItem in batches

A WRITE Post might be written to a hundred thousand followers. Coordinator first groups by target FeedItem shards:

1. Determine the target shard based on each fan’s user_id.
2. Only one target shard is written in a batch.
3. Each shard has independent concurrency and rate caps.
4. The batches of slow shards are backed off individually without blocking other shards.

The previous distribution strategy is not changed here, only the pressure when fan-out falls on the storage is controlled.

## Hot Topic 2: Author Timeline of Celebrity Account

Celebrity Account uses READ mode, and a large number of fans will read the same Author Timeline Key.

Processing method:

- Cache the latest dozens of timeline items;
- Use Request Coalescing to avoid concurrent queries to the Authoritative Store when Cache Miss occurs;
- Use read-only replicas to share reads;
- Set the Authoritative Read concurrency limit for a single author_id.

## Hot Topic 3: Hot Style Post

A large number of homepages will read the same post_id. The Post text is copied in the local cache and distributed cache, and the Post Store is only accessed on a miss.

The deletion state uses independent visibility versions and tombstones to avoid long-term cache text from continuing to display deleted posts.

## Hotspot 4: Single user homepage

When the same user_id is refreshed frequently:

- Cache Feed Head;
- Limit traffic for users, devices and IPs;
- Merge identical concurrent requests;
- Use read-only copies of FeedItem.

Don't split a user's latest feed into multiple shards too early, otherwise the homepage will need to be merged across shards. Only when the history of a single user is indeed too large, the old data will be split by time bucket; the latest time bucket will remain a single shard.

## Noisy shard

Hashing makes the data volume roughly uniform, but the traffic is not necessarily uniform. A certain shard may happen to contain multiple active users.

Capacity, QPS, P99 latency, and hot keys must be monitored per shard. When overloaded, you can migrate buckets, expand replicas, cache hot keys, or limit traffic. You cannot just look at the global average.

## Sharding failure

Each shard group contains primary nodes and replicas. When a FeedItem fragment is not writable:

1. Other shards continue to work.
2. Failed batches stay in the queue and back off.
3. Not marking the entire Fan-out Job as complete.
4. After shard recovery, only the relevant batches will be replayed.
5. Perform Targeted Reconciliation (difference checking and repair) on the failure time window.

[Return to the eighth edition directory](README.md)
