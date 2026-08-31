# Author Timeline and pattern solidification

## Author Timeline

04 Author Timeline has been created in the background. 06 Start letting it take on the online reading of READ Post:

| Partition key | Sort key | Value |
|---|---|---|
| `author_id` | `rank_time DESC, post_id DESC` | distribution_mode、mode_version |

All Posts are written to Timeline, but Feed pull only selects Posts of `distribution_mode = READ`.

## Why is the mode solidified to Post?

The author is currently in READ, which does not mean that all historical Posts should be changed to READ. Save when Post is created:

- `distribution_mode`；
- `mode_version`；
- `rank_time`。

When the Worker retries, it reads the fixed value on the Post and cannot re-read the author's current mode. Otherwise, one retry may cause part of the same Post to be fan-out and part to be pulled.

## Pattern History

Feed Query reads the pattern intervals of relevant authors within the feed time window in batches based on the user's Following list. Timeline is only accessed for authors with READ intervals.

Mode history is saved by author_id and cannot be copied into each fan's Following record, otherwise mode switching will create another huge fan-out.

## Mode switching

- WRITE → READ: The new Post after switching is marked READ; the old WRITE Post continues to read from FeedItem.
- READ → WRITE: The new Post after switching is marked WRITE; the old READ Post continues to read from the Timeline.
- No longer Backfill (historical data supplement) historical Posts when switching.

[Return to the sixth edition directory](README.md)
