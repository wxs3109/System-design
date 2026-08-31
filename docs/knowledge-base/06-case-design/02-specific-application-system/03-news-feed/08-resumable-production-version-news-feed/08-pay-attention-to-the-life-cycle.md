# Pay attention to the life cycle

## Vulnerabilities to be addressed

If Follow is deleted directly when unfollowing, and the old FeedItem is not cleared immediately, then after Bob follows Alice again, the old FeedItem may re-pass the "currently followed" check.

This would violate this version's semantics:

> New followers will not add historical posts.

## Follow is Source of Truth

Create a new `follow_id` each time, keep the record and write the end time when it is turned off:

| Field | Description |
|---|---|
| `follow_id` | The unique ID of a follow-up period |
| `follower_id` | Start a follower, such as Bob |
| `followee_id` | Followed person, such as Alice |
| `followed_at` | The start time of this attention |
| `unfollowed_at` | Off time; empty when still paying attention |

The same pair of users can have multiple histories, but there can only be one current relationship of `unfollowed_at IS NULL` at most.

Example:

| follow_id | follower | followee | followed_at | unfollowed_at |
|---|---|---|---|---|
| F1 | Bob | Alice | 10:00 | 12:00 |
| F2 | Bob | Alice | 15:00 | null |

F1 and F2 are two different attention periods.

## Following and Followers are indexes

Follow Store preserves factual history. In addition, two current relationship indexes are maintained:

| index | entry | value example | purpose |
|---|---|---|---|
| Following | Bob | Alice → F2 | Who Bob is currently following |
| Followers | Alice | Bob → F2 | What fans does Alice currently have |

They are not new business facts. When two indexes conflict, the currently valid follow_id in the Follow Store shall prevail.

Following or unfollowing updates the Follow fact and Outbox first; the background consumer idempotently updates Following, Followers and related caches.

## Pay attention to the process

1. Check that Bob currently does not have a valid Bob → Alice relationship.
2. Create a new follow_id, for example F2.
3. Write the FollowStarted Outbox event.
4. Asynchronously update Following(Bob) and Followers(Alice).
5. Only receive `rank_time >= followed_at` Posts.

FeedItem record F2 generated after the normal author. The READ Post of Celebrity Account must also satisfy `rank_time >= F2.followed_at` when reading.

## Unlocking process

1. Write `unfollowed_at` of the current follow_id as the current time.
2. Write the FollowEnded Outbox event.
3. Asynchronously delete the corresponding current index items in Following and Followers.
4. Invalidate Bob’s Following and Feed Head caches.
5. Background cleaning of old FeedItem.

Filter immediately when the read path finds that follow_id has ended, without waiting for the old FeedItem to be physically deleted.

## Why re-following does not revive old content

Bob gets F2 after following Alice again:

- Old FeedItem record F1, current valid relationship is F2, so is filtered.
- READ Post must be later than F2.followed_at, so old posts are also filtered.
- Alice's new WRITE Post generates a new FeedItem for record F2.

`follow_id` solves both the regular author and Celebrity Account refocus semantics.

## Reconciliation (difference checking and repair) how to restore the relationship index

Following and Followers can be reconstructed from the Follow Store:

1. Find the current Follow of `unfollowed_at IS NULL`.
2. Generate index entries in both directions for each current relationship.
3. Delete the orphan item corresponding to the valid follow_id that cannot be found in the index.

Reconciliation uses follow_id to compare. You cannot only compare the two user_ids of Bob and Alice, otherwise it will be impossible to distinguish the first and second follow.

[Return to the eighth edition directory](README.md)
