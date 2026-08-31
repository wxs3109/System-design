#News Feed core link thumbnail

The overview diagram is used to understand all the components; the smaller diagrams below are used to understand how the requests flow step by step.

| Links | Highlights | Draw.io |
|---|---|---|
| Post | Post and Outbox atomic submission; WRITE/READ diversion; Timeline and Fan-out | [01-post.drawio](01-post.drawio) |
| Follow | Create a new `follow_id`; asynchronously generate indexes in both Following and Followers directions | [02-follow.drawio](02-follow.drawio) |
| Home page read | Merge WRITE FeedItem and READ Author Timeline; fact filtering | [03-read-feed.drawio](03-read-feed.drawio) |
| Unfollow | End the Follow fact first; filter immediately when reading; clean derived data asynchronously | [04-unfollow.drawio](04-unfollow.drawio) |

## Unify legend

| Color | Meaning |
|---|---|
| Blue | User Portal and Synchronization Service |
| Purple | Topic, Queue and Asynchronous Worker |
| Dark Green | Fact Database |
| light green | rebuildable derived index |
| Orange | Cache and version cache |
| Yellow | Branch condition or correctness check |
| Red | Cache invalidation |

The large dashed box in each figure indicates a synchronous or asynchronous boundary. The return of the request does not mean that all derived data has been written.

[Return to architecture diagram directory](../README.md)
