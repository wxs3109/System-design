# Migration, failure and rollback from 02 to 03

## Read Replica is online

1. Create a new Read Replica from the Primary consistency snapshot.
2. Let Read Replica catch up to the target WAL position and monitor replay lag and apply error.
3. Use production query Shadow Read (bypass read), which only compares the results and does not return them to the user.
4. Migrate low-risk read-only requests first, and then migrate a small amount of `GET /feed`.
5. Compare the results of Primary and Replica, Freshness (data visibility delay) and P99.
6. Expand the flow while retaining the restricted switch back to the Primary.

02's synchronous Standby continues to protect writes exclusively. Read Replica can replicate asynchronously and scale out because it only handles read traffic that can be rolled back.

## Redis is online

Caching does not require historical data migration, use cache-aside lazy loading:

1. First verify the key format with 0% read, normal write or Shadow Read.
2. Enable cache read for a small proportion of users.
3. Observe the hit rate, Stale Rate, Database Fallback QPS and Key Size.
4. Gradually expand and limit the database concurrency of cache misses.

## Add new fault

| Failure | User Impact | Processing |
|---|---|---|
| Replica lag | New Post or Follow cannot be seen temporarily | Delay threshold, change replica, read-your-write back to Primary |
| Redis returns to the old home screen | Deleting posts/removing posts that are temporarily stale | Invalidation after writing, short TTL, fact filtering before returning |
| Redis all failed | Database Fallback traffic sudden increase | Request Coalescing, concurrency limit, downgrade |
| Replica is fully hung | Feed is unreadable | Fresh cache priority; restricted return to Primary |

## rollback

- Turn off cache read, and the remaining keys in Redis will not affect the fact data;
- Return the feed read route to Primary, but must limit current to protect writes;
- Keep the Read Replica until it catches up to the target WAL position of the Primary; perform Shadow Validation (bypass verification) again after repair;
- Any rollback does not change the Post or Follow facts.

[Return to the third edition directory](README.md)
