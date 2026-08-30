# Feed assembly, notification and counting

## FeedItem does not copy media

Version 8 FeedItem continues to save only Post ID, Author, Sort Time, and Distribution metadata. Don't copy the full Media URL, count and author information to millions of FeedItems:

- Video status and thumbnail will change;
- Count high-frequency changes;
- The author's avatar and name may be updated;
- Deletions and reviews need to take effect quickly.

## Hydration process

```text
Feed candidates
→ Batch Post
→ Batch Author
→ Batch Media Metadata
→ Batch Counts
  → Visibility / Policy Filter
  → Response
```

Feed Query Service uses request-scoped DataLoader or batch RPC to avoid N+1 calls for 20 Posts.

## Media information returned to the client

The Feed API returns displayable variants and playback entries, not object storage internal keys:

```json
{
  "media_id": "m1",
  "type": "video",
  "status": "READY",
  "poster_url": "https://cdn/...",
  "aspect_ratio": 1.7778,
  "playback_url": "https://playback/.../manifest"
}
```

## Interactive events

Like, Reply, Repost, Quote, and Mention publish an InteractionEvent after the fact is written. Different consumers process independently:

| Consumer | Results |
|---|---|
| Counter Worker | Update impression count |
| Notification Worker | Create and push notifications |
| Feed Distribution | Repost/Quote into candidate feed |
| Search Indexer | Update searchable documents and interaction signals |
| Analytics | Append behavioral events |

## Counter Store

High frequency counting should not lock the Post main row. Counter Store is sharded by post_id, using stripe if necessary:

```text
(post_id, counter_type, stripe_id) → count
```

Aggregate a small amount of Stripe when reading, and Compact periodically in the background. The Like fact is written successfully and the Counter is updated using Eventual Consistency; canceling the Like produces the opposite increment.

Counting events requires `event_id`, `entity_version` or deduplicated records. Otherwise, Queue re-rolling will count one Like twice.

## View Count

Views cannot be returned once by the feed API and then +1ed directly: prefetching, bots, and swiping all create noise. The client sends ViewEvent after reaching the visible area and dwell time defined by the product.

View pipeline performs sampling, anti-cheating, deduplication and streaming aggregation. Exact raw events go into analytics storage, and the feed displays an approximate count.

## Notification deduplication and aggregation

- Repeated Likes by the same user on the same Post will not generate multiple notifications.
- Multiple users' short-term Likes can be aggregated into one "X and other people liked your post".
- A reverse notification is usually not sent when the user cancels the Like.
- Blocked/mute or invisible Posts should not leak notification content.
- Notify consumers by event_id idempotent.

[Return to the ninth edition directory](README.md)
