# Source of Truth and Derived View

The same business information often appears in databases, caches, search indexes, and precomputed lists at the same time. The focus of the design is not to eliminate duplication, but to answer: **Which copy has the final say, why other copies exist, and how to recover after an error. **

This section only defines data roles and application-visible correctness boundaries. How events are delivered reliably, how consumers retry, and how multiple components form links belong to [core concept] (../../02-Core Concept/) and [general design pattern] (../../05-General Design Pattern/) respectively.

## First distinguish four roles

| Data role | Purpose | Can it be modified independently | What to do if lost | Example |
|---|---|---:|---|---|
| Source of Truth | Determines the business truth | Can only be modified by the business write path that owns it | Restore from Backup or DR Copy | `Post`, `Follow`, order status |
| Derived View | Reorganize facts for a certain query direction | No, re-derive after modifying the facts | Rebuild from Source of Truth and Change Log | Author Timeline, Followers, Report Summary |
| Search Index | Supports full text, filtering and sorting | No | Rebuild from facts | Item Search, Post Search |
| Cache | Reduce read latency, reduce Database Read load | No | Rebuild from authoritative source after discarding | Post Cache, Feed Head Cache |

"Durable Storage" does not equal "Source of Truth". A persistent Timeline may still be just a Derived Index; a search result cannot become a business fact just because it is convenient to query.

## When is it worth creating a Derived View?

Consider Derived View when any of the following conditions are met:

- Authoritative models cannot answer high-frequency queries within latency targets;
- The query direction is opposite to the organizational direction of authoritative data. For example, `Follow(follower, followee)` should answer both "Who do I follow" and "Who follows me";
- Scan, join or aggregate large amounts of data for each read;
- Full text, geographic, graph relational or analytic queries require dedicated access capabilities;
- Results can tolerate limited freshness delays.

If a single database plus a common index already meets the capacity and latency goals, there is no need to introduce a second storage. Derived View reduces read-time calculations but increases Write Amplification, storage costs, Stale Data, and repair work.

## Each Derived View must write the Data Contract clearly

| Contract | Questions that must be answered |
|---|---|
| Source of Truth | What facts is it generated from? Who do you listen to in times of conflict? |
| Query purpose | Which access mode does it specifically accelerate? |
| Derived Key | By what key to group, sort and paginate? |
| Content Boundaries | Just save the fact ID, or copy the display field? |
| Freshness | How far behind the truth is it allowed to be? Can users see their writes immediately? |
| Deletion and permissions | After deleting, unblocking or revoking permissions, how long will it take before the post will be invisible? |
| Rebuilding input | Rely on fact snapshots, change logs, or both? |
| Verification method | How to detect missing items, multiple items, old versions and sorting errors? |

Freshness and invisibility are defined separately. It is usually acceptable for recommended results to appear a few seconds late; data whose permissions have been revoked continues to be visible, which often cannot be underestimated by just "eventually consistent".

## What is stored in Derived View?

Prioritize only the fields that are actually needed for the read path:

```text
FeedItem
user_id // Query grouping key
rank_time // stable sort key
post_id // Return to the reference of the authoritative Post
source_author // required for filtering and troubleshooting
source_version//Judge old events or old results
```

Only the ID is saved. When reading, you need to go back to the Source of Truth to complete the text. This makes it easier to keep the data correct. Copying the title, author name and other display fields can reduce the source lookup, but when deleting, editing, and permission changes, more copies need to be updated simultaneously. Both options are possible, the key is to record the cost explicitly.

Derive data without secretly generating new business facts. For example, the recommendation score can determine the ranking, but it cannot replace the authoritative judgment of `Post.visibility` or `Follow.status`.

## Case: News Feed

In [News Feed](../../06-case-design/02-specific-application-system/03-news-feed/):

| Data | Role | Reason |
|---|---|---|
| `Post`, `Follow` | Source of Truth | Determine whether the post exists and whether the user follows the author |
| Author Timeline | Derived View | Quickly read Post ID by author and time |
| Following / Followers | Derived Index of two Query Directions | serving home page reading and Fan-out on Write respectively |
| FeedItem | Derived View | Calculate the home page candidates for ordinary users in advance |
| Feed Cache | Cache | Reduce the reading delay of homepage header |

Therefore, Timeline or FeedItem can be cleared and rebuilt, but missing items in these indexes cannot be reversely interpreted as Post does not exist. When a post is deleted, the online assembly should authoritatively prevent the post from continuing to appear, even if physical cleanup has not yet been completed.

## Case: Multi-tenant data platform

In [Multi-tenant Data Platform](../../06-case-design/03-platform-system/01-multi-tenant-data-platform/), Item Catalog is the authoritative source of Item identity and definition; Search, Lineage Graph, and Top Ranking are derived views for different queries.

All derived records should carry `tenant_id` and the source object version. The search service still needs to perform tenant and permission filtering, and it cannot be determined that the caller has access just because there is a record in the index.

## What does the application need Observe for?

- Derivation delay: the time it takes for the fact to be submitted to the view for readability;
- Discrepancy rate: the proportion of factual sampling and derived results that are inconsistent;
- Number of missing items, multiple items and old versions;
- Reconstruction progress, estimated completion time and failed partitions;
- Delete or revoke the broadcast time;
- Traffic and success rate of Authoritative Read Fallback.

Broker Lag can only indicate the progress of message processing, but cannot prove the completeness of the business view. In the end, facts and derived results still need to be used for business-level verification.

## Do not expand in this section

- At-least-once delivery, idempotent, out-of-order and reconciliation principles: see [Core Concepts] (../../02-Core Concepts/);
- Kafka, Queue, Cache and other individual products: see [Infrastructure Components] (../../04-Infrastructure-Components/);
- Outbox, CDC, CQRS and Derived Read Model links: see [Universal Design Patterns] (../../05-Universal Design Patterns/);
- Internal data structures for search engines, databases and caches.

## Checklist

- [ ] Each duplicate is labeled with the Source of Truth or Derived role;
- [ ] Each Derived View only serves the explicit Query Pattern;
- [ ] defines upper limits on acceptable freshness and invisibility;
- [ ] Deletions, permission changes and Schema versions entered into the contract;
- [ ] Know where and according to which version the derived data will be reconstructed after it is lost;
- [ ] There is business-level difference checking, not just message backlog.
