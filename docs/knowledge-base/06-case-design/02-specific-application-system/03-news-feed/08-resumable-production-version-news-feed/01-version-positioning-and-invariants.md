# Version positioning and invariants

## Version positioning

> Keep the functions and APIs of 01-07 unchanged, and complete the sharded mixed feed into a production system that can be observed, reconciliated (difference checking and repair), replayed and disaster-recoverable.

For the evolution baseline, see [07 Sharding Extended Edition](../07-sharding-extension-news-feed/README.md), and for fixed functions, see [01–08 Evolution Contract](../00-0108-evolution-contract.md).

| Comparison items | 07 Sharding extended version | 08 Recoverable production version |
|---|---|---|
| Features & API | Baseline | Remain unchanged |
| Feed Algorithm | Sharding Mixed Distribution | Remain unchanged |
| Data placement | Sharded by stable key | Remain unchanged |
| Cache Correctness | TTL and Event Expiration | Persistent Version + Event Invalidation + TTL Expiration Boundary |
| Silent Missing Writes | Manual troubleshooting | Periodic and accident scope Reconciliation |
| Disaster recovery | Sharded replicas | Clear backups, RPO/RTO and drills |

## Keep product boundaries unchanged

- Continued support for text-only posting, follow and unfollow, reverse chronological homepage feed, and deletion of your own posts.
- Likes, comments, reposts, recommendations, advertisements, complex privacy, pictures, videos and editing posts are not supported yet.
- External API paths remain unchanged.
- `GET /feed` still returns 20 items per page by default.
- Basic authentication and common error formats are still considered capabilities.

The internal cursor increases the snapshot time and uses `(rank_time, post_id)` as the stable sort key; this does not change the interface form seen by the client.

## Enhanced fact model

- Post adds `distribution_mode` and `mode_version` to solidify whether the Post adopts Fan-out on Write or Fan-out on Read.
- Follow uses independent `follow_id` to represent a follow period, and retains `followed_at` and `unfollowed_at`.

## Fact data and derived data

| Type | Data | Description |
|---|---|---|
| Source-of-truth Data | User, Post, Follow | Business facts, cannot be guessed from Cache |
| Derived Index | Author Timeline | Read Post ID by author, reconstructable from Post |
| Derived index | Followers | The reverse lookup index of Follow, which can be reconstructed from Follow |
| Derived index | FeedItem | Ordinary author's user homepage index, which can be reconstructed from Post and Follow |
| Cache | Post, Feed Head, Author Timeline, Following | Performance copy, recover from persistent data after loss |

In the event of a conflict, the factual data such as Post and Follow shall prevail. Derived indexes and caches must support Replay or rebuild.

## API

| Resources | Interfaces |
|---|---|
| Posts | `POST /posts` · `DELETE /posts/{id}` |
| Follow | `POST /follows/{userId}` · `DELETE /follows/{userId}` |
| Home | `GET /feed` |

[Return to the eighth edition directory](README.md)
