# Caching, replicas and consistency

## What to cache

| Data | Key Example | TTL | Reason |
|---|---|---:|---|
| Current watch list | `following:{user_id}` | 1–5 minutes | Used for multiple homepage queries |
| Post text | `post:{post_id}` | 5–30 minutes | The same popular Post is read by multiple people |
| Home page first screen | `feed:first:{user_id}` | 10–30 seconds | Reduce repeated refresh pressure |

The first screen cache cannot set a very long TTL, otherwise the visibility delay for new posts, deleted posts, and unfollowed posts will be too large.

## Cache-aside

1. API first check Redis.
2. Query the read replica when there is a miss.
3. Backfill (historical data supplementation) Redis, and add TTL Jitter (random expiration offset).
4. Limit Database Fallback concurrency when Redis fails to prevent all requests from being pushed to the database at the same time.

## Copy delay

Post or Follow has been submitted in Primary, which does not mean that Read Replica is immediately visible. This version accepts short-lived Eventual Consistency and records Replication Lag:

- Latency within budget: read from replica normally.
- Latency exceeds budget: change to a healthy copy or use cache.
- Refresh immediately after the user has just finished following: You can carry short-term consistency tokens and return to the main database once if necessary.

## Delete and unblock posts

The Post and Following items in Redis are deleted after successful writing; the short TTL serves as the final Expiration Boundary. The feed still checks the deletion status of the Post and the Follow time boundary before returning. You cannot just trust the long-term cache.

The third version may still be affected by Read Replica Lag: when a write request first returns, the replica may briefly see the old state. In order to ensure Read-your-writes of the current Session, a short-term Consistency Token is returned in response to post deletion and disconnection; when the user subsequently reads the feed, the Primary is read before the Replica Catch Up reaches the Commit Position recorded in the Token, or the short-term Tombstone written by the Primary is used. Other users accept the second-level Eventual-consistency Window declared in this release.

If the product requires that "any observer must not see the old content at the moment of successful writing", the asynchronous copy and TTL cache of the third version are not enough to achieve it, and a stronger read or the version check of the eighth version is needed; the SLO must be clear, and you cannot verbally say "deleting the cache will take effect immediately".

The consistency mechanism of this version is relatively simple. Caching is for performance only; event-driven derived indexes start in version 4, and version caching and systematic reconciliation (difference checking and repair) are left until version 8.

[Return to the third edition directory](README.md)
