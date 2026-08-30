#Data design process

For the data part of the system design, instead of saying "use MySQL or Cassandra" first, we should first connect the following link:

```text
business operations
→ Data Inventory and Source of Truth
  → Access Pattern
→ Scale and correctness constraints
→ Schema, primary keys and indexes
→ Storage type
→ Derived Data and Lifecycle
```

When you're done, you should have a data design package that can be handed over to API, service, and infrastructure design, not just a diagram of boxes and arrows.

## 1. Prepare the input first, do not re-estimate and argue in this chapter

Data design requires at least two sets of inputs.

Scale input from `01-Back-of-the-Envelope`:

- Average and peak read and write QPS;
- Average and high quantile size of each object;
- The amount of data added every day;
- Retention time and total data volume;
- Hot data ratio and the order of magnitude of the returned results.

Semantic input from `02-Core Concept`:

- Which operations must be completed atomically;
- Which reads can see old data, and how old it can be at most;
- Which operations should rather be rejected when there is a network failure, rather than causing conflicts;
- Which results are allowed to be generated asynchronously;
- What state needs to be restored to after a failure.

This chapter consumes these conclusions. For example, "seat inventory cannot be oversold" is a constraint; this chapter takes care of making inventory deductions fall into a conditionally updateable record boundary, but does not repeat isolation levels, locks, or sagas.

## 2. Start with business operations, not nouns

First write the operations actually performed by the user and the system. Write at least the following for each operation:

| Fields | Questions to Answer | News Feed Example |
|---|---|---|
| Action | What the user wants to accomplish | Post a post |
| Input | What to use to locate resources | `author_id`, text, idempotent keys |
| Write results | Which Source of Truth changes | Add a new one `Post` |
| Read results | What needs to be returned immediately | `post_id`, creation time, status |
| Atomic boundaries | Which changes cannot be disassembled | Post and Outbox records in the same library |
| Derived Result | What can appear later | Search Index, Feed Timeline |
| Failure behavior | What the caller can see | Success, definite failure, or unknown result |

Don’t start by listing “Post, User, Follow” and end it. An object must be verified by operations: who created it, who read it, what conditions were used to locate it, and when it was modified and deleted.

## 3. Create Data Inventory and mark Source of Truth

Record for each type of data:

- Data type: Entity, Event, Blob or Derived View;
- Source Owner: Which Service or Domain is allowed to modify it;
- Source of Truth: Which record shall prevail in the event of a dispute;
- Identification: stable ID and business unique key;
- Size, growth and retention time;
- Delete, audit and rebuild requests.

Example:

| data | type | authoritative fact | rebuildable copy |
|---|---|---|---|
| `Post` | Entity | Post Store | Search documents, Timeline Item |
| Original video file | Blob | Source object in Object Storage | It may not be reconstructable and should be protected as the original asset |
| Transcoded video | Blob / Derived | Transcoding task status record result version | Usually can be reconstructed from the source file |
| Play event | Event | Immutable event record | Aggregation report |
| Number of plays | Derived View | Not authoritative fact for a single play | Can be reaggregated by play events |

"Authority" does not mean "only one copy can be saved." It indicates which one has the final right to interpret conflicts, deletions and repairs.

## 4. Write Access Pattern for each main request

Schema and storage selection must be driven by query shape. At least the main link records:

| Dimensions | Description |
|---|---|
| Operations | Read, write, update, or delete |
| Filter criteria | Equivalent key, range, keyword, geographic range, or relationship |
| Sorting | What fields to sort by and how to break ties |
| Return scale | One, dozens, thousands, or aggregated results |
| Peak frequency | Order of magnitude from `01` |
| Delay target | Online, background or offline |
| Freshness | Must be the latest, or allow delays |
| Atomic scope | Single row, single object or multiple objects |
| Paging | Cursor or offset |

For example, the home page query is not "read feed", but:

```text
Input: viewer_id, cursor, limit=20
Filter: Visible to viewer and not deleted
Sorting: rank/created_at DESC, post_id DESC
Returns: up to 20 lightweight FeedItems
Delay: online request
Freshness: A short delay is allowed, but removal and permission revocation require additional filtering
```

This description will directly expose the required indexes, stable sort fields, and permissions information.

## 5. Divide requirements into three types of constraints

### Correctness constraints

For example:

- The same idempotent key for the same author can only create one post;
- A seat can only have one valid reservation for the same event;
- Item names within the same Tenant are unique, but different Tenants can have the same name;
- Users whose permissions have been revoked cannot continue to access the resource simply because the search index is older.

These constraints should be turned into primary keys, unique keys, conditional updates, or permission checks as much as possible, rather than just remaining in words. For the specific concurrency mechanism, see `02-Core Concepts/09-Concurrency Control and Distributed Transactions`.

### Performance constraints

For example:

- Home page reading cannot scan all historical posts of a user's followers;
- Username login must be a highly selective positioning;
- Large videos cannot be completely transferred through the application server;
- Report queries cannot compete with online transactions for the same primary resource.

What is needed here is the upper bound of the access scale and the performance tendency. It does not promise that a certain database will necessarily reach a fixed number of milliseconds.

### Life cycle constraints

For example:

- Orders are retained for seven years;
- The search index can be rebuilt after being lost;
- After user deletion, blobs, indexes and analysis copies must be tracked and cleaned;
- Audit events cannot be covered by ordinary business updates.

Lifecycle affects whether data is kept separate and which stable IDs, versions, and deletion markers must be retained.

## 6. Design Schema, primary key and index sketch

Determine by access mode:

1. What is an independent object;
2. Which fields must be modified atomically together;
3. What stable ID is used to reference the object;
4. Which business conditions must be unique;
5. Which key does each high-frequency query start from?
6. What fields are needed for sorting and paging;
7. Which fields are redundant only for reading convenience.

A minimal sketch is sufficient for architectural discussion:

```text
Post(
  post_id, author_id, content,
  idempotency_key, created_at, deleted_at
)

Unique: (author_id, idempotency_key)
Read path: (author_id, created_at DESC, post_id DESC)
```

This step only requires the key and access path to be specified. How B-Tree pages are split and LSM compaction does not affect the application layer decisions here.

## 7. Finally select the storage type

The selection order should be:

```text
Access patterns and correctness boundaries
→ Required storage capacity
→ Candidate storage type
→ Candidate products and operation and maintenance conditions
```

For example:

| Data Requirements | Ability to Find First | Common Candidate Types |
|---|---|---|
| Orders, inventory, unique constraints | Transactions, conditional updates, flexible indexes | Relational databases |
| Read simple objects by ID | Stable key checking, high throughput | Key-Value / Document |
| Text keyword search | Relevance, word segmentation, inverted search | Search engine |
| Pictures and videos | Large objects, streaming upload and download, life cycle | Object storage |
| Large-scale historical aggregation | Column pruning, batch scanning, calculation isolation | Analysis storage |

The suitability of a specific product also depends on deployment method, region, quota, team experience and cost. Product names are not the starting point for data design.

## 8. Mark the relationship between Source of Truth and Derived Data

Any data entering your database, cache, search, object storage, and analytics systems simultaneously must answer:

- Which is the Source of Truth;
- How long the Derived Copy is allowed to be delayed;
- How deletions and permission revocation are propagated;
- Where to rebuild Derived Data when it is damaged;
- How to judge whether the reconstruction is complete;
- How old and new versions coexist during Schema cutover.

This chapter only defines this data contract. How to implement Outbox, CDC, message Retry and Replay are respectively expanded by `02`, `04` and `05`. Replay refers to reprocessing history records according to the saved message or log location.

## 9. Use main link verification instead of pursuing the model to look elegant.

After completing the sketch, go through it step by step:

### Write link

1. Determine duplication according to what key;
2. Where is the Source of Truth written?
3. Which records are covered by an atomic commit;
4. Where does the ID and version returned to the caller come from;
5. Which Derived Copy is generated later.

### Read link

1. What key or index to start with;
2. How many records need to be scanned to return one page;
3. Is the sorting stable?
4. Where to check permissions, deletion and freshness;
5. Is there a way out when derived data is missing?

### Delete and restore links

1. Where is the deleted authoritative mark written;
2. Which copies must be eventually cleaned;
3. Which data cannot be physically deleted immediately due to audit or compliance;
4. How to check the number of records, versions, references and checksums after recovery.

## 10. An example of a complete but not excessive delivery

Taking YouTube upload as an example, the data part can be delivered:

| Decision | Result |
|---|---|
| Authoritative Video Object | `Video(video_id, owner_id, state, source_object_key, ...)` |
| Original file | Source object in object storage; database only saves key, size and checksum |
| Transcoding results | Reconstructable derived object with `source_version` |
| Play event | Append event, used for analysis, update each report asynchronously |
| Query path | Check by `video_id`; paging by owner and time; search the derived index by title |
| Delete contract | Change authoritative status first, then track source objects, transcoded objects, index and analysis copy cleanup |

This is enough to hand over to the upload service, transcoding Worker, search and CDN design. There is no need to first explain how object storage distributes objects to disk.

## Common ways to lose control

- **Determine the product first and then add the reasons**: Because you are familiar with a certain database, adapt all queries to it.
- **Only ER diagram, no access pattern**: It is impossible to determine whether the index exists, and it is impossible to estimate the scan volume.
- **All copies are called data sources**: don't know who to listen to when deleting, repairing and conflicting.
- **Treat cache as authoritative data**: There is no reliable source of reconstruction after cache loss.
- **Build a large number of indexes for possible future queries**: The actual write cost is incurred first, but the benefit is not verified.
- **Covering No Boundaries with "Eventually Consistent": There is no definition of how old is allowed, and no deletion and permissions policies.
- **To be complete, talk about the storage engine source code**: It does not help determine the Schema and access path in the current case.

## Ten-minute version of the interview

When time is limited, it can be expressed in this order:

1. List three to five core objects and one immutable event;
2. Point out the Source of Truth for each type of data;
3. Write the three most frequent Access Patterns;
4. Mark two uniqueness or atomicity constraints that must be guaranteed;
5. Give the primary key, necessary index and paging fields;
6. Select relational library, KV, search or object storage according to capabilities;
7. Identify which are only derivative copies and their reconstruction sources;
8. Verify with one write link and one read link.

If the interviewer continues to ask about CAP, sharding, asynchronous delivery or disaster recovery, jump to the corresponding core concepts; do not expand all topics at once during the data modeling phase.

## Complete the checklist

- [ ] Each core operation can correspond to clear data reading and writing;
- [ ] Each type of data has Source Owner and Source of Truth;
- [ ] High-frequency queries clearly describe the key, sorting, return size and paging;
- [ ] Uniqueness and atomicity constraints have fallen to Schema sketches;
- [ ] Storage selection is launched by capabilities instead of just listing product names;
- [ ] Large objects, online transactions and analytical data are not mixed without reason;
- [ ] Derived data all indicate freshness, deletion and reconstruction sources;
- [ ] Ability to walk through write, read, delete and restore links in existing cases.

[Return to the table of contents of this chapter](../README.md)
