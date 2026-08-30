# Home page reading and FeedItem

## Why is reading the extended version still slow?

The third version still needs to query Follow every time it reads the homepage, and then connects the Posts of multiple authors. As users and following relationships grow, candidate authors, the number of Posts, and cross-shard reads will all increase.

Version 5 began pre-generating FeedItems, moving most calculations from the synchronous read path to the asynchronous write path. This version retains the FeedItem of ordinary authors and adds an Author Timeline pull path for Celebrity Account.

## What is FeedItem?

A FeedItem means:

> In a certain effective attention cycle, this Post should become a candidate for this user's homepage.

| Field | Description |
|---|---|
| `user_id` | The user who owns the home page is also the sharding key |
| `post_id` | Post ID |
| `author_id` | Author ID for easy filtering and cleaning |
| `follow_id` | Corresponding attention period when generating this record |
| `rank_time` | Post publishing time, used for feed sorting |
| `inserted_at` | The time when the Worker actually writes the FeedItem |
| `mode_version` | The author distribution mode version the Post was created with |

The only key is `(user_id, post_id)`. No matter how many times the same post is retried by the same user, at most one will be retained.

## Why does it take two times?

`rank_time` must equal the Post's publishing time. `inserted_at` is for troubleshooting and monitoring only.

For example, a post published at 10:00 is not distributed until 10:05 because it is retried. It should still be ranked at 10:00 and cannot be placed in front of a post published at 10:04 due to late writing.

therefore:

- Use `(rank_time, post_id)` for sorting and cursor;
- Distribution delay using `inserted_at - rank_time`;
- Worker write time cannot be used as homepage sorting time.

## follow_id What problem does it solve?

Bob gets `follow_id = F1` when he first follows Alice. FeedItem generated during this period all record F1.

After Bob disengages, F1 becomes invalid. Bob gets the new `follow_id = F2` when he follows Alice again.

When reading the home page, only the FeedItem corresponding to the current valid follow_id is accepted. So old FeedItems left over from F1 will not be resurrected due to renewed focus.

## Home page reading path

1. Read common author candidates from FeedItem Store.
2. Read READ mode post candidates from the Author Timeline.
3. The two types of candidates are combined according to `(rank_time, post_id)` and deduplicated.
4. Read the Post text and deletion status in batches.
5. Verify that the Follow cycle corresponding to the candidate is still valid.
6. Filter invalid items and continue selecting candidates if necessary until 20 items are returned or no more data is returned.

## Suggested storage keys

FeedItem is sharded by `user_id` and sorted by time:

| Purpose | Key |
|---|---|
| Idempotent unique key | `(user_id, post_id)` |
| Home page reading index | `(user_id, rank_time DESC, post_id DESC)` |

`user_id` allows Bob's homepage candidates to be located in the same logical shard; `post_id` provides a stable order when the time is the same.

## What FeedItem is not

- It is not the Post text, which is still only available in the Post Store.
- Instead of focusing on relationship facts, the Follow Store is the Source of Truth.
- It is not permanent data and can be reconstructed from Post and Follow.
- It is not used for Celebrity Account's READ mode Post.

[Return to the eighth edition directory](README.md)
