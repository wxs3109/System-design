# Post type and interactive data model

## One Post model, multiple relationships

Reply and Quote are new Posts with their own text, author and media. Repost is usually just a "user re-distributes a Post" relationship, without copying the text.

| Behavior | Whether to create a new Post | Key Quotes |
|---|---|---|
| Original | Yes | None |
| Reply | Yes | `reply_to_post_id`, `conversation_id` |
| Quote | Yes | `quoted_post_id` |
| Repost | No | Repost relationship points to `post_id` |
| Thread next post | is | usually the author replies to his previous post |

## Post

| Field | Description |
|---|---|
| `post_id` | Globally unique ID |
| `author_id` | Author |
| `text` | Text, can be empty but cannot be empty together with media |
| `conversation_id` | Session root Post ID; equal to itself when original |
| `reply_to_post_id` | Directly reply to the object, optional |
| `quoted_post_id` | The referenced Post, optional |
| `visibility` | public, followers, mentioned, etc. |
| `reply_policy` | everyone、followed、mentioned |
| `distribution_mode` | Follow the eighth version WRITE / READ |
| `mode_version` | Distribution mode version |
| `created_at` | Release time and sorting time |
| `deleted_at` | soft delete time |

## PostMedia

Post and Media use association tables to keep order:

| Field | Description |
|---|---|
| `post_id` | Post ID |
| `media_id` | Media ID |
| `position` | Which media |

The unique key is `(post_id, media_id)`, and a unique constraint is created on `(post_id, position)`.

## MediaAsset

| Field | Description |
|---|---|
| `media_id` | Media ID |
| `owner_id` | Uploader |
| `type` | image、gif、video |
| `status` | INITIATED、UPLOADING、PROCESSING、READY、FAILED、DELETED |
| `original_object_key` | Original object key, not directly exposed to the client |
| `mime_type` | The real format after server sniffing |
| `size_bytes` | File size |
| `width` / `height` | Dimensions |
| `duration_ms` | Video or GIF duration |
| `checksum` | Integrity and deduplication assistance |
| `moderation_state` | pending、allowed、limited、blocked |
| `created_at` | Creation time |

MediaVariant saves derivatives such as thumbnails, WebP/AVIF, HLS/DASH rendition, subtitles and covers separately.

## Interactive relationship

| data | unique key | visibility |
|---|---|---|
| Like | `(user_id, post_id)` | Can be disclosed by product policy |
| Repost | `(user_id, post_id)` | Public communication relationship |
| Bookmark | `(user_id, post_id)` | Private, cannot enter the public event stream |
| PollVote | `(poll_id, user_id)` | Selection usually hidden from other users |

## Counter is not Source of Truth

`like_count`, `reply_count`, `repost_count` and `view_count` shown on Post are Derived Counters. Source of Truth is still the correspondence or Event Log.

The count can fall behind temporarily, but cannot accumulate repeatedly due to message re-delivery. The Counter Worker must deduplicate by `event_id`, or compute increments from idempotent state changes.

## Delete semantics

- Delete original Post: Feed no longer displays text or media.
- Delete Reply: The conversation tree retains breakpoints or tombstones (deletion markers) to prevent sub-replies from losing position.
- Delete Quote: Only the new Post of the quoter will be deleted, but the original Post will not be deleted.
- The original Post was deleted: Quote can retain the quoter text, but the quoted card display is unavailable.
- Repost deletion: only delete the propagation relationship.

[Return to the ninth edition directory](README.md)
