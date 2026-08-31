# 07 Sharding extension: News Feed

> Functionality and feed algorithm are the same as 06. This version only shards fact data, derived indexes and tasks according to stable keys to solve capacity, throughput and hot spots.

## Reading order

1. [Why sharding now](01-why-sharding-now.md)
2. [How to fragment various types of data](./02-how-to-fragment-various-types-of-data.md)
3. [Hotspot, Replication and Routing](03-hotspots-replication-and-routing.md)
4. [Online Migration and Consistency Verification](./04-online-migration-and-consistency-verification.md)
5. [Fragmentation failure and upgrade signal](05-sharding-failure-and-upgrade-signals.md)

## Inheritance 06

- Regular authors use WRITE, Celebrity Account uses READ.
- Two-way merge of FeedItem and Author Timeline.
- Post and Follow are true and all indexes can be rebuilt.
- External APIs and product functionality remain unchanged.

## This version only adds

- Shard Router, virtual bucket and shard map;
- The partition key of each Store;
- Shard copy, hotspot detection, bucket migration and rate limiting;
- Fan-out batch is split by target FeedItem shards.

## No additions will be made to this version

- No new product features will be added;
- Do not mix cached versions, full-link Reconciliation (difference checking and repair), DLQ operation and maintenance, and disaster recovery into the sharding design;
- These production restoration capabilities were completed in 08.

[Return to evolution route](../README.md)
