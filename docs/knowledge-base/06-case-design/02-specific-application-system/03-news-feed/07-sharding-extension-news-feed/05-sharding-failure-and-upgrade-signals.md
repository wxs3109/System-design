# Sharding failure and upgrade signals

## Sharding failure

When a FeedItem fragment is not writable:

1. Only suspend batches sent to this shard;
2. The failed task remains in the Queue and retreats;
3. Other shards continue to be processed;
4. The shard group completes master-slave switching;
5. Replay the shard time window after recovery.

Fact shard failures are more strict than derived shards. Post/Follow writes cannot be silently discarded, nor can multi-master writes be performed when the master node is not known.

## Add new risk

- Outdated routing version leads to incorrect sharding;
- Missing increments during bucket migration;
- Cross-shard fan-out is partially successful;
- Hotspot averages are masked by global indicators;
- Single shard backup or replica is lagging behind.

## Signal to enter 08

Sharding allows capacity to be scaled, but with more system components, Silent Missing Writes, cache staleness, DLQ backlogs, and disaster recovery are all more difficult.

The conditions for entering 08 are systematic answers:

- How to find missing FeedItem or Timeline;
- How to ensure that the cached version does not go backwards;
- How to Rate-limited Replay and Reconciliation (difference checking and repair);
- How to define cross-region RPO/RTO;
- How to recover from shard, Queue or Redis failures.

[Enter 08 Restorable Production Version](../08-resumable-production-version-news-feed/README.md)

[Return to the seventh edition directory](README.md)
