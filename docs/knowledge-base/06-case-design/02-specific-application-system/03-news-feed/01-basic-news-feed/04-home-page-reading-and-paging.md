# Home page reading and paging

## Read ideas

The first version does not pre-generate feeds, nor does it store user timelines separately. Every time the first page is read:

1. Query Follow based on the current user’s `follower_id`.
2. Connect Follow and Post according to `followee_id = author_id`.
3. Only keep posts published after following and not deleted.
4. Press `(created_at, post_id)` to return in reverse order.

The data model and write path of this design are simple. The limitation is that the more people a user follows, the more authors and posts the homepage JOIN needs to check.

## Query the first page of the homepage

```sql
SELECT
    p.post_id,
    p.author_id,
    p.content,
    p.created_at
FROM follows f
JOIN posts p
  ON p.author_id = f.followee_id
WHERE f.follower_id = :current_user_id
  AND p.deleted_at IS NULL
  AND p.created_at >= f.created_at
ORDER BY p.created_at DESC, p.post_id DESC
LIMIT 21;
```

The interface returns the first 20 items. If the query gets item 21, it means there is the next page; the next page cursor uses the `created_at` and `post_id` of item 20.

Condition `p.created_at >= f.created_at` ensures that when Bob follows Alice newly, he will not see the posts before following him. If Bob unfollows Alice and then re-follows her, the old posts will not reappear.

## Use cursor to query the next page

```sql
SELECT
    p.post_id,
    p.author_id,
    p.content,
    p.created_at
FROM follows f
JOIN posts p
  ON p.author_id = f.followee_id
WHERE f.follower_id = :current_user_id
  AND p.deleted_at IS NULL
  AND p.created_at >= f.created_at
  AND (
      p.created_at < :cursor_created_at
      OR (
          p.created_at = :cursor_created_at
          AND p.post_id < :cursor_post_id
      )
  )
ORDER BY p.created_at DESC, p.post_id DESC
LIMIT 21;
```

You cannot just use `created_at` as a cursor because multiple posts may have the same time. `post_id` is the second sort key, used to ensure sequence stability.

## Cursor content

Cursor should be an opaque string to the client. The server can encode in it:

| Field | Purpose |
|---|---|
| `created_at` | The publishing time of the last post on the previous page |
| `post_id` | Stable sort key at the same time |

Cursor should be signed or verified to prevent the client from arbitrarily tampering with internal fields.

[Return to the first version directory](README.md)
