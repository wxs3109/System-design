#Celebrity Account judgment and mode switching

## Two modes

| Pattern | Meaning |
|---|---|
| `WRITE` | Ordinary author; write FeedItem for fans asynchronously after Post is created |
| `READ` | Celebrity Account; do not write large-scale FeedItem, get it from Author Timeline when reading the home page |

The judgment is not just based on the number of fixed fans, but whether the expected distribution cost exceeds the budget. Key inputs include number of followers, frequency of posting, proportion of active followers, current queue backlog, and FeedItem write capacity.

Use different thresholds for entering and exiting READ mode to avoid frequent switching of critical points; this strategy is called Hysteresis.

## The pattern belongs to Post, not just to the author

The author has the current mode, but when each Post is created, the current mode must be copied to the Post:

| Field | Example |
|---|---|
| `distribution_mode` | `WRITE` or `READ` |
| `mode_version` | Author mode version, e.g. 7 |

The Worker reads the schema on the Post when retrying, and cannot reread the author's current schema.

Otherwise, it will appear: the author is WRITE when the post is published, and the author has changed to READ when retrying. Some fans of the same post receive FeedItem, while other parts rely on reading.

## Pattern History

Each mode change by the author is saved as a time interval:

| author_id | mode_version | mode | effective_at | ended_at |
|---|---:|---|---|---|
| Alice | 6 | WRITE | 09:00 | 12:00 |
| Alice | 7 | READ | 12:00 | null |

Post records its own `mode_version`, so historical semantics do not change with the author's current state.

## WRITE switches to READ

Suppose Alice changes from WRITE to READ at 12:00:

- The WRITE Post before 12:00 already has FeedItem, continue reading from FeedItem.
- New Posts after 12:00 are marked as READ, and only Post and Author Timeline are written.
- The homepage reads the READ Post after 12:00 from Alice's Author Timeline.
- The two types of sources are deduplicated based on post_id.

There is no need to delete old FeedItems or backfill historical posts.

## READ switches to WRITE

Suppose Alice changes from READ back to WRITE at 18:00:

- New Posts after 18:00 regenerate FeedItems.
- READ Posts that are still within the feed retention window before 18:00 will continue to be obtained from the Author Timeline.
- Alice cannot be completely removed from the user's pull source list until these historical READ Posts exceed the feed retention window.

Therefore, the homepage cannot only look at the author's "current mode". It needs to find the READ interval that intersects the current feed time window based on the pattern history.

## Why not backfill massively on switch?

When READ is switched to WRITE, if you backfill historical READ Post to all fans immediately, another huge fan-out will occur.

A more reliable solution is:

- New Post uses the new mode immediately;
- Historical Posts maintain the mode they were in when they were published;
- The read path is compatible with both sources within a limited retention window;
- End the transition naturally after exceeding the window.

## Determination indicators

- Estimated number of FeedItems per Post;
- Author's number of posts per minute;
- Ratio of active fans;
- Queue backlog age;
- Write capacity of each FeedItem shard;
- READ mode brings additional Read Amplification to the home page.

Mode switching is an internal strategy and does not change the external API.

[Return to the eighth edition directory](README.md)
