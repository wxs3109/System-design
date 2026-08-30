# 01–08 Evolution Contract

This contract prevents unauthorized changes to product functions during internal expansion. If any version wants to change the following external semantics, it must exit the scale evolution chain and enter a new functional version.

## Fixed function

01–08 only supports:

1. Publish plain text Post;
2. Delete your own Post;
3. Follow or unfollow users;
4. Read the Following Feed arranged in reverse chronological order;
5. keyset cursor paging;
6. New followers do not make up for historical posts;
7. Deleted Posts and content whose follow-up period has ended are not visible.

## Explicitly not supported

01–08 Does not support Like, Reply, Repost, Quote, Bookmark, pictures, videos, recommendations, searches, advertisements, private messages, and live broadcasts.

Like was first added in the rich media and interactive version in 2009. It is not a scaling issue with 01–08 and should not appear in Service, Store, API, or architecture diagrams for these versions.

## Fixed external API

| Capabilities | API |
|---|---|
| Post | `POST /posts` |
| Delete post | `DELETE /posts/{id}` |
| Follow | `POST /follows/{userId}` |
| Unlock | `DELETE /follows/{userId}` |
| Home | `GET /feed` |

Internal storage, events, and workers can change, and client API paths and product semantics remain the same.

## Data invariants

- Post is the Source of Truth for the text, author, publication time and deletion status.
- Follow is the Source of Truth that focuses on the life cycle.
- Caching, Following, Followers, Author Timeline and FeedItem are all derived data.
- The loss of derived data does not mean the loss of business facts, and must be able to Backfill (historical data supplement) or rebuild.
- After a request returns success, the system must be clear about what success means and which persistence boundary is guaranteed.
- `rank_time` always comes from Post publishing time and cannot be replaced by Worker writing time.

## Must answer for each level

1. Which indicator or fault on the previous level triggers the upgrade?
2. What are the only new components added at this level?
3. What data is migrated from the old structure to the new structure?
4. How to backfill, shadow validation, traffic cutover and rollback?
5. What Missing Writes, duplications, delays, or losses will the new component cause?
6. What’s still unresolved next?

[Return to News Feed evolution path](README.md)
