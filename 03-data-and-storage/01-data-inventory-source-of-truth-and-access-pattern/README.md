# Data Inventory, Source of Truth and Access Pattern

Data design must first answer three questions:

1. What data of different natures are there in the system;
2. When there are multiple copies of the same business information, which copy has the final say;
3. Request how to actually read and modify this data.

If these three points are not clear, database selection, Schema and indexing are just guesses.

## 1. Data Inventory is not a list of table names

Just listing `users`, `posts`, `orders` is not enough. The data inventory needs to document its role in the business:

| Field | Question to answer |
|---|---|
| Name | What is this type of data |
| Type | Entity, Event, Blob or Derived View |
| Purpose | Which business operation creates and consumes it |
| Owner | Which service or business domain is allowed to modify it |
| Source of Truth | Which copy shall prevail in the event of discrepancy |
| Identity | What is the stable ID and business unique key |
| Scale | Single size, increment, total amount and hot data ratio |
| Lifecycle | Retention, archiving, deletion and auditing requirements |
| Recovery | Is it possible to rebuild and where to rebuild |

"A lot of posts" is not a usable scale description; "about 100 million new posts are added every day, the average text size is 500 B, and the home page mainly reads the last seven days" will affect the design. The specific conversion method is the responsibility of `01-Back-of-the-Envelope`.

## 2. Four common data roles

### 2.1 Entity: Current business status

Entity represents a business object that has an identity and changes, for example:

- `User`；
- `Post`；
- `Reservation`；
- `Workspace`；
- `Video`。

It typically requires the stable ID, current state, creation time, and version information.

Entity is not equal to a row in the database. A complex business object can be split into multiple tables or multiple storage objects; the concern here is whether it has an independent identity and life cycle.

### 2.2 Event: the fact that has happened

Event means "something happened", for example:

- `VideoPlayed`；
- `PaymentAuthorized`；
- `ItemPermissionChanged`；
- `PostPublished`。

Events should at least:

```text
event_id
event_type
occurred_at
actor / subject ID
payload version
```

Events typically append rather than overwrite, but not all database row changes deserve to be considered business events. Stable event contracts are only required for facts that need to be understood, tracked, or replayed downstream. Reliable delivery and consumption idempotence belong to `02-Core Concepts` and will not be discussed here.

### 2.3 Blob: opaque object with large content

Blobs include images, videos, compressed packages, documents and model files. Applications generally do not query its internal bytes through SQL conditions, but access them as a whole or segmented through Object Key.

Usually two parts are separated:

```text
Database: owner, permissions, status, object_key, size, checksum, version
Object storage: actual byte content
```

The reason is not that "databases absolutely cannot save binary", but that the transmission, expansion, life cycle and access methods of large objects are obviously different from small business records.

### 2.4 Derived View: Data generated for reading

Derived data is calculated from other authoritative facts, such as:

- Search index;
- News Feed Timeline；
- Popular list;
- Daily play volume aggregation;
- Report model;
- Thumbnails and transcoded files.

To determine whether it is derived data, you can ask:

> If this data is lost in its entirety, can it be correctly reconstructed using only other authoritative data?

If you can, it's usually derived data. If not, it must be revisited to see if it preserves irreplaceable original facts.

## 3. Source of Truth: Who do you listen to when there is a conflict?

A Post may exist simultaneously in:

- Post Database；
- Redis cache;
- search engine;
- User Timeline;
- Analyze warehouse.

This does not mean there are five equal data sources. generally:

```text
Post in Post Database = authoritative fact
The other four = copies or derivatives targeting different read paths
```

After clarifying the authoritative facts, the following questions can be answered:

- Where to modify first when editing the text;
- What is displayed when the search results conflict with the details page;
- Which status prevents further access when deleting a post;
- Where to rebuild the Timeline when it is damaged;
- How to judge whether Backfill is complete.

### Source Owner is not equal to the storage administrator

Source Owner is the business boundary. For example, Payment Service has payment status; although Database Platform Team operates and maintains the underlying Instance, it cannot interpret the meaning of payment at will.

A business domain can put different data into different physical storages, but the modification entry should still be clear. Multiple services writing directly to the same record can obscure status rules and recovery responsibilities.

### Source of Truth does not mean that it will always be read synchronously.

Just because the homepage can be read from Timeline for low latency does not mean that Timeline becomes the authoritative source for Post. Removal or permission determination may still require newer authoritative status or specialized filtering data.

## 4. Access Pattern determines data organization

The access mode cannot just write "query posts". It should at least spell out filtering, sorting, result size, and latency requirements.

### Check

```text
GET Video by video_id
```

Features: Return an object through a stable key, suitable for primary keys or highly selective unique indexes.

### Range and sorting query

```text
GET posts by author_id
WHERE created_at < cursor_time
ORDER BY created_at DESC, post_id DESC
LIMIT 20
```

Features: Equivalent prefix plus ordered range. The order of composite indexes should be close to filtering and sorting, rather than just throwing all fields in randomly.

### Relationship query

```text
List people I follow
List people who follow me
```

These are two directions. `(follower_id, followee_id)` supports the first direction; the second direction usually also requires a reverse index. The data is the same, but the access direction is different, and the organization may be different.

### Full text search

```text
Search for posts that contain keywords and are visible to the current user
```

Full-text retrieval requires word segmentation, relevance and inversion capabilities, often using derived search indexes. The authoritative database still maintains text and visibility status.

### Geospatial query

```text
Find stores open within 3 km of your current location
```

It requires distance or area filtering capabilities. After returning to the candidate location, volatile business status such as inventory and price may still need to be confirmed by the corresponding authoritative service.

### Graph relationship query

```text
Find relationships between two people with up to three hops
```

Multi-hop traversal is different from a simple one-hop watch list. Only when the multi-hop relationship itself is the core high-frequency query, special graph query capabilities are needed; do not use the graph database by default just because the data is "relationship".

### Aggregation query

```text
Statistics of play time in the past year by region and day
```

It scans and aggregates large amounts of historical data and generally should not directly occupy the main resources of an online transaction database. Data freshness can often be lower than online detail queries.

## 5. An executable Access Pattern table

Take News Feed as an example:

| Operations | Positioning & Filtering | Sorting/Scaling | Peaks & Latency | Freshness/Correctness |
|---|---|---|---|---|
| Get post details | `post_id`, not deleted and visible | 1 item | Gaodu QPS, online | Deletions and permissions must take effect in a timely manner |
| Author home page | `author_id` | Reverse chronological order, 20 per page | Online | Acceptable short indexing delays |
| Home Feed | `viewer_id` | Rank/reverse time order, 20 per page | Highest read QPS, online | Timeline can be slightly older, permissions cannot be bypassed |
| Search posts | Keywords, language, visibility | Relevance, 20 per page | Online | Seconds to minutes indexing latency acceptable |
| Count the number of posts | Time, region | Aggregation results | Backend/Analysis | Hourly freshness may be enough |

"Can be slightly older" must ultimately be within a range that is acceptable to the business, such as "search for new content to be visible within one minute." How the consistency model provides this semantics, linked to `02-Core Concepts/03-CAP and Consistency Model`.

## 6. The same data may serve multiple reads, but do not force one layout to handle them all.

Authoritative records for Post are suitable for:

- Press `post_id` to update and check;
- Maintain author, text, visibility and deletion status.

But the following read shapes are different:

- Pagination by author and time;
- Sort by keyword relevance;
- Pre-generated Timeline for each reader;
- Aggregated by day and region.

These queries can be served using an Index, Materialized View, or a standalone Derived Store. The key is not "there can only be one database" but that each copy has a clear purpose, Source of Truth, and Freshness Contract.

## 7. Online, background and analysis are not at the same latency level

### Online request

The user is waiting, such as logging in, opening details, and locking the base. Features are:

- Strict latency targets;
- A single read should have an upper bound;
- Too many dependencies will increase tail latency;
- Returning too much data requires paging or truncation.

### Background tasks

For example, transcoding, generating thumbnails, and indexing Backfill. Features are:

- A single task can run for a long time;
- Pay more attention to throughput, recoverable progress and resource budget;
- Can be processed in batches;
- Should not crowd the main online link.

### Analysis query

Such as monthly revenue and user retention. Features are:

- Large scanning span and aggregation volume;
- Usually accepts older data;
- Need to isolate resources from online transactions;
- The output may be a new derived dataset.

Latency category is a part of the access pattern that directly affects whether different data copies and storage types are required.

## 8. How to list data in three cases

### Ticket Booking

| Data | Personas | Authoritative Facts | Primary Visits |
|---|---|---|---|
| Show, Seat | Entity | Catalog / Inventory Store | List seats by show |
| Reservation | Entity | Reservation Store | Query by reservation ID, user, status |
| Payment | Entity / State Machine | Payment Store | Query by payment ID, business unique key |
| Payment Callback | Event | Original receipt record | Deduplication and auditing by provider event ID |
| Available seat count | Derived View | Derived from seat status | Quick display, not used as the basis for final deduction |

The "cannot oversell" mechanism is not implemented in the data list, but the data list will indicate that the inventory record must be authoritatively conditionally modified.

### YouTube

| Data | Personas | Authoritative Facts | Primary Visits |
|---|---|---|---|
| Video Metadata | Entity | Metadata Store | `video_id` Check, paging by owner |
| Original video | Blob | Source Object | Upload, segmented reading, transcoding input |
| Transcoded file | Derived Blob | Generated from specified source version | Play by definition |
| Search Document | Derived View | Derived from Metadata | Keyword search |
| Play Event | Event | Appendable Event Recording | Analysis Ingestion |
| Play statistics | Derived View | Play Event aggregation | Display and reports |

### Multi-tenant data platform

| Data | Personas | Authoritative Facts | Primary Visits |
|---|---|---|---|
| Workspace, Item | Entity | Metadata Store | Always check and enumerate with `tenant_id` |
| Item Definition | Versioned Blob/Document | Definition Store | Read by Item and version |
| Operation, Attempt | Entity / Event-like state | Operation Store | Query by status, item, time |
| User files and tables | Blob/Table | Shared Data Storage | Access after authorization by Item |
| Logs and Metrics | Event / Time Series | Telemetry Store | Query by Tenant, Operation and Time |

The core here is not to back database products, but to allow Tenants, Items, Operations and large-scale data to have different and clear uses and life cycles.

## 9. Hidden risks in access patterns

### Unbounded query

"List all posts by a user" will grow over time. Change to stable paging and limit the size of each page.

### Low selectivity filtering

Just querying by `status = ACTIVE` may match most records. More efficient prefixes such as Tenant, Owner, Time, or Task Queue Grouping are often also required.

### Unstable paging

When sorting only by second level `created_at`, multiple records may be juxtaposed. Add stable unique ID as tie-breaker; see `02-Core Concepts/10-Chronological Order and Unique ID` for cursor details.

### Filter permissions in memory after reading

If you first fetch 10,000 items and then filter to 20 items at the application layer, the delay and risk of data exposure will increase. It should be clear whether permissions can enter the query path and how derived indexes carry verifiable access information.

### Treat counting as an absolute fact

The accuracy requirements for likes, plays and available seats are different. The first two may accept aggregation delays; final seat deductions cannot rely on stale counts. Don’t use the same data semantics just because the fields are all called count.

## 10. Complete the checklist

- [ ] not only lists the table name, but also records the data role, owner and life cycle;
- [ ] An authoritative source can be pointed out for each derived data;
- [ ] Core queries are clearly written with filtering, sorting, scaling and paging;
- [ ] distinguishes between online, backend and analytical access;
- [ ] Indicate freshness and permission requirements, rather than generally saying "eventually consistent";
- [ ] identified the forward/reverse relationship query and stable sorting requirements;
- [ ] No replication, sharding, message retries or storage engine algorithms are discussed in this article.

[Return to the table of contents of this chapter](../README.md)
