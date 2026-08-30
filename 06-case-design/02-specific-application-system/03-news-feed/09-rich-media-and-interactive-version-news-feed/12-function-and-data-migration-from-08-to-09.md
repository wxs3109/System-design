# Function and data migration from 08 to 09

## This is a function upgrade, not a capacity upgrade

01–08 Keep the plain text Post, Follow, Delete, and Following Feeds unchanged. 09 adds Like, Reply, Repost, Quote, Bookmark, Poll, pictures and videos for the first time, so a new API, fact table and client version are required.

## Like First time joining

New Like Facts:

```text
Like(user_id, post_id, created_at)
unique(user_id, post_id)
```

and add:

- `POST /posts/{id}/likes`；
- `DELETE /posts/{id}/likes`；
- Interaction Outbox；
- Counter Worker；
- Notification Worker。

There is no historical Like before going online, so Like Store and like_count start from 0. This isn't data loss, it's functionality that didn't exist before.

## Release order

1. First deploy new tables, Outbox, Topic and consumers, but the API is not open.
2. Counter/Notification uses test events to verify idempotence and Replay.
3. Deploy Feed Hydration that is compatible with old responses; new fields can be empty first.
4. The new client supports Like and rich media uploading to a small proportion.
5. Monitor Interaction facts and Counter diff, notification duplication rate, and media processing failure rate.
6. Expanded user scope; old clients continue to read plain text compatible responses.

## Reply, Repost and Quote

- Reply/Quote is a new Post relationship, and the fields of the old Post can be compatible if they are empty.
- Repost is a new user-Post relationship, accumulated since the function was opened.
- The Conversation Index is created from a new Reply event and does not require Backfill (historical data supplementation) for historical conversations that do not exist.

## Media

PostMedia is an optional association. The old Post does not have a Media line and can still hydrate normally. The publishing service only allows binding if the media_id is READY and belongs to the author.

## rollback

- Turn off the new API and feature flag, and the old plain text feed will continue to work;
- The created Like/Reply/Media facts will not be deleted to avoid user data loss;
- The new client hides the entrance, but the background consumer continues to process confirmed events;
- Reopen after repair without regenerating business ID.

[Return to the ninth edition directory](README.md)
