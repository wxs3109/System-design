# Data and Storage

This chapter only answers one main question: How should the data in the system be organized, queried and stored? **

It takes the scale and semantic requirements identified in the previous chapters and produces data manifests, access patterns, schemas, indexes, storage options, and lifecycle rules. This is not a refresher on CAP, replication protocols, sharding governance, asynchronous reliability, or disaster recovery.

## Position in the entire set of notes

| Chapter | Responsible Issues | Relation to this Chapter |
|---|---|---|
| 01-Back-of-the-Envelope | QPS, data volume, bandwidth and capacity | Provides order of magnitude input |
| 02-Core concepts | Consistency, availability, transactions, asynchronous, sharding and recovery semantics | Provide correctness and operational constraints |
| 03-Data and Storage | How to model, query and store data | Responsibilities of this chapter |
| 04-Infrastructure components | Capability and failure contracts for individual off-the-shelf components | Verification that specific products meet requirements |
| 05-Universal Design Patterns | How multiple components form reliable read and write links | Implement the data relationships defined in this chapter |
| 06-Case Design | How the complete system evolves step by step | Use the data design method in this chapter |

## Learning boundaries

### Must master

- Whether the data belongs to Entity, Event, Blob or Derived View;
- Which copy is the Source of Truth, and which copies can be rebuilt after being lost;
- Under what conditions are the main requests read and written, and how much data is returned;
- How to design primary keys, business unique keys, references and necessary indexes;
- Whether storage is suitable for enumeration, range, full text, multi-hop relationships or historical aggregation;
- How data volume, read-write ratio, object size and retention time affect selection;
- How Schema changes, migrations, deletions, and archiving keep data correct.

### Just understand the purpose

| Noun | Uses and tendencies that only need to be mastered |
|---|---|
| B-Tree / B+ Tree | Commonly used in ordered indexes, supporting point searches and range queries; indexes will increase writing costs |
| Hash Index | Suitable for exact matching, usually does not support ordered range queries |
| Inverted Index | Supports full-text search; typically reconstructable derived data |
| LSM Tree | Common in continuous write storage; need to pay attention to Read Amplification, background maintenance and space cost |

These are selection intuitions, not performance guarantees separated from products, configurations, data distribution and hardware.

### Not expanded in this chapter

- B-Tree node splitting, page layout and search code;
- MemTable, SSTable, Bloom Filter and Compaction algorithms;
- WAL, MVCC, Buffer Pool, query optimizer and Join algorithm implementation;
- Raft, Paxos, replicated logs and database internal architecture;
- Cross-system mechanisms such as CAP, sharding, retry, and disaster recovery.

If the topic is "Design Object Storage" or "Design Distributed Database", the internal implementation will enter [General Basic System Case] ​​​​(../06-Case Design/01-General Basic System/) to continue.

## Table of Contents and Learning Sequence

| Sequence | Topics | Problems solved |
|---|---|---|
| 00 | [Data Design Process](00-data-design-process/) | How to get executable data design from business operations |
| 01 | [Data list, fact boundaries and access mode](01-data-inventory-source-of-truth-and-access-pattern/) | What data is there, who has the final say, and how to use it in the request |
| 02 | [Data Model, Primary Key and Schema](02-data-model-primary-key-and-schema/) | How objects, relationships, constraints and stable identifiers are organized |
| 03 | [Storage type and selection](03-storage-type-and-selection/) | How to select storage according to data form and access mode |
| 04 | [Index and query path](04-index-and-query-path/) | Why is the query fast or slow? How to verify the index |
| 05 | [Source of Truth and Derived View](05-source-of-truth-and-derived-view/) | Why the same business appears in multiple storages |
| 06 | [Large Objects and Object Storage](06-large-object-and-object-storage/) | How to save pictures, videos and business metadata separately |
| 07 | [Online Data and Analysis Data](07-online-data-and-analytical-data/) | Why trading and analysis require different data paths |
| 08 | [Multi-tenant data layout](08-multi-tenant-data-layout/) | How Tenant enters keys, indexes, routing and life cycles |
| 09 | [Schema Evolution and Data Life Cycle](09-schema-evolution-and-data-life-cycle/) | How old and new Schemas coexist, and how data is migrated and exited |

It is recommended to complete 00–04 first to form the basic data design; then enter 05–09 when you encounter derived data, large objects, analysis, multi-tenancy or migration requirements. For the sake of "completeness", we will not continue to add topics.

## Fixed output of this chapter

When studying any case, the data part uniformly produces four things:

1. **Data list**: object, purpose, Source of Truth Owner, size, growth and retention time;
2. **Access mode table**: under what conditions read and write, frequency, delay target and return scale;
3. **Storage decision table**: Where to place each type of data, why, and what restrictions are accepted;
4. **Schema and index sketch**: Primary Key, Unique Key, necessary Index and Source/Derived relationship.

These four items are sufficient to support application-level System Design and do not require learning to implement a database first.

## Usage in the case

- News Feed: distinguish between Post, Follow, Timeline and search index to indicate who is the authority;
- Booking: Define different transaction and query boundaries for inventory, reservation and payment;
- YouTube: Save video metadata, object content, transcoding results and playback events separately;
- Google Maps: distinguish between basic map data, Tiles, road maps and real-time traffic;
- Multi-tenant data platform: Let Tenant boundaries enter the Item, Operation, Artifact and audit models.

These examples only verify the data design and do not redraw the complete architecture in this chapter.

## You should be able to answer after studying

- Why is this data placed in this storage?
- Which is the authoritative fact and which data can be reconstructed?
- How much data is read by what key or index for each main query?
- Does the model fit operations that must be completed atomically into the bounds of what the storage can guarantee?
- Why do large objects, online data, and analytical data need different placements?
- How do Schema, retention, deletion and migration keep business data correct?

If the answer begins to explain in detail replication, sharding, asynchrony, retries, disaster recovery, or component internal algorithms, stop and jump to the responsible section.

## Terminology convention

This chapter retains English terms commonly used in the industry. The meaning will be explained when it first appears, and English will be used directly thereafter, such as `Source of Truth`, `Derived View`, `Backfill`, `Replay`, `Watermark` and `Read/Write Amplification`. Avoid using rigid translations that do not easily correspond to product documentation.
