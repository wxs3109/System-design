# Mixed reading and paging

## Two candidates

`GET /feed` parallel acquisition:

1. FeedItem: all WRITE Post;
2. Author Timeline: Currently focusing on the author’s Posts in the relevant READ interval.

Both paths use the same sort key `(rank_time, post_id)`, then merge, dedupe, and fact filtering.

## Why do we need to remove duplicates?

Normally Posts come from only one source, but deployment, mode switching, Backfill (historical data supplementation) and retries may overlap briefly. Deduplication by post_id prevents the same Post from being displayed twice.

## Cursor

First page fixed `snapshot_time`. Each page candidate needs to meet:

```text
rank_time <= snapshot_time
(rank_time, post_id) < (last_rank_time, last_post_id)
```

Cursor contains at least snapshot_time, last_rank_time, last_post_id and signature. The two reads share the same boundary and cannot each maintain a client cursor.

## Fact filtering

- Post must not be deleted;
- The follow_id of FeedItem must still be the current valid period;
- READ Post must satisfy `rank_time >= followed_at`;
- Continue overscan when there are less than 20 filtered items.

## Read Amplification Boundary

Feed Query should not read all READ authors serially one by one. It must be read in batches or in parallel, and the number of authors participating in a pull request must be limited; when the budget is exceeded, it is downgraded to a smaller candidate window instead of bringing down the entire service.

[Return to the sixth edition directory](README.md)
