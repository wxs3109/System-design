# Migration, switching and failure from 05 to 06

## Migration steps

1. Confirm that the Author Timeline of 04 has overwritten the historical Post.
2. Default `distribution_mode = WRITE` and initial mode_version for historical Post Backfill (historical data supplement); update the corresponding entries of the Author Timeline at the same time, and cannot only change the Post Store.
3. Launch Mode Store, but all authors initially maintain WRITE, and verify the version relationship between Post, Timeline and Mode Store.
4. Feed Query Shadow Read Timeline, compare the mixed results with the original FeedItem results.
5. Select the internal test author to enter READ and continue Shadow Validation (bypass verification).
6. Gradually enable online hybrid reading according to the author whitelist.
7. Observe read latency, duplication rate, short page rate and missed post sampling post-expansion.

## rollback

When an author's READ path is abnormal, the new Post can be restored to use WRITE mode. Published READ Posts still need to be read through the Timeline, and the entire hybrid reading logic cannot be turned off directly; if necessary, first rewrite the FeedItem for the affected Post, and then remove the author from the READ path.

## Add new fault

| Failure | Impact | Processing |
|---|---|---|
| Mode Store is unavailable | Post does not know which mode to use | It can be used temporarily when there is a recent version-verified durable mode; otherwise the post returns 503 and cannot be randomly selected |
| Timeline Missing Write | READ Post missing | Post→Timeline Reconciliation (difference checking and repair), before Traffic Cutover (traffic switching) Shadow Validation |
| Mode event delay | Query does not know READ interval | Read Authoritative Mode Store and use short TTL cache |
| Two paths overlap | Duplicate Post | post_id deduplication |
| Too many READ authors | Home Read Amplification | Batch, concurrency limit, candidate budget |

## Data does not lose boundaries

Post facts remain guaranteed by Post Store. Timeline loss can be rebuilt, but will cause the READ Post to be temporarily invisible until repaired, so Timeline Freshness (data visibility delay) and differences must be monitored.

[Return to the sixth edition directory](README.md)
