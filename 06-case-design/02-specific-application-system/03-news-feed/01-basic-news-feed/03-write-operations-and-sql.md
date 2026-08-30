# Write operations and SQL

## Write overview

- Post: Insert a row in Post.
- Follow: Insert a row in Follow; delete it when it is turned off.
- Delete Post: Mark the Post as deleted.

##Idempotent post

The client passes in `Idempotency-Key` when calling `POST /posts`. The service writes it to `posts.idempotency_key` and relies on `UNIQUE (author_id, idempotency_key)` to prevent retries to create multiple Posts.

```sql
INSERT INTO posts (author_id, content, idempotency_key)
VALUES (:current_user_id, :content, :idempotency_key)
ON CONFLICT (author_id, idempotency_key) DO NOTHING
RETURNING post_id, author_id, content, created_at, deleted_at;
```

The first request returns a new Post. If no row is returned, it means that this key has been used, and then query the original Post:

```sql
SELECT post_id, author_id, content, created_at, deleted_at
FROM posts
WHERE author_id = :current_user_id
  AND idempotency_key = :idempotency_key;
```

If the `content` of the original Post is different from this request, the API returns `409 Conflict`. The same idempotent key cannot be used to create another post with different content.

## Follow and unfollow

```sql
-- Note; repeated requests will not produce a second row
INSERT INTO follows (follower_id, followee_id)
VALUES (:current_user_id, :target_user_id)
ON CONFLICT (follower_id, followee_id) DO NOTHING;

-- Turn off; duplicate deletion is still safe
DELETE FROM follows
WHERE follower_id = :current_user_id
  AND followee_id = :target_user_id;
```

`CHECK (follower_id <> followee_id)` prevents users from following themselves at the database level. The API layer should still verify in advance and return clear errors.

After turning it off and following it again, a new row will be inserted and a new `created_at` will be generated. Home page query uses this time to exclude posts before re-following.

## Delete your own post

```sql
UPDATE posts
SET deleted_at = now()
WHERE post_id = :post_id
  AND author_id = :current_user_id
  AND deleted_at IS NULL
RETURNING post_id, deleted_at;
```

When no rows are returned, the post may not exist, has been deleted, or does not belong to the current user. The API layer returns `404 Not Found` or `403 Forbidden` depending on the security policy.

[Return to the first version directory](README.md)
