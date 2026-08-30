#Data model and table structure

## Data model

### User

| Field | Description |
|---|---|
| `user_id` | User unique identifier |
| `username` | Username |
| `created_at` | User creation time |

User does not save a list of posts. Posts published by users are queried through `author_id` of Post.

### Post

| Field | Description |
|---|---|
| `post_id` | Post unique identifier |
| `author_id` | Author ID, pointing to User |
| `content` | Plain text content |
| `idempotency_key` | Idempotent key for post requests; unique within the same author scope |
| `created_at` | Release time |
| `deleted_at` | Deletion time; empty if not deleted |

To delete a post use soft delete. This way reads can be immediately filtered, making auditing and recovery easier.

### Follow

| Field | Description |
|---|---|
| `follower_id` | User ID that initiated the following |
| `followee_id` | Followed user ID |
| `created_at` | The start time of this attention |

`(follower_id, followee_id)` is the joint primary key. There is a row indicating that you are currently following it; this row will be deleted when you cancel it.

This version stipulates that new followers will not add historical posts. If you unfollow it and follow it again, a new `created_at` will be generated. When reading the home page, only posts after this time will be displayed.

## PostgreSQL table structure

```sql
CREATE TABLE users (
    user_id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    username    VARCHAR(64) NOT NULL UNIQUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE posts (
    post_id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    author_id        BIGINT NOT NULL REFERENCES users(user_id),
    content          TEXT NOT NULL
                     CHECK (char_length(content) BETWEEN 1 AND 1000),
    idempotency_key  VARCHAR(64) NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at       TIMESTAMPTZ,
    UNIQUE (author_id, idempotency_key)
);

CREATE TABLE follows (
    follower_id  BIGINT NOT NULL REFERENCES users(user_id),
    followee_id  BIGINT NOT NULL REFERENCES users(user_id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (follower_id, followee_id),
    CHECK (follower_id <> followee_id)
);

```

## Index

The home page needs to find the authors from Follow and then read the undeleted posts of these authors:

```sql
CREATE INDEX idx_posts_author_feed
ON posts (author_id, created_at DESC, post_id DESC)
WHERE deleted_at IS NULL;
```

The primary key of `follows` starts with `follower_id`, which already supports "who I follow". If the product also displays a user's fan list, add a reverse index:

```sql
CREATE INDEX idx_follows_followee
ON follows (followee_id, follower_id);
```

[Return to the first version directory](README.md)
