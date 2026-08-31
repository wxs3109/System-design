#05 Fan-out on Write: News Feed

> Targets approximately 10 million DAU. Inherit the verified Outbox and derived index of 04, add FeedItem, and switch the homepage from JOIN grayscale on read to fan-out on write.

## Reading order

1. [Why pre-generate feed](01-why-pre-generate-feeds.md)
2. [Data Model and FeedItem](02-data-model-and-feeditem.md)
3. [FeedItem Backfill (historical data supplement), Traffic Cutover (traffic switching) and reliability](03-feeditem-backfill-cutover-and-reliability.md)
4. [Home page reading and attention life cycle](./04-home-page-reading-and-attention-semantics.md)
5. [Bottleneck and Upgrade Signal](05-bottlenecks-and-upgrade-signals.md)

## What is only added in this version?

- Added FeedItem to save homepage candidate Post IDs by user.
- Reuse Post Outbox, PostEvents and Followers Index from 04.
- Added Fan-out Job, FanoutBatch Queue and Worker.
- Follow migrates from "current row + created_at" to explicit `follow_id` lifecycle.
- The homepage gets the ID from FeedItem and then reads the Post text in batches.

## This version intentionally does not add anything.

- All authors use WRITE and do not do Celebrity Account's READ mode.
- No two-way merge of Author Timeline and FeedItem.
- Complex mode switching, global sharding scheme and version caching will not be carried out for the time being.
- Global sharding, cached versions, and full recovery platforms will not be implemented; these will be left until 07–08.

## One sentence design

Posts and Outboxes are saved simultaneously, the author's Followers are read in the background, and FeedItems are written idempotently for each fan; reading the home page therefore becomes a single-user partition query.

[Return to News Feed evolution path](../README.md)
