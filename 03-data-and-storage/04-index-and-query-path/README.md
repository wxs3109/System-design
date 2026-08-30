# Index and Query Path

The goal of indexing is not to "make the database faster" but to allow an explicit query to read only limited, relevant data that is already close to the target order.

The end point of this study is: see a core query, be able to write candidate indexes, use the execution plan to verify the scan volume, and explain the writing and storage costs of the new index. B-Tree nodes, SSTable, Bloom Filter, Compaction, and query optimizer algorithms are not in scope.

## 1. Write Query Path first

Index design must start with real requests. For each main query, write at least:

| Projects | Questions |
|---|---|
| Positioning | From which equivalent key, range or keyword to start |
| Filter | What conditions must be true |
| Sorting | In what order to return and how to break the tie |
| Paging | Cursor or Offset |
| Return | Return several items and which fields |
| Size | How many candidate records and final results are there |
| Frequency | Peak QPS vs. read/write ratio |
| Aging | Must be the latest, or allow reading derived indexes |

Take the author's homepage as an example:

    SELECT post_id, author_id, content, created_at
    FROM posts
    WHERE author_id = :author_id
      AND (created_at, post_id) < (:cursor_time, :cursor_id)
      AND deleted_at IS NULL
    ORDER BY created_at DESC, post_id DESC
    LIMIT 20;

This is not a "query Post", but: an equality condition, an ordered cursor, a stateful filter, stable reverse order, and finite results.

## 2. What happens when there is no suitable index?

The database has to look for candidate records somewhere. Common paths are:

- Locate a small number of candidates through primary keys or indexes;
- Scan a larger range and then filter items one by one;
- Scan large amounts of data and then sort;
- Obtain candidate IDs from dedicated search, spatial or analytical indexes.

Slow queries are usually not due to the phrase "a lot of data", but because completing a request requires:

- Checking too many irrelevant records;
- Reading too many pages or remote partitions;
- Sort or aggregate large candidate sets;
- Retrieve a large number of complete records for returning a few fields;
- Waiting for a lock, I/O, or resource queue.

Indexes mainly improve positioning and ordering, but cannot solve unbounded returns, hot spots, lock contention, or downstream network problems.

## 3. Primary Key, Unique Key and Secondary Index

### Primary Key

The primary key stably locates a record and also expresses the identity of the object:

    PRIMARY KEY (post_id)

Reading details by post_id usually already has a direct path, and there is no need to build the same secondary index.

### Unique Key

Unique indexes both provide query paths and protect business invariants:

    UNIQUE (author_id, idempotency_key)

It prevents the same author from creating multiple posts using the same idempotent key. Uniqueness belongs to data correctness and cannot be deleted at will just because there are few queries.

### Secondary Index

Secondary indexes serve read directions other than the primary key. For example:

    INDEX (author_id, created_at DESC, post_id DESC)

It supports positioning by author and taking pages in stable chronological order. Whether the primary key is automatically included, whether a Base Table Lookup is required, and whether the index can be unique and created online, you should check the specific product documentation.

## 4. Composite Index order is determined by query

Composite indexes do not randomly piece together all the fields in WHERE. For common ordered indexes, the following experience can be used to generate candidates:

1. Put the main equivalent positioning field first;
2. Then put the range or target sort field;
3. Add stable juxtaposition breaking fields;
4. Only add coverage fields under explicit benefits.

Candidate indexes for author paginated queries are:

    INDEX (author_id, created_at DESC, post_id DESC)

It puts the data of the same author in the continuous query range and directly provides the target order. post_id is used to maintain stable pagination when multiple posts have the same time.

### Index Prefix affects available queries

Index (tenant_id, workspace_id, created_at) is usually suitable for:

- Read by time after specifying Tenant and Workspace;
- Read a larger prefix when specifying only Tenant, but whether this is economical depends on the amount of data.

It is generally not suitable for querying by workspace_id without providing tenant_id at all. If the query is legal and frequent, another access path is needed; if the query should not be cross-tenant in business, the lack of tenant_id should be rejected.

"Leftmost prefix" is an intuition for using common ordered indexes, but it is not an absolute rule for all databases and all predicates. The final execution plan and product documentation shall prevail.

### An index does not necessarily optimize filtering and sorting at the same time

Suppose the query is filtered by author_id and state, and sorted by created_at. Candidates may be:

    (author_id, state, created_at DESC, post_id DESC)

But if the state is very selective and updated frequently, another indexing and query strategy may be more suitable. Scan volumes and write costs should be compared based on real data distribution, not mechanical formulas.

## 5. Two query directions usually require two paths

Follow saves the same relationship, but with two reading directions:

    SELECT followee_id
    FROM follows
    WHERE follower_id = :user_id
    ORDER BY followee_id
    LIMIT 100;

    SELECT follower_id
    FROM follows
    WHERE followee_id = :user_id
    ORDER BY follower_id
    LIMIT 100;

You can use:

    PRIMARY KEY (follower_id, followee_id)
    INDEX (followee_id, follower_id)

The first path answers "Who do I follow?" and the second answers "Who follows me." This is not a fan-out scenario, nor does it replicate business facts; it simply provides a reverse positioning path for the same relationship.

In some KV or Wide-Column products, the two directions may appear as two lookup tables. At that time, it must be marked which copy is the authoritative fact and how the other copy is updated and verified; the complete cross-component link belongs to [Universal Design Pattern] (../../05-Universal Design Pattern/).

## 6. Covering Index and Table Lookup

The index can locate the record, but the query may still need to go back to the main record to read fields such as the body. This is called a Base Table Lookup. If high-frequency queries return only a few smaller fields, some products allow them to be included in the index:

    INDEX (author_id, created_at DESC, post_id DESC)
    INCLUDE (visibility, state)

The potential benefit is fewer extra reads; the cost is a larger index, more writes, and possibly less cache efficiency.

Don’t stuff large text, JSON documents, or frequently changing fields into a covering index. Only use it for queries with high frequency, bounded results and measured Base Table Lookup costs, and confirm whether the product actually executes the Index-Only path.

## 7. Selectivity and scan volume

Selectivity indicates how much a condition can narrow the candidate set.

- Querying by unique username is usually highly selective;
- state = active may hit most rows and has low selectivity;
- tenant_id may filter well in small tenants, but still leave a lot of data in very large tenants;
- The effect of created_at in the last minute depends on the write rate.

The existence of an index does not mean that the query is efficient. What's more:

How many candidate records are scanned → how many are filtered out → how many are returned

If a million items are scanned in order to return 20 items, the problem remains unsolved. Indexes, query boundaries, data layout should be adjusted, or unbounded queries in product functionality should be restricted.

### Data distribution will change the results

Uniformly small data in a test environment can be misleading. Real data may include:

- A Celebrity Author has hundreds of millions of connections;
- A few Tenants occupy most of the data;
- Popular status values ​​hit most records;
- Traffic flow is extremely uneven over time.

Validation indexes must contain near-production data volumes, skew, and high-frequency parameters.

## 8. Sort and Pagination

### Offset paging

    ORDER BY created_at DESC
    LIMIT 20 OFFSET 100000;

It is easy to express page jumps, but the database usually still has to locate or skip a large number of previous results; concurrent additions and deletions may also cause duplication or omission.

### Cursor-based Pagination

    WHERE author_id = :author_id
      AND (created_at, post_id) < (:cursor_time, :cursor_id)
    ORDER BY created_at DESC, post_id DESC
    LIMIT 20;

The cursor carries the sort value of the last item on the previous page to the next page, usually keeping each page read in a bounded range. The ordering must be stable, so a unique or stable post_id is required after created_at.

For cursor encoding, chronological order, and cross-page semantics, see [Time, Order, and Unique ID](../../02-core-concepts/10-time-ordering-and-unique-id/). This article is only responsible for matching the query and index order.

## 9. Index types that the application needs to know

You only need to know what queries they support and the main cost, no need to implement the algorithm.

### B-Tree / B+ Tree class ordered index

Commonly used for:

- Equivalent positioning;
- greater than, less than and interval;
- a sort matching the index order;
- Prefix query for compound key.

Each index adds write and space costs. Nodes, pages and splitting processes are not expanded here.

### Hash Index

Suitable for exact matching of complete keys, generally does not support ordered ranges or sorting. Whether an independent Hash Index exists and whether it is worth using is determined by the specific product.

### Inverted Index

Mapping terms or tokens to the documents containing them, suitable for full-text retrieval, word segmentation and relevance. Search indexes are typically rebuildable derived data and require defined freshness, permission filtering, and deletion propagation.

### Spatial Index

Serves spatial queries such as nearby, intersected, and included. Applications need to confirm supported coordinate systems, distance semantics, accuracy, and candidate size. Don't assume that "building a common index for each latitude and longitude" can economically complete any nearby search.

### LSM is not a synonym for Apply Secondary Index

LSM is the way some storage engines organize written and persistent data. The application layer only needs to be aware of the common tendencies: continuous writing may be more advantageous, while keeping an eye on Read Amplification, Background Compaction, Space Amplification, and Tail Latency.

These are not performance guarantees that are independent of products, configurations, hardware, and data distribution, nor do they determine which business index an application should establish.

## 10. When are full-text, geographic and analytical queries separated?

Common databases may offer full-text, JSON, spatial, and columnar capabilities. Verify that existing storage can meet your needs at an acceptable cost, and don't add new products right away when you see specialized queries.

Signals considered for independent storage include:

- Keyword relevance, word segmentation and aggregation have become core high-frequency paths;
- Geographic data volumes and query combinations exceed existing capabilities;
- Large-scale analytical scans continue to impact online transactions;
- Unacceptable index size, build time, or resource isolation;
- Dedicated storage brings clear capabilities and the team can take on derived data operations.

After adding independent indexes, authoritative sources, synchronization delays, deletions and permissions, coexistence of old and new schemas, reconstruction and integrity verification must be defined. This article does not repeat the Outbox, CDC, or stream processing links.

## 11. Index writing and Lifecycle Cost

Indexes are not free read optimization:

- Adding, updating and deleting may maintain multiple indexes at the same time;
- Indexes occupy storage and memory cache;
-Updating indexed fields is usually more expensive than updating non-indexed fields;
- Building large indexes may consume I/O, CPU, and temporary space;
- Useless or duplicate indexes increase costs without stable read benefits;
- During Schema migration, the old and new indexes may temporarily coexist.

Each index is best recorded:

| Decision items | Examples |
|---|---|
| Service query | Author homepage paging in reverse chronological order |
| Target upper bound | 20 per page to avoid scanning full history |
| key order | author_id, created_at, post_id |
| Is it unique | No |
| Expected selectivity | Target single author first |
| Cost | Each post adds an index write |
| Delete conditions | Query removal or execution plan no longer used |

Don't keep indexes that "might be useful later" but don't have an owner and query source.

## 12. Verify with Query Plan

The execution plan is the evidence between the candidate design and the real behavior. Output will vary from product to product, but at least check out:

-Which index is used, or full table/full partition scan;
- How many rows or objects are expected and actually read;
- How much is left after filtering;
- Whether additional sorting, temporary results or a large number of Base Table Lookups occur;
- Whether the estimate deviates seriously from the actual situation;
- Is it different under typical parameters and large tenant parameters.

Relational databases often use something like:

    EXPLAIN ANALYZE
    SELECT ...;

Running commands in a production environment with actual execution may actually read data and consume resources. This should be verified in a secure environment and bounded queries first. Just looking at the four words "use index" is not enough; if the index still scans a large number of candidates, the query will still be unqualified.

### Verification order

1. Prepare data close to real scale and skew;
2. Select ordinary users, large users and boundary time range;
3. Record the scan volume, return volume and high-quantile delay;
4. Add or adjust an index;
5. Compare read benefits with write and space costs;
6. Save queries, plans, and reasons for decisions.

## 13. Multi-tenant index

Queries in shared tables usually must first bring Tenant Context:

    SELECT item_id, name, created_at
    FROM items
    WHERE tenant_id = :tenant_id
      AND workspace_id = :workspace_id
      AND (created_at, item_id) < (:cursor_time, :cursor_id)
    ORDER BY created_at DESC, item_id DESC
    LIMIT 50;

Candidate index:

    (tenant_id, workspace_id, created_at DESC, item_id DESC)

Tenant ID is not only a performance field, but also an isolation contract. Whether the primary key, unique key and each access path carry Tenant, see [Multi-tenant Data Layout] (../08-multi-tenant data layout/) for details. Capacity routing and Cell architecture are not discussed in this article.

## 14. Case

### News Feed

| Query | Candidate Path | Description |
|---|---|---|
| Read details by post_id | Post primary key | Return an authoritative record |
| Author homepage | (author_id, created_at, post_id) | Time reverse cursor paging |
| Who I follow | (follower_id, followee_id) | Forward relationship reading |
| Who follows me | (followee_id, follower_id) | Reverse relationship reading |
| Home Timeline | (viewer_id, rank/time, post_id) | Derived Read Model, not equal to Post authoritative fact |
| Search text | Inverted index | Return candidate ID and handle permissions and deletion |

Which Timeline is Fan-out on Write, Read or Hybrid is determined by [General Design Pattern] (../../05-General Design Pattern/) and the case; only how it needs to be read is defined here.

### Booking

| query or constraint | candidate path |
|---|---|
| Get Reservation | reservation_id primary key |
| User order list | (user_id, created_at, reservation_id) |
| Show seat status | (show_id, seat_id) unique or authoritative inventory key |
| City and date searches | Composite/geographically derived indexes for search |

Searching the index can return candidate hotels or events, but it does not confirm that sold-out inventory is still available for purchase just because the index is older. The final write still requires the concurrency constraints of the authoritative inventory. For the specific mechanism, see [Concurrency Control and Distributed Transactions] (../../02-Core Concepts/09-Concurrency Control and Distributed Transactions/).

## 15. Common misunderstandings

- Create a separate index for each field, but there is no corresponding query;
- It is believed that multiple single-column indexes must be equivalent to a composite index;
- Ignore sorting and stable paging, only optimize WHERE;
- Query returns 20 but allows scanning millions of candidates;
- Put low-selectivity fields into the index and expect all queries to be faster;
- In order to avoid Base Table Lookup, put all large fields into covering indexes;
- Only verified on small uniform test data;
- When you see that the query uses an index, you no longer check the scan volume;
- Treat the search index, Timeline or analytic view as the authoritative truth;
- Continuously add indexes for read performance without measuring write and migration costs.

## 16. Sequence of expressions in interviews

1. Write down the filtering, sorting, paging and return scale of key queries;
2. Give a candidate compound index and field order reasons;
3. Point out the upper bound of the expected scan, instead of just saying "go to the index";
4. Explain writing, space and Base Table Lookup Trade-off;
5. Supplement the second necessary path for reverse relationships, full-text or geographical queries;
6. Explain how to verify with real distribution and execution plan.

The core evidence of index design is always how much data is actually read by this path to return a page of results.
