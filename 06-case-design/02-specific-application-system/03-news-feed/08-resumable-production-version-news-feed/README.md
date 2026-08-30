# 08 Resumable production version: News Feed

> Inherit 07's sharded hybrid feed. This version does not change product functions or feed algorithms, but only completes the cached version, Reconciliation (difference checking and repair), Replay (replay), observability and cross-region disaster recovery, so that the system can be discovered, stopped bleeding and restored.

## Reading order

1. [Version Positioning and Invariants](01-version-positioning-and-invariants.md)
2. [Capacity Estimation and SLO](02-capacity-estimation-and-slo.md)
3. [Role, component and data list](03-list-of-roles-components-and-data.md)
4. [Home page reading and FeedItem](04-home-page-reading-and-feeditem.md)
5. [Celebrity Account Judgment and Mode Switching](05-celebrity-account-judgment-and-mode-switching.md)
6. [Mixed distribution and paging](06-mix-distribution-and-paging.md)
7. [Deletion of posts and consistency](07-post-deletion-and-consistency.md)
8. [Focus on life cycle](08-pay-attention-to-the-life-cycle.md)
9. [Write Reliability](09-write-reliability.md)
10. [Fragmentation and Hotspots](10-sharding-and-hotspots.md)
11. [Caching and Invalidation](11-caching-and-invalidation.md)
12. [Observability and Recovery](12-observability-and-recovery.md)
13. [Migration, disaster preparedness and acceptance from 07 to 08](./13-migration-disaster-recovery-and-acceptance-from-07-to-08.md)

## New capabilities from 07

- Introduced persistent versions and Cache Versions for FeedItem, Timeline, Following and Post.
- Systematically monitor Outbox age, Queue lag, batch progress and derived data differences.
- Known failures are fixed via Retry/DLQ Rate-limited Replay, silent misses are fixed via Reconciliation.
- Clarify the recovery sequence of shards, Redis, Queue, fact database and region failures.
- Define RPO, RTO, backup, recovery drills and upgrade acceptance criteria.

06's hybrid distribution and 07's sharding designs remain in this catalog as full production references, but they were not first introduced in 08.

[Return to case design directory](../../README.md)

[Return to News Feed evolution path](../README.md)

[Enter 09 Rich Media and Interactive Edition](../09-rich-media-and-interactive-version-news-feed/README.md)
