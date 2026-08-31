# Storage type and selection

Storage selection does not start from "SQL or NoSQL", but from **data shape, access mode and correctness boundary**.

This article only answers three things: what application visibility capabilities are needed, what types of storage typically provide these capabilities, and what needs to be verified before choosing a specific product. CAP, replication, sharding, transaction isolation and disaster recovery principles are responsible for [core concept](../../02-core-concepts/); the storage engine algorithm is not expanded here, nor is a unified performance number promised for any product.

## 1. Write the requirements first, then list the candidates

| Dimensions | Questions to answer |
|---|---|
| Data roles | Entity, Event, Blob, or rebuildable Derived View |
| Mainly read | key point query, range paging, full text, geography, multi-hop relationship, or large-scale aggregation |
| Main write | Add, overwrite, partial update, conditional update, or just append |
| Correctness | Which uniqueness, atomic modification, and concurrency conditions must be guaranteed by the storage |
| Scale | Peak QPS, single stripe size, total volume, growth and hot data ratio |
| Timeliness | Online, background or offline; how old is allowed |
| Lifecycle | Retention, deletion, archiving, export, and rebuild requirements |
| Operational constraints | Team experience, region, compliance, quotas, costs and hosting capabilities |

For the writing method of data list and access mode, see [Data List, Fact Boundary and Access Mode](../01-data-inventory-source-of-truth-and-access-pattern/).

Don’t write “Post uses so-and-so database because it’s NoSQL.” should write:

> Post needs to be checked by post_id, stable paging by author_id and created_at, maintain business unique keys, and modify the body and visibility atomically. Look for storage that meets these capabilities first, then compare product limitations and costs of scale.

NoSQL simply represents a set of different types of products, and it cannot be argued that it is necessarily faster, more scalable, or less consistent.

## 2. Quick filtering

| Main requirements | Common starting points | Conclusions that should not be drawn directly |
|---|---|---|
| Unique constraints, condition updates, transactions with multiple related records | Relational databases | Relational databases cannot be expanded |
| Read simple values ​​or objects by full key | Key-Value | Non-key queries are also efficient |
| Read and write as a whole based on bounded business aggregation | Document | Schema Flexibility equals no Schema |
| High-throughput ordered reading under known key prefix | Wide-Column | Any filtering and Join can be temporarily added |
| Keywords, word segmentation, relevance sorting | Search engines | Search indexes should become authoritative facts |
| High-frequency multi-hop relationship traversal | Graph database | As long as there is a relationship, a graph database is needed |
| Query indicators or telemetry by time window | Time series storage | Data with time fields are time series data |
| Pictures, videos and archive packages | Object storage | Business metadata should also be put into object tags |
| Shared directory and file system semantics | File storage | Object and file storage can be replaced without distinction |
| Large historical scans and aggregations | Analytical storage | It is suitable for online row-by-row transactions |

This table is only used to generate candidates and does not replace product verification.

## 3. Relational Database

Typical products include PostgreSQL, MySQL, SQL Server, and managed databases that provide relational interfaces.

Suitable:

- There is a clear relationship between entities;
- Requires primary key, unique key, foreign key or check constraint;
- A business operation requires atomic modification of multiple related records;
- The query conditions will change within a certain range;
- Requires a combination of Count, Range, Sort and Join.

Booking's reservation, inventory, and payment references usually start with the relational model because "cannot be reoccupied" and status rules are more important than product tags.

Performance trends: When there are suitable indexes, point queries and bounded range reads are usually efficient; Joins and transactions provide expressiveness, but unbounded scans and very large transactions are expensive; each additional index usually increases write and storage costs. Single instance is not the definition of the relational model, and the horizontal expansion method must depend on the specific product.

Requires verification: actual transaction and unique constraint boundaries, index and online schema change capabilities, connection and capacity limits, visible behavior of failover, backup recovery and SLA. Support for SQL does not mean that different products have the same guarantee.

## 4. Key-Value storage

The main contract is: provide the complete key and get the corresponding value. DynamoDB, some of Azure Cosmos DB's APIs, and other KV products are possible candidates.

Suitable:

- Sessions, configurations, counters or simple states are located via stable keys;
- Access patterns are few and can be determined in advance;
- value can be read as a whole, or the product explicitly supports the required partial updates;
- Requires high query throughput and the ability to design APIs around keys.

Limitations: Support for arbitrary field filtering, joins, or ad hoc aggregations cannot be assumed; non-key queries may require secondary indexes or derived views; large values ​​amplify network and update costs; conditional updates, batch operations, and transaction boundaries vary by product.

Redis is often used for caching, but "being durable" does not automatically mean that it is suitable as a business authoritative storage. Whether it can be used as authoritative fact depends on explicit durability, recovery and failure contracts.

## 5. Document storage

Document storage stores related fields and nested values ​​in a bounded document. Common products include MongoDB and managed databases that support the document model.

Suitable:

- A business aggregation usually reads and writes as a whole;
- Different types of objects have controlled optional fields;
- Nested sets have clear upper bounds;
- Primary queries can be supported by product field indexes.

For example, in a product catalog, different categories have different attributes, and Document can reduce the sparse table structure. However, if prices, inventories and orders have independent concurrency and life cycles, they should still be recorded independently.

Limitations: "Flexible Schema" simply places more compatibility responsibilities on the application; infinitely growing arrays worsening reads, updates, and contention; cross-document transactions, joins, uniqueness, and indexing capabilities must be confirmed by product. For embedding and referencing, see [Data Model, Primary Key and Schema](../02-data-model-primary-key-and-schema/).

## 6. Wide-Column storage

Typical products include Cassandra, ScyllaDB, and Bigtable-like systems. Applications typically organize data around known key prefixes and sort fields.

Suitable for: The query path is small and stable; the amount of data and continuous writing is large; reading can be expressed as "locating a key range, and then sequentially fetching limited results"; different layouts can be maintained for different query directions.

Major limitations: Schemas are often built around queries and have limited ad hoc query capabilities; key design errors can lead to excessive scans or concentrated loads; secondary indexes, aggregations, batch operations, and atomic boundaries vary widely; authoritative facts and reconstruction methods must be defined after copying the layout.

Key routing, node migration or hotspot management are not expanded here. See [Partition, Sharding and Hotspot Management](../../02-core-concepts/08-partition-sharding-and-hotspot/).

## 7. Search Engine

Search systems such as Elasticsearch and OpenSearch usually support word segmentation, keyword matching, relevance sorting and complex filtering through inverted indexes.

Suitable for text search, relevance scoring, multi-field filtering and log retrieval. In most businesses, searching for documents is a derived view:

Post in authoritative database
→ Generate search document
→ Search system returns candidate post_id
→ Return to the authoritative service to verify deletion, permissions and latest status if necessary

How long after writing is searchable needs to be defined; index mapping changes may require rebuilding; search results cannot bypass the latest permissions and deletions; authoritative status such as funds and inventory should not exist only in search engines. Synchronization, Replay, and Rebuilding Links belong to [Common Design Pattern](../../05-general-design-patterns/).

## 8. Graph Database

Graph databases use nodes, edges and attributes as the main query objects. Typical products include Neo4j.

It is suitable for scenarios where multi-hop relationships are the core of high-frequency queries, the path itself needs to be filtered or explained, and a simple one-hop index cannot be economically satisfied, such as a fraudulent relationship network or complex permission inheritance.

Don’t default to using a graph database just because the data is “relevant”. "People who follow me" and "People I follow" are just one-hop lists in both directions, and two ordered indexes are usually enough. A small amount of offline multi-hop analysis may also be placed on the analysis platform.

## 9. Time-series Database

Time series storage is for timestamped measurements and is commonly used for metrics and device telemetry. Candidates include InfluxDB, time series storage in the Prometheus ecosystem, and TimescaleDB.

Good for: filtering by time window and label; data is usually appended; requires downsampling, time window aggregation, and automatic retention; hot and cold data access is significantly different.

It is necessary to verify the tag cardinality, raw and aggregate data retention period, late data, query window upper bound, and whether business authoritative events or observation copies are saved. Orders with created_at will not turn into time series data. The key is the main query shape.

## 10. Object Storage and File Storage

Object storage such as Amazon S3, Azure Blob Storage, Google Cloud Storage, etc. is suitable for images, videos, documents, backups, and data files. Applications usually use the Object Key to obtain the entire object or byte range, leaving the business metadata in the database:

Video table: video_id, owner_id, state, object_key, size, checksum
Object Storage: Actual Video Bytes

Object storage excels at large objects, streaming, and lifecycle layering, but typically does not provide relational queries or business transactions.

File storage provides directories, file names, shared mounts, and file system-like semantics, and is suitable for scenarios that must be compatible with traditional software or shared file protocols. Object storage is often more natural when uploading and downloading by key alone; file storage should be verified when files must be modified randomly or when a share is mounted.

For large object contracts, see [Large Objects and Object Storage](../06-large-object-and-object-storage/); object storage internal disk layout, replication, and erasure coding are outside the scope of this chapter.

## 11. OLTP Storage and Analytical Storage

Online transaction storage serves a large number of short requests; analytical storage serves a large number of historical scans, column pruning and aggregation. This is an access mode difference, not just a product name difference.

Analytical storage is suitable for scanning history by time and dimensions, aggregating on a few columns, generating reports and features, and can tolerate longer latencies. Columnar data warehouses, data lakes, and lakehouses may all play this role.

Don't let unbounded analytic queries compete for connections, CPU, and I/O to your online database. For data relationships, see [Online Data and Analysis Data](../07-online-data-and-analytical-data/); how to combine ETL, ELT, CDC and stream batch links belongs to [General Design Pattern](../../05-general-design-patterns/).

## 12. When to introduce the second kind of storage

At least it should satisfy:

1. There are important and clear access patterns, and current storage is difficult to support economically;
2. A reasonable index, limited denormalization or offline query still cannot solve the problem;
3. It has been defined which is the authoritative fact;
4. It has been defined how old the new copy is allowed to be, how to delete it, rebuild it and verify it;
5. The team is willing to bear the costs of deployment, monitoring, and schema evolution.

A Post database plus a search engine is a logical combination because full-text relevance is significantly different from transactional writing. Just adding a database to make the technology stack "complete" does not result in capability gains.

## 13. Contracts that must be verified for specific products

| Verification items | Conclusions to record |
|---|---|
| API and query | Which keys, filtering, sorting, paging and batch operations are supported |
| Atomic boundaries | Single record, single key range, or multi-record transaction |
| Constraints | Unique keys, conditional updates, foreign keys, or application-side checking capabilities |
| Index | Type, quantity, online build, size and write cost |
| Data Limits | Single, single request, partition, result set and retention limits |
| Visible Behavior | What the client sees during read-after-write, timeouts, and failovers |
| Lifecycle | TTL, deletion, backup, recovery, export and data residency |
| Capacity costs | Peak read and write, storage, network and backend maintenance costs |
| Operations | Scaling, upgrades, monitoring, quotas, SLAs and team responsibilities |

The CAP tag does not replace this table. What the application needs is the observable results of specific operations during normal operation, timeout, and failure.

## 14. Case

### News Feed

| Data | Access Patterns | Common Starting Points |
|---|---|---|
| Post authoritative record | Check by ID, author paging, editing and deletion | Relationship or Document |
| Follow relationship | One-hop ordered reading in both directions | Relationship/KV layout with bidirectional index |
| Timeline | Read the latest page by viewer and sort key | KV / Wide-Column class layout |
| Text search | Keywords and relevance | Derived search index |

The basic version can have the first three items taken care of by the relational database, and will be split only after capacity or query signals occur.

### YouTube

| Data | Access Patterns | Common Starting Points |
|---|---|---|
| Video metadata | Query by ID, owner, and status | Relationship or Document |
| Original video and transcoded files | Large object upload, range reading, life cycle | Object storage |
| Title and description search | Full text and relevance | Derived search index |
| Playback events and reports | Mass appending, historical aggregation | Event access and analysis storage |

### Booking

Inventory and Reservation first require verifiable conditional updates, uniqueness, and transaction boundaries, and a relational database is often the starting point. Hotel searches can use search or geo-indexing as derived candidates, but final price and availability are still confirmed by authoritative inventory.

## 15. Common misunderstandings

- Select databases based on popularity;
- Treat product categories as specific guarantees;
- Belief that relational databases cannot scale;
- Think NoSQL does not need Schema;
- Force one storage to handle all queries;
- Introducing multiple storages without an upgrade signal;
- Use average latency instead of verification under real data distribution.

## 16. Interview expression sequence

1. List core data roles and authoritative facts;
2. Write two to four key access patterns;
3. Indicate the correctness boundaries that must be provided by storage;
4. Choose the simplest type as a starting point;
5. Describe a key limitation and upgrade signal;
6. If a second storage is added, clarify its authority relationship, freshness and reconstruction method.

A good answer is not to list the most databases, but to have each store correspond to a data contract that cannot be ignored.
