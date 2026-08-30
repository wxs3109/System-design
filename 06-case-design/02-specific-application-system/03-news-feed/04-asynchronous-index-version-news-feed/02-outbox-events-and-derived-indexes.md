# Outbox, events and derived indexes

## Why do we need Outbox?

If the business transaction is submitted and then Queue is sent directly, the process may crash between the two steps: Post already exists, but PostCreated is never sent.

So the same database transaction writes:

- Post or Follow fact changes;
- Corresponds to Outbox recording.

Relay scans the Outbox and publishes the event at least once. Downtime after publishing and before marking may cause duplication, and consumers must be idempotent.

## Derived index

| Index | Source | Primary Key | Purpose |
|---|---|---|---|
| Author Timeline | Post | `(author_id, rank_time, post_id)` | Get Post ID by Author |
| Following | Follow | `(follower_id, followee_id)` | Who am I following |
| Followers | Follow | `(followee_id, follower_id)` | Who follows me |

At this time, Follow still uses `created_at` to represent the current following generation. The fifth version introduces explicit `follow_id` before cutting FeedItem.

## Idempotent rules

- Timeline：`unique(author_id, post_id)`；
- Following/Followers: only updated if the event version is not older than the current record;
- Confirm the message only after consumption is completed;
- Permanent errors go to DLQ, retaining event_id, entity_id and payload version.

## Success Boundary

Successful posting still only guarantees that the Post + Outbox has been submitted, but does not guarantee that the derived index has been updated. 04’s online feed is still read from the fact database, so indexing delays will not cause users to miss posts.

[Return to the fourth edition directory](README.md)
