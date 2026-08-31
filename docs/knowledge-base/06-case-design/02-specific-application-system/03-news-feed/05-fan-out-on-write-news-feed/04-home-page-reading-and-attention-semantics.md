# Home page reading and attention semantics

## Reading steps

1. Get the candidate items from Feed Cache or FeedItem Store by Bob's `user_id`.
2. Press `(rank_time, post_id)` to page in reverse order.
3. Read Post Cache/Store in batches to obtain the text.
4. Filter deleted Posts; and require that `follow_id` of FeedItem is still the current valid period.
5. When there are less than 20 lines, continue to overscan backwards.

Compared with the third version, there is no need to JOIN a large number of authors' Posts for each request.

## New followers do not add history

Bob follows Alice at 12:00, and only the subsequent Post of `rank_time >= 12:00` will fan-out to Bob. The follow operation itself does not scan Alice's old posts.

## Unlock

To unblock, first change the Follow fact, and then asynchronously:

- Remove Bob from Followers Index;
- Invalid Bob’s Feed Cache;
- Clean up existing Alice FeedItem.

Cleanup may be delayed, so the read path cannot just trust the FeedItem. When the current relationship does not exist, or the current follow_id is inconsistent with FeedItem, filter immediately.

## Delete post

Post uses soft delete. Immediately make the Post fact invisible after the deletion is successful, and then asynchronously invalidate the cache and clean up the FeedItem.

Independent follow_id distinguishes each follow-up period to avoid treating the time field as both business time and relationship identity.

[Return to the fifth edition directory](README.md)
