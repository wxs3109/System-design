# 03 Read the extended version: News Feed

> Targets approximately 1 million DAU. Inherits the synchronous Standby, Backup and Failover of 02, and adds independent Read Replica, Cache and Query Governance.

## Reading order

1. [Why expand your reading first](01-why-expand-reading-after-the-data-is-reliable.md)
2. [Architecture and Request Link](02-architecture-and-request-link.md)
3. [Cache, Copy and Consistency](03-caching-replicas-and-consistency.md)
4. [Bottleneck and upgrade signals](04-bottlenecks-and-upgrade-signals.md)
5. [Migration, Failure and Rollback](05-migration-failure-and-rollback-from-02-to-03.md)

## What is only added in this version?

- Route feed query traffic to database read replicas.
- The API remains stateless and accesses the database through a connection pool.
- Redis caches Following list, Post text and short TTL home page above the fold.
- The home page continues to use keyset pagination and does not use large OFFSET.
- Use copy latency, cache hit rate and feed query latency to determine the expansion effect.

## This version intentionally does not add anything.

- FeedItem is not created.
- Do not use message queue and background distribution Worker.
- Don't fan-out on write.
- Do not split Post and Follow databases.
- No discussion of Celebrity Account's Hybrid Fan-out.
- No changes to product features in 01–08 Evolution Contract.

## One sentence design

Write requests still enter the main database; read requests on the home page preferentially use Redis and read-only replicas to execute the first version of the query. This version reduces the pressure on the main library, but does not change the essence of "on-site calculation every time you open the homepage".

[Return to News Feed evolution path](../README.md)
