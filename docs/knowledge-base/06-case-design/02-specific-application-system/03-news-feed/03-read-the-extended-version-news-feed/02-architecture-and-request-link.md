# Architecture and request link

## Small architecture diagram

[Open editable Draw.io diagram](assets/news-feed-read-scale.drawio)

## Write path

Posting, following, and unfollowing are still written to Primary simultaneously, and the second version of synchronous replication confirmation is still used:

```text
Client → API Gateway → News Feed API → PostgreSQL Primary
```

The transaction returns after reaching the persistence confirmation boundary of the second version. This version does not have a business queue, nor does it wait for the background to generate a feed.

## Home page reading path

```text
Client → API Gateway → Feed Query API
├─ Redis: Following / Post / First screen cache
                         └─ PostgreSQL Read Replica：Follow JOIN Post
```

Basic steps:

1. Query the short TTL first screen cache.
2. When there is a miss, the first version of Feed SQL is executed on the read replica.
3. Batch reading or Backfill (historical data supplementation) Post text caching.
4. Press `(created_at, post_id)` to generate the next page cursor.
5. The first page of results is cached with a short TTL, subsequent pages are generally not cached.

## Why still keep JOIN?

The purpose of this release is to isolate and scale read workloads, not to change the data model. As long as the read replica can still complete queries within the SLO, retaining the JOIN avoids prematurely introducing the consistency cost of the derived feed.

## Read replica is unavailable

- Feed Query API switches to healthy replicas.
- When all replicas are unavailable, return acceptable fresh caches first.
- Strict flow limitation is required when returning to the main database to protect writing transactions such as posting and following.

Read Replica is for performance, allowing a short delay; synchronous Standby of 02 is for data security. The two roles cannot be mixed into one copy without a clear RPO to reduce costs.

[Return to the third edition directory](README.md)
