# Time, Ordering and Unique ID

A distributed system does not have a perfect clock that all machines can see instantaneously, nor does it have a natural global order of events. This topic addresses:

```text
When does it happen?
Which happens first?
Do both requests mean the same thing?
How to stabilize paging without leakage or duplication?
```

## When to consider

- Display News Feed, messages or audit logs by time;
- Use Lease, TTL, Cache Expiration and Deadline;
- Messages may arrive out of order, duplicated or delayed;
- Multiple Regions accept writes and need to resolve conflicts;
- ID needs to be shard-friendly, trend increasing or unpredictable;
- Use Cursor Pagination to traverse changing data sets.

## Learning sequence

1. [Wall Clock, Monotonic Clock and Clock Skew](01-wall-clock-monotonic-clock-and-clock-skew.md)
2. [Event Ordering and Logical Clock](02-event-ordering-and-logical-clock.md)
3. [Distributed unique ID](03-distributed-unique-id.md)
4. [Stable Ordering and Cursor Pagination](04-stable-ordering-and-cursor-pagination.md)

## Fast Principle

- Wall Clock can be used for user display time; Monotonic Clock should be used first for calculation timeout.
- The same timestamp does not mean that the event is the same, and a larger timestamp does not necessarily mean that it is causally later.
- Only build orders within the scope required: single-entity, single-partition or single-session orders are usually sufficient.
- The sort key must be unique, such as `(rank_time, post_id)`, otherwise the paging boundaries will be unstable.
- ID randomness, ordering, length, information leakage and shard distribution need to be weighed together.

## Case mapping

- [News Feed home page read] (../../06-Case design/02-Specific application system/03-news-feed/08-Recoverable production version/04-Home page read and FeedItem.md): `rank_time + post_id` stable sorting.
- [News Feed Write Reliability](../../06-case-design/02-specific-application-system/03-news-feed/08-resumable-production-version-news-feed/09-write-reliability.md): Event duplication, latency and idempotent identity.
- [Multi-tenant Platform Operation](../../06-case-design/03-platform-system/01-multi-tenant-data-platform/01-system-design-mainline/08-from-item-to-operation-define-how-to-become-a-run.md): Operation, Attempt, Lease and fencing token.
- [Short Link System] (../../06-Case Design/02-Specific Application System/01-url-shortener/README.md): Collision, enumeration and fragmentation issues with short IDs.
