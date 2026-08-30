# Data model and FeedItem

## Factual data

User, Post and Follow are still business facts. Post/Follow Outbox and Author Timeline, Following, and Followers have been established by 04.

## Followers reverse index

04 The Followers reverse index has been established. 05 Further migrate Follow from "current row" to life cycle record:

| Field | Description |
|---|---|---|
| `follow_id` | The unique ID of a follow-up period |
| `follower_id` | Followers |
| `followee_id` | Followed |
| `followed_at` | Start time |
| `unfollowed_at` | End time, current relationship is empty |

Following, Followers and FeedItem all carry follow_id. Unlocking no longer deletes historical facts, but ends the current cycle.

### Migrate from the old Follow table

The old table only saves the current relationship, and the removal records have been physically deleted. Therefore migration cannot fake the complete history:

1. Create a new FollowCycle table to allow multiple cycles for the same user pair.
2. Deploy double write first: the new follow writes the old current table and FollowCycle at the same time; if it is found that the old row has not been Backfilled (historical data supplementation), create the corresponding cycle in the same transaction and write `unfollowed_at` immediately, and then delete the old row.
3. Generate a deterministic initial follow_id for the old Follow that is still valid but has no cycle yet, `followed_at` copies the old `created_at`; use `INSERT ... ON CONFLICT` to allow race conditions with online double-write.
4. Follow Outbox and FollowCycle status changes are submitted in the same transaction.
5. Compare the "current interest relationship" calculated by the two tables through Shadow Validation.
6. After switching Source of Truth, turn it off and only fill in `unfollowed_at` without deleting FollowCycle.
7. Stop maintaining the old table after the rollback window ends.

Interest periods that have ended before Traffic Cutover cannot be restored from the old table. This is a loss of information caused by the old model and must be explicitly acknowledged. Starting from the migration completion point, the system has a complete life cycle history.

## FeedItem

FeedItem is a derived index and does not save the body:

| Field | Description |
|---|---|
| `user_id` | The user who owns the home page is also the partition key |
| `post_id` | Post ID |
| `author_id` | Author, used for filtering and cleaning |
| `rank_time` | Post release time, determines feed sorting |
| `inserted_at` | Worker write time, only used for troubleshooting |
| `follow_id` | Corresponding attention period when generated |
| `followed_at` | The start time of this cycle |

Idempotent unique keys:

> `(user_id, post_id)`

Home page reading index:

> `(user_id, rank_time DESC, post_id DESC)`

## Why are there two times?

The Post published at 10:00 should still be ranked at 10:00 because it was retried until 10:05 before being distributed. So use `rank_time` for sorting and `inserted_at - rank_time` for distribution delay.

## Data ownership

- Post Store is the Source of Truth for body and deleted status.
- Follow Store is the Source of Truth for relationships.
- Both Followers and FeedItem can be reconstructed from fact data.

The read path requires that the follow_id of the FeedItem is still in the current valid period. If Bob unfollows Alice and follows Alice again, he will get a new follow_id, so the old FeedItem cannot be revived.

[Return to the fifth edition directory](README.md)
