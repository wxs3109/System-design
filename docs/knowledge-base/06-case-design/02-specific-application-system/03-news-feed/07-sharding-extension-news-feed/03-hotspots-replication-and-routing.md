# Hotspots, replication and routing

## Virtual bucket

The client does not know the physical shard directly. The logical key is first mapped to a large number of virtual buckets, and then the shard map points to the physical shard:

```text
logical key → virtual bucket → physical shard group
```

Move some buckets when expanding to avoid re-hashing all data.

## Hotspot type

### Hot Post

A large number of homepages read the same post_id. Post text uses local cache, Redis, and read-only replicas; the Post Store is accessed only on cache misses.

### Hot Followers

Followers of Celebrity Account are split by Bucket. However, 06 has made its new Post use READ, and usually no longer scans all fans for Fan-out.

### Hot Author Timeline

Celebrity Account’s Timeline is read on a large number of front pages. Use Cache, Read Replica, and Request Coalescing, but authoritative ordering still comes from the persistent Timeline.

### Hot FeedItem Users

The FeedItem partition of a small number of high-profile users is more read- and write-heavy. Use time bucket, read replica and head cache; they cannot be easily separated by random salt, otherwise the home page will have to be fully fan-in every time.

## Copy

Each shard group has master nodes and replicas. Replicas are used for high availability and read scaling, but replication latency must be factored into feed freshness (data visibility latency) monitoring.

## Routing failed

Shard Router caches shard map with version number. Refresh map after receiving MOVED / stale-route; cannot retry old shards indefinitely. Use the last known persistent map in the event of a control plane failure to avoid random routing.

[Return to the seventh edition directory](README.md)
