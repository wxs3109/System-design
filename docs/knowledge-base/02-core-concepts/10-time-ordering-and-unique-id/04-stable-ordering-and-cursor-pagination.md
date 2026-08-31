# Stable Ordering and Cursor Pagination

## 1. Why sorting by time is not enough

If multiple records have the same `created_at`:

```sql
ORDER BY created_at DESC
```

The database can return these records in a different order on each query. Paging boundaries can miss records or duplicate records. The sorting must include a unique Tie-breaker:

```sql
ORDER BY created_at DESC, post_id DESC
```

## 2. Offset Pagination problem

```http
GET /posts?offset=100000&limit=20
```

question:

- The database needs to skip a large number of records;
- Inserting new records after the first page will push Offset, causing duplication;
- Deleting records will move the subsequent Offset forward, resulting in omissions;
- It's hard to pin "snapshots seen on this view".

Offset is still suitable for: small result sets, background management pages, arbitrary page jumps and little data changes.

## 3. Keyset / Cursor Pagination

First page:

```sql
SELECT post_id, rank_time, content
FROM feed_items
WHERE user_id = :user_id
ORDER BY rank_time DESC, post_id DESC
LIMIT 20;
```

The next page uses the sort key of the last item on the previous page:

```sql
SELECT post_id, rank_time, content
FROM feed_items
WHERE user_id = :user_id
  AND (rank_time, post_id) < (:last_rank_time, :last_post_id)
ORDER BY rank_time DESC, post_id DESC
LIMIT 20;
```

Cursor can encode:

```json
{
  "rankTime": "2026-08-13T10:00:00Z",
  "postId": "p-123",
  "queryVersion": 2
}
```

The external Cursor should be signed or encrypted to prevent the client from tampering with the internal location and filter conditions.

## 4. Cursor must be bound to query semantics

Cursor is not just the last ID. It may also need to contain:

- sort key;
- Filter or its Hash;
- Tenant/User；
- Query Version；
- Snapshot/Index Version；
- Expiration time.

Otherwise, the client may use the Cursor used to search for A to search for B, or reuse the old Cursor to access data that should not be seen after permission changes.

## 5. Semantics when data changes

### Live Pagination

Read the current data for each page. New content usually appears before the read boundary and does not affect page turning; deleted content will disappear naturally. Suitable for feed.

### Snapshot Pagination

The first query fixes the Snapshot/Version, and subsequent pages read the same snapshot. Ideal for exports, billing, and background tasks that must be traversed in full. The price is saving a Snapshot or MVCC version.

The choice must be made explicitly. You can't promise both real-time updates and a completely fixed collection across many pages.

## 6. What to do if the ranking changes?

`score` for personalized feeds may change over time. If the score is recalculated on the next page, the same Post will cross the Cursor boundary. plan:

- Fixed Ranking Version for a Session;
- Pregenerated FeedItem with stable `rank_time`;
- Accept a small number of duplicates and remove them by the client by pressing `post_id`;
- Use Snapshot for strong integrity requirements.

Refer to [News Feed homepage read](../../06-case-design/02-specific-application-system/03-news-feed/08-resumable-production-version-news-feed/04-home-page-reading-and-feeditem.md).

## 7. Shard query

If the same user's feeds are placed in one shard by `user_id`, the Cursor only needs a single shard sort key. If you must merge across multiple shards:

- Each shard saves an independent Cursor;
- The aggregation layer performs K-way Merge;
- Cursor volume and state complexity increase;
- Each shard delay will increase the tail delay.

This is also why access patterns should affect shard keys: common pagination is best placed on a single logical partition.

## 8. Checklist

- Is the sort key unique, immutable, and indexed?
- Is Cursor bound to Tenant, Filter and Query Version?
- Use Live or Snapshot semantics?
- Are duplications or omissions allowed when adding, deleting and rearranging?
- Can the Cursor be forged or reused over the long term?
- How many shards do one paging need to access after sharding?
