# Replies, threads, forwards and quotes

## Reply

Reply is the new Post:

```text
post_id = R3
conversation_id = P1
reply_to_post_id = R2
```

`conversation_id` allows the system to quickly locate the entire session; `reply_to_post_id` retains the direct parent-child relationship.

## Conversation Store

You cannot recursively query the session from the entire Post Store table every time. Maintain derived Conversation Index:

| Partition key | Sort key | Value |
|---|---|---|
| `conversation_id` | `created_at, post_id` | parent_id、author_id、visibility、deleted |

The detail page usually does not display the entire tree at once. The read strategy is:

1. First take the root Post and the ancestor chain of the current focus;
2. Get the direct reply near the focus;
3. Select several branches based on quality and interaction;
4. Use cursor on deep branches to continue loading.

## Thread

A "thread" is usually not an independent entity, but rather a series of posts in which the author replies to himself. Optionally add Thread Metadata, which can be used to atomically publish multiple Posts during the draft phase, or record the order of author declarations.

When publishing threads in batches, each Post still has an independent post_id. The failure strategy should be clear: all atoms are visible, or the first N are successfully published and allowed to continue to be reissued.

## Repost

Repost is a relation:

```text
Repost(user_id, post_id, created_at)
unique(user_id, post_id)
```

It does not copy the original Post. RepostCreated event driven:

- Notification from the original author;
- repost_count；
- Distribute the original Post as a candidate to Reposter fans;
- Search and analyze events.

FeedItem needs to record `reason = REPOST` and `actor_id` to display "Carol reposted". The same viewer may receive the same Post through the original author and multiple Reposters. Feed Query must remove duplicates by post_id and select the display reason.

## Quote Post

Quote is a new Post with `quoted_post_id`, with its own text, media, Like, Reply and distribution lifecycle.

Delete semantics:

- The Quote author deletes his Post: the entire Quote disappears.
- The original Post is deleted or does not have permission to view: Quote author's comments can be retained, but the quote card is displayed as unavailable.
- Do not copy the original text in Quote, otherwise the content may still be leaked after the original author deletes it.

## Reply Policy

Check the current policy of the root Post before creating a Reply:

- everyone；
- accounts followed by author；
- mentioned users；
- no replies。

Policy judgment requires author relationships, mention lists, block/mute and visibility. It's an authorization check and shouldn't be relied upon solely on front-end hidden buttons.

## Popular conversations

A single viral post may have millions of replies. The Conversation Index must be partitioned by conversation_id before adding buckets to avoid hot spots in a single physical partition; the reading layer searches the buckets in parallel and then merges them according to the sorting rules.

[Return to the ninth edition directory](README.md)
