# Post deletion and consistency

## Correctness goal

Post Store is the Source of Truth for post visibility. Even if the post_id remains in FeedItem, Author Timeline, and Cache, the deleted text cannot continue to be displayed.

## Delete process

1. Post Store soft deletes the Post and writes `deleted_at`.
2. The same transaction writes the PostDeleted Outbox event.
3. After the submission is successful, the API returns deletion success.
4. Invalidate the Post cache and write to the DELETED negative cache with a short TTL.
5. Asynchronously clear post_id from Author Timeline, Feed Head cache and FeedItem in the background.

## Why change Post first?

If you clean up millions of FeedItems first and then delete Posts, the deletion interface will be very slow, and it will be impossible to determine which fans have been cleared if it fails midway.

After soft deleting the Post first, the Post will be filtered when the home page reads the text in batches. Physical cleanup of derived indexes can be completed slowly.

## Ordinary author

WRITE Post already exists in multiple fans' FeedItems. No synchronization reverse fan-out is performed when deleting; old FeedItems are just invalid candidates and are cleaned up by post_id in the background.

## Celebrity Account

READ Post mainly exists in Author Timeline. The corresponding timeline item will be removed in the background, but before the cleanup is completed, the read path is still filtered according to Post's `deleted_at`.

## Complete the page

If after reading 20 candidates, 3 have been deleted, the service continues to read more candidates, trying to make up 20 candidates. There should be an upper limit on the number of scans per page to avoid unbounded Authoritative Read caused by a large number of invalid records.

## Delete Freshness (data visibility delay)

The goal is for 99% of deleted posts to be invisible within 5 seconds. This goal depends on:

- Post fact update submitted;
- Post cache invalidation event is delivered reliably;
- When the cache version is uncertain, the read path queries the Authoritative Store;
- DELETED Negative Cache prevents popular posts from being deleted and causing persistent Cache Miss.

Physical FeedItem cleanup is not within the 5 second SLO because it does not determine final visibility.

[Return to the eighth edition directory](README.md)
