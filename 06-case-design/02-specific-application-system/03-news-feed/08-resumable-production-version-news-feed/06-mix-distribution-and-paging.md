# Mix distribution and paging

## Two types of sources

| Patterns of Post | Home Page Candidate Sources |
|---|---|
| `WRITE` | Pre-written FeedItem |
| `READ` | Author's Author Timeline |

The homepage only selects the source based on the `distribution_mode` solidified by each Post, and does not reinterpret historical posts based on the author's current mode.

## Reading process

Take Bob as an example:

1. Read Bob’s FeedItem and obtain the WRITE Post candidate.
2. Read the author Bob is currently following and the `followed_at` he follows each time.
3. Find the authors in the READ mode interval within the feed retention window.
4. Read READ Post candidates from these authors' Author Timelines.
5. Press `(rank_time, post_id)` to do k-way merge.
6. Press post_id to remove duplicates.
7. Read the Post and Follow facts and filter candidates that have been deleted or do not belong to the current focus period.
8. Return to the top 20 items.

Author Timeline saves all Post IDs, but this read path only accepts `distribution_mode = READ` Posts. FeedItem only corresponds to WRITE Post.

## Why do we still need to re-do it?

Normally, a Post comes from only one source. However, deployment, Replay (replay), mode switching and historical data repair may cause short overlap. Deduplication by post_id is a cheap defense to avoid users seeing it twice.

## Stable sort key

Both types of sources are used uniformly:

> (rank_time, post_id)

`rank_time` is the Post publishing time, not the actual writing time of FeedItem. `post_id` is used to break ties at the same time.

## First request

The first time `GET /feed` records `snapshot_time` on the server. Candidate Post must satisfy:

> rank_time <= snapshot_time

When returning 20 items, cursor encoding:

| Field | Meaning |
|---|---|
| `snapshot_time` | The latest time allowed to be seen in this browsing session |
| `last_rank_time` | Sorting time of the last item on the previous page |
| `last_post_id` | The post_id of the last post on the previous page |

The Cursor is opaque to the client and should be signed to prevent tampering.

## Next page request

Both FeedItem and Author Timeline sources apply the same boundaries:

- `rank_time <= snapshot_time`；
- The sort key is strictly less than `(last_rank_time, last_post_id)`.

The two types of results are combined again to get the next page.

New Posts generated during browsing are not inserted into the next page, but appear when the user refreshes the feed and creates a new snapshot.

## Whether deletion and unblocking are also frozen

Does not freeze.

`snapshot_time` only stabilizes the post sorting range. Deletion and removal are visibility rules, and each page is rechecked based on the current facts:

- Post has been deleted. Even if it still exists on the first page, it cannot be displayed on the next page.
- Bob has unblocked Alice, and Alice's candidates are immediately filtered.
- Bob follows Alice again and only accepts Posts after the new `follow_id` and the new `followed_at`.

This choice may reduce a few items in a round of pagination or skip expired content, but it will not continue to display content that has been deleted or closed by the user for the sake of stable pagination.

## What to do when there are not enough candidates

Deletion, unblocking, and expired attention cycles will filter out some candidates. So you can't just read exactly 20 IDs.

You can take a small batch of each of the two sources at a time, for example 50, after filtering and merging:

- Return if 20 items are enough;
- If there is insufficient, continue to take a batch from the source that has not been exhausted;
- When the internal scan limit is reached and still insufficient, return to a shorter page and record the metrics.

A sudden increase in scan magnification usually indicates a problem with deletion cleaning, off cleaning, or derived data quality.

[Return to the eighth edition directory](README.md)
