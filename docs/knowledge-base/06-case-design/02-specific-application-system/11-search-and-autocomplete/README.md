# Design Search and Autocomplete system

## Case portrait

| Dimensions | Focus |
|---|---|
| Primary Archetype | Distributed Search / Ranking |
| Core Invariants | Each Search Result must be traceable to a clear Index Version; deletions and permission changes must disappear from all query paths within a specified time |
| Quality attribute priority | Relevance → Latency → Availability → Index Freshness |
| Traffic / Data Shape | Read-heavy, CPU-heavy Query, Query Fan-out, Document Asynchronous Ingestion, and Highly Skewed Popular Query |
| Failure strategy | When individual Shard times out, results marked as Partial can be returned; index update failure can be replayed; when permissions cannot be confirmed, Fail-closed |
| Security Boundary | Private Document Authorization, Delete Propagation, Query Log Privacy, Crawl Abuse and Malicious Documents |
| Key Patterns | Inverted Index、Index Sharding、Scatter-Gather、Ranking、Query Cache、CDC / Event Ingestion |

## Functional boundaries

- Search authorized documents, supporting keyword query, filtering, sorting, paging and Autocomplete.
- The basic version focuses on on-site search; Web Crawler, advertising, personalized recommendations and complex semantic search will be expanded later.

## Acceptable NFR (Design Assumptions)

- Peak 100,000 Query/s; ordinary keyword query P99 < 300 ms, Autocomplete P99 < 50 ms.
- Relevance uses the NDCG@10 / Recall@K acceptance of the fixed Judgment Set, and the new version must not exceed the agreed regression threshold.
- Ordinary document updates will be searchable within 5 minutes; deletions and permission revocation will disappear from the Search, Cache and Suggest paths within 60 seconds.
- A single Shard timeout can return results with `partial=true`; Partial private results must not be returned when permission filtering fails.

What is designed here is a complete search application. For reusable Prefix → Top-K components, see also [General Basic System: Search Autocomplete](../../01-common-basic-system/08-search-autocomplete/README.md).

## Core business closed loop

1. Source System creates, updates or deletes documents;
2. Ingestion Pipeline parses, standardizes and generates Index Document;
3. Indexer writes data to the sharded Inverted Index and publishes a queryable Index Version;
4. Query Service parses the Query and sends it to the target Shard Fan-out;
5. Each Shard returns Top-K Candidate, Aggregator Merge and Ranking;
6. Autocomplete Service returns candidate words from independent Prefix / Suggest Index.

## Core topics

- Data boundaries for Document, Field, Term, Posting List and Index Version.
- Index Sharding, Replica, Query Routing, Scatter-Gather and Top-K Merge.
- Ranking Feature, Result Stability, Pagination and Tail Latency.
- Full Index Build, Incremental Update, Backfill, Traffic Cutover and Rollback.
- Index Freshness, Delete Propagation, Permission Filtering and Source of Truth Reconciliation.
- Query Cache, Popular Query, Autocomplete Prefix Index, Spelling Correction and Abuse Prevention.

## Minimum data list

| Data | Roles | Typical Storage |
|---|---|---|
| Source Document | Authoritative business facts | Original business database or Object Storage |
| Index Document | Standardized index input | Event Stream / Staging Storage |
| Inverted Index | Derived Data serving keyword retrieval | Search Index Storage |
| Suggest Index | Derived Data serving Autocomplete | Memory / Search Index |
| Index Manifest | Records Shard, Replica and Index Version | Metadata Store |
| Query Log | Quality Assessment, Capacity and Popular Query Analysis | Event Stream / Analytical Store |

## Key Trade-off

- Higher Index Freshness increases the cost of ongoing writes, Merge, and Cache Invalidation.
- Wider Query Fan-out improves Recall and also amplifies Tail Latency and CPU.
- Precomputing more Ranking Features can reduce query latency, but increase storage and update complexity.
- Partial Result improves Availability, but the API must let the caller know that the result is incomplete.

## Interview questions

- How to make newly deleted private documents disappear from Search Result and Autocomplete as soon as possible?
- An Index Shard times out, should it return a Partial Result, the old result, or fail overall?
- How to verify the old and new indexes and perform Read Cutover safely during Full Reindex?

## Subsequent expansion sequence

1. API, data model and minimum index for on-site search;
2. Index Sharding, Query Fan-out, Top-K Merge and Ranking;
3. Incremental Indexing, Freshness, Deletion and Permissions;
4. Autocomplete, spelling correction and popular Query Cache;
5. Reindex, Shadow Query, Cutover, Recovery and Cost.
