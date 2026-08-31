# Caching and invalidation

## in principle

Cache is a performance copy, not a Source of Truth. When the Cache is lost, it can be reconstructed from the persistent data; when the Cache conflicts with the facts, the Post Store and Follow Store shall prevail.

This version caches five types of data:

| cache | key example | value |
|---|---|---|
| Post | `post:123` | Text, deletion status, post_version |
| Feed Head | `feed:Bob:head` | Recent post_id, rank_time, feed_version |
| Author Timeline | `author:Alice:timeline` | Recent timeline item, timeline_version |
| Following | `following:Bob` | author_id、follow_id、followed_at、follow_version |
| Author Mode | `mode:Alice` | Current mode, mode history window, mode_version |

Feed Head and Author Timeline only cache the ID and sorting metadata, and the Post text is cached separately to avoid duplicating the text in each user's homepage.

## Why TTL is not enough

Assume the Feed Head TTL is 5 minutes, but the Freshness (data visibility latency) SLO requires 99% of regular author posts to be visible within 10 seconds.

If the FeedItem is persisted and cache updates and deletions fail, Bob may continue to read 5 minutes old data. TTL alone cannot meet the 10-second goal.

Therefore caches need to be proactively invalidated and use versions or watermarks to detect stale data.

## Feed version

Each user maintains a monotonically increasing `feed_version`:

1. The FeedItem batch successfully writes Bob’s data.
2. Persistently update Bob’s feed_version.
3. Publish the FeedChanged(Bob, version) event through Outbox.
4. The cache consumer deletes the old key or writes the new version to the cache.

Feed Head value brings its own version. When reading, if the cached version is smaller than the currently visible feed_version, the cache is considered a miss and rebuilt from the FeedItem Store.

To avoid querying the version database for every request, version events can be synchronized to a small, highly available Version Cache. When the Version Cache is uncertain or lagging behind, the system should query the Authoritative Version Store instead of blindly trusting the old Feed Head.

## Post cache

Post cache save:

| Field | Example |
|---|---|
| post_id | post-123 |
| author_id | Alice |
| body | Hello |
| rank_time | 10:00 |
| deleted_at | null |
| post_version | 4 |

To read, use cache-aside: check the cache first, and load from the Post Store if there is a miss.

The cache can be warmed up after a new Post is submitted, but a cache write failure cannot cause the post to fail because the Post has been persisted.

## Feed Head Cache

You can use Redis Sorted Set or ordered list:

- member：post_id；
- score：rank_time；
- Metadata: feed_version.

Only the most recent 200 to 1,000 candidates are retained. Older FeedItems are still in persistent storage.

A fixed "page 1, page 2" response cannot be cached because the new Post changes all page boundaries. After caching the ordered ID header, the service still selects the range based on the cursor.

## Author Timeline Cache

Author Timeline persists for all Posts, but the homepage pull only reads READ Posts.

The cache entries include post_id, rank_time, distribution_mode and mode_version, and carry `timeline_version`.

After Timeline Worker writes to the persistent index, it publishes TimelineChanged through Outbox. The cached version must be rebuilt if it is lower than the latest timeline_version.

## Following Caching

Following cache can't just save author_id, but also:

- follow_id；
- followed_at；
- follow_version。

To follow or unfollow, submit the Follow facts and Outbox first, and then update the Following index and version. Read the Authoritative Store when the cached version is lagging behind.

This ensures that when Bob unfollows Alice and follows Alice again, the FeedItem corresponding to the old follow_id will not reappear due to cache staleness.

## Author Mode Cache

Based on Bob's Following list, the Feed Query Service reads in batches the pattern history of the authors of interest within the Feed retention window, and determines which Author Timelines need to participate in the pull.

Schema data is cached by author_id alone:

- key：`mode:Alice`；
- value: current mode, READ interval intersecting the feed window, mode_version.

Author mode cannot be copied into each fan's Following cache. Otherwise, when Alice switches modes, millions of fan caches need to be invalidated, causing another huge fan-out.

AuthorModeChanged only updates Alice's own mode key. All fans share this cache the next time they read it.

## What cache changes occur when new posts are made?

### WRITE Post

1. Post and Outbox submission.
2. Timeline Worker updates Author Timeline and timeline_version.
3. Fan-out Worker writes FeedItem.
4. The feed_version of each target user is updated.
5. The FeedChanged event invalidates the corresponding Feed Head.

### READ Post

1. Post and Outbox submission.
2. Timeline Worker updates Author Timeline and timeline_version.
3. Invalid Author Timeline cache.
4. Do not modify the feed heads of fans one by one.

When fans read it, they know through Following that they need to pull Alice, and then get the Post from the new version of Author Timeline.

## Delete post

After Alice deletes post-123:

1. Post Store soft delete and increment post_version.
2. The PostDeleted Outbox event invalidates the Post cache.
3. Cache stores DELETED Tombstone for a short period of time to prevent non-existent objects from being repeatedly checked into the Post Store.
4. Old IDs in Timeline and Feed Head can be cleaned up asynchronously.
5. Always filter deleted Post when assembling the home page.

Delete post_id synchronously without scanning millions of fan caches. The 5 second invisible SLO is guaranteed by a combination of Post facts, version expiration, and read-time filtering, not by physical cleanup.

## Unlock

After Bob unblocks Alice:

1. Follow Store ends the current follow_id and increments follow_version.
2. FollowEnded event updates Following, Followers and Version Cache.
3. following:Bob and feed:Bob:head are invalid.
4. The read path only accepts the currently valid follow_id.
5. Background cleaning of old FeedItem.

A version mismatch triggers an Authoritative Read when cache events are temporarily delayed. The system cannot continue to display cached results when it knows that the version is out of date.

## TTL

Active invalidation and version checking take care of freshness, and TTL is the last resort in case of omissions. TTL plus Jitter (random jitter) to prevent a large number of keys from expiring at the same time.

| Caching | Example TTL |
|---|---|
| Post | Minutes to hours |
| DELETED tombstone | tens of seconds to minutes |
| Feed Head | Minutes |
| Author Timeline | Tens of seconds to minutes |
| Following | A few minutes |
| Author Mode | Tens of seconds to several minutes |

## Three Cache Failure Patterns

- Hot-key Cache Stampede: Use Singleflight to merge concurrent Cache Fill when the Hot Key expires.
- Repeated Miss for Missing Key: Non-existing or deleted Post uses short TTL Negative Cache.
- Cold-cache Overload: TTL plus Jitter, and limit the concurrent amount of database access when Cache fails.

## Cache failure recovery

- Feed Head rebuilt from FeedItem Store.
- The Author Timeline cache is rebuilt from the persistent Timeline.
- The Following cache is rebuilt from the Following index and verified with Follow Store if necessary.
- Post cache is rebuilt from Post Store.
- Use batched warm-up (divided into multiple batches to warm up) to process hot keys, and all application instances cannot load data from the authoritative store at the same time.

## Key indicators

- Each cache hit rate and Database Fallback QPS;
- Number of times the cached version lags behind;
- FeedChanged, TimelineChanged, FollowChanged event age;
- Hot key QPS;
- Number of failure failures and rebuild failures;
- Database P99 latency on cache failure.

## Finally, remember only four sentences

1. **The cache only saves a copy**, the fact remains in the Post and Follow Store.
2. **Feed cache only stores the ID**, and the text is cached separately.
3. **Active invalidation plus version checking meets Freshness**, and TTL only defines the final Expiration Boundary.
4. **Change the fact visibility before deleting posts and unlinking them**, and the old ID will be cleared asynchronously.

[Return to the eighth edition directory](README.md)
