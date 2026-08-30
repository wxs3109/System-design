#06 Hybrid Distribution: News Feed

> Function unchanged from 01–05. This version only solves the Fan-out Write Amplification caused by Celebrity Account; the global sharding and complete recovery system will not be introduced for the time being.

## Reading order

1. [Why unified WRITE fails](01-why-unified-write-fails.md)
2. [Author Timeline and Pattern Solidification](02-author-timeline-and-pattern-solidification.md)
3. [Mixed reading and paging](03-mixed-reading-and-paging.md)
4. [Migration, switching and failure from 05 to 06] (04-Migration, switching and failure.md)
5. [Signal entering shard expansion](05-signal-for-entering-shard-expansion.md)

## Inheritance 05

- Post/Follow is the fact and FeedItem is the derived index.
- Outbox, Topic, Worker, DLQ and `follow_id` remain unchanged.
- Regular authors continue to use fan-out on write.

## This version only adds

- Author Timeline enters the online reading path;
- Author `WRITE / READ` Distribution mode and mode_version;
- Distribution_mode is fixed when Post is created;
- Two-way merge/dedupe of FeedItem and Author Timeline;
- Hysteresis and migration verification for mode switching.

## No additions will be made to this version

- Do not split all fact databases into distributed SQL at once;
- No complete virtual shard routing and cross-shard migration;
- No persistent cache version system and Full Reconciliation (difference checking and repair) platform;
- Does not add Likes or any product features.

[Return to evolution route](../README.md)
