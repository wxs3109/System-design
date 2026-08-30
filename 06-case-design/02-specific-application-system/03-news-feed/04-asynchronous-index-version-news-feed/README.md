# 04 Asynchronous index version: News Feed

> Function unchanged from 01–03. In this version, we first learn about reliable events and rebuildable derived indexes, without changing the online feed reading path.

## Reading order

1. [Why build the index first and not cut the feed immediately](01-why-build-the-index-first-and-not-cut-the-feed-immediately.md)
2. [Outbox, events and derived indexes](02-outbox-events-and-derived-indexes.md)
3. [Backfill (historical data supplementation), Shadow Validation (bypass verification) and faults] (03-Backfill shadow verification and faults.md)
4. [Signal entering Fan-out on Write (distributed when writing)](04-signal-entering-fan-out-on-write-distributed-when-writing.md)

## Inheritance 03

- Post and Follow are still relational database facts.
- `GET /feed` still uses version 3 of Redis + Read Replica JOIN.
- Replica latency, cache failure and database protection strategies remain unchanged.

## This version only adds

- Post Outbox and Follow Outbox;
- PostEvents and FollowEvents;
- Author Timeline index;
- Following and Followers derived indexes;
- Worker idempotence, DLQ, Backfill and Shadow Validation.

## Why one level alone?

Jumping directly from database JOIN to FeedItem will change the event reliability, data model and online reading path at the same time. If there is a problem, it is impossible to determine which layer it is. 04 First let the asynchronous data pipeline run stably in the background, but do not accept user traffic.

[Return to evolution route](../README.md)
