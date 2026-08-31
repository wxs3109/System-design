# From APIs to a High-Level Architecture

Requirements and estimates answer, "What problem and scale must the system handle?" APIs, data models, and a high-level architecture turn that answer into a system that can be discussed. The right sequence is not to list technologies first, but to follow a traceable chain:

```text
Core user flows → API contracts → Access patterns → Data model → Read/write paths → Component boundaries
```

## 1. Derive APIs from Core Flows

Design only the small set of interfaces needed to support the core capabilities. For each interface, specify at least the caller, input, output, authentication, pagination, and idempotency requirements as applicable.

As a minimal example, consider creating and reading a content item:

```text
POST /items
  body: content, metadata
  header: Idempotency-Key
  returns: item_id, status

GET /items/{item_id}
  returns: item, version

GET /users/{user_id}/items?cursor=...&limit=...
  returns: items, next_cursor
```

The semantics matter more than the REST naming:

- When does a create operation report success?
- Can a retry create two objects?
- In what order are list results returned?
- Does pagination remain stable while data changes?
- Do large objects pass through the application server, or are they uploaded directly to object storage through a presigned URL?

A useful interview transition is:

> The core flows are established. I will define three interfaces to fix the system boundary and read/write semantics, then choose a data model based on those access patterns.

## 2. Write the Access Patterns Before Drawing the Schema

A data model is not merely a collection of entity names. First list the queries the system must execute efficiently:

| Access Pattern | What to Confirm |
|---|---|
| Point lookup by ID | Primary key, latency, consistency |
| List by user | Sort key, pagination, data volume |
| Scan by time range | Range index, hot and cold data |
| Search by keyword | Inverted index, update latency |
| Update status | Concurrency control, idempotency, auditing |

Then define the minimal entities:

```text
Item(item_id, owner_id, payload_ref, status, version, created_at)
UserItem(owner_id, created_at, item_id)
```

`Item` supports retrieval by ID, while `UserItem` supports pagination by user and time. When necessary, maintain denormalized views for specific access patterns instead of assuming one table can serve every query efficiently.

Decisions to explain proactively include:

- Whether the primary key can create a hotspot.
- Which fields determine ordering and pagination.
- Which constraints require transactional guarantees.
- Which derived data can be updated asynchronously.
- Whether large objects, metadata, and search indexes are stored separately.
- How data is retained, deleted, and audited.

## 3. Choose Storage to Meet Requirements, Not to Recite Product Names

Access patterns and quality attributes should drive storage choices:

- For complex relationships, constraints, and transactions, a relational model is usually a natural starting point.
- For primarily key-based access with horizontal scaling, a key-value or wide-column model may be more suitable.
- For large immutable objects, use object storage.
- For full-text and fuzzy queries, use a dedicated search index.
- To absorb reads for popular data, use a cache, while keeping the database as the source of truth.

One way to explain the choice is:

> This path primarily performs point lookups by ID and permits brief eventual consistency after a write, so I need a primary store that supports horizontal partitioning. Search has a different access pattern, so I will build a separate index asynchronously rather than make the primary database handle full-text queries.

## 4. Draw the Smallest Working High-Level Architecture

The first version should contain only the components needed to complete the primary path:

```text
Client → Traffic Entry → Stateless Service → Primary Store
                              │
                              └→ Queue → Async Worker → Derived Store
```

Write responsibilities next to component names rather than drawing unlabeled boxes:

- Traffic Entry: routing, TLS, and rate limiting.
- Stateless Service: authentication, business validation, and orchestration.
- Primary Store: source of truth.
- Queue: decouples non-immediate work and absorbs bursts.
- Worker: retries, transforms, or distributes data.
- Derived Store: cache, search index, feed, or analytics data.

Add a CDN, sharding, replication, multi-region deployment, or other components only when the requirements call for them. For each addition, answer: which bottleneck does it solve, and which new failure modes does it introduce?

## 5. Explain the Write and Read Paths Separately

### Write Path

Explain step by step:

1. How the request is authenticated, validated, and rate-limited.
2. Where the unique ID is generated.
3. Where the source of truth is written.
4. At what point success is confirmed to the user.
5. How subsequent tasks enter the queue.
6. How retries, duplicates, and partial failures are handled.

### Read Path

Explain step by step:

1. How the request is routed.
2. Whether it checks the CDN or cache first.
3. Which store serves a cache miss.
4. Where aggregation, sorting, or filtering occurs.
5. Whether stale data is acceptable.
6. How the request degrades after a dependency times out.

Do not stop after saying, "Add a cache to improve performance." Specify the cache key, value, TTL, invalidation method, and miss path.

## 6. Validate the Architecture with Estimates

After drawing the first version, map the capacity estimates back onto the components:

- Does peak QPS exceed the capacity of one service instance or partition?
- Can the data fit in one database, and when will sharding be needed?
- Can hotspots defeat otherwise even distribution?
- Do bandwidth requirements for large objects call for a CDN or direct upload?
- Are asynchronous tasks produced faster than consumers can process them?
- How much storage and write amplification do replicas and indexes add?

The purpose of estimation is to justify why components exist, not to demonstrate mental arithmetic.

## 7. Make Consistency and Failure Semantics Visible in the Data Flow

Explain the following at critical boundaries:

- Whether callers can safely retry after a timeout.
- What happens if the database write succeeds but message publication fails.
- Which store is authoritative when the cache and primary database disagree.
- Whether asynchronous consumers are idempotent.
- How replica lag affects users.
- Whether requests fail, queue, or degrade when a dependency is unavailable.

For example, if a database write and message publication must remain consistent, propose a transactional outbox. There is no need to explain every implementation detail immediately, but the dual-write risk must be recognized.

## 8. Common Mistakes

- **Listing components before finding reasons for them**: derive them again from requirements and data flows.
- **Defining too many APIs**: cover only the core flows in scope.
- **Defining entities without queries in the schema**: list access patterns and indexes first.
- **Drawing the final complex architecture immediately**: start with a minimal closed loop, then evolve it in response to bottlenecks.
- **Drawing arrows without semantics**: specify the protocol, whether the interaction is synchronous or asynchronous, and what data moves across it.
- **Discussing only the happy path**: include timeouts, duplicates, stale reads, and partial failures.
- **Using product names instead of designing**: state the required capability first, then give implementation options.

## 9. Completion Checklist

- [ ] Every core capability has a corresponding API
- [ ] API success, pagination, and idempotency semantics are clear
- [ ] The data model follows from specific access patterns
- [ ] The source of truth and derived data are clearly identified
- [ ] The high-level diagram supports at least one complete write path and one complete read path
- [ ] Every component maps back to a requirement or capacity issue
- [ ] Consistency boundaries and critical failure behavior are explained
- [ ] One or two areas have been selected for the next deep dive
