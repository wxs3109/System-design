# Read Scaling and Derived Read Model

When the Write Model corresponding to the Source of Truth cannot efficiently support all queries at the same time, the read can be directed to the Read Replica, or the facts can be converted into the query-oriented Derived Read Model. This pattern is concerned with multi-component read links, staleness boundaries, and rebuildability.

For data roles and Schema design, see [Authoritative Data and Derived Views](../../03-data-and-storage/05-source-of-truth-and-derived-view/); for replication and consistency principles, see [CAP and Consistency Model](../../02-core-concepts/03-cap-and-consistency-model/).

## 1. Which problem to determine first?

| Problem | Priority | Reason |
|---|---|---|
| The same query model, but the read QPS is too high | Primary + Read Replica | No need to maintain the second Schema |
| Full text, geography, multi-condition filtering | Database + Search Index | Different query capabilities |
| Reading requires a large number of Joins or aggregations | Database + Materialized View | Pre-organize read results |
| Write Model and Read Model are very different | Minimum CQRS | Each is modeled according to Access Pattern |

First try indexing, query projection and single database expansion. Only add a second read path if the read load, query capacity, or isolation needs truly exceed that of a single model.

## 2. Invariants and data roles

1. Primary or business database has authoritative facts;
2. Replica, Search Index, and Materialized View may all lag behind and cannot determine the facts in reverse;
3. Each Read Model only serves explicit queries and knows how to reconstruct it from the Source of Truth;
4. Permissions, deletions, and tenant isolation must be true on all read paths.

| Component | Save content | Can it be modified independently |
|---|---|---:|
| Primary Database | Authoritative fact | Yes, it can only be written through the business path |
| Read Replica | A data copy that is basically the same shape as Primary | No |
| Event/Change Pipeline | Send committed changes to derived builders | No |
| Read Model Store | Data reorganized for querying | No |
| Query Service | Select read path, perform downgrade and permission checks | No |

## 3. Path A: Read Replica

The basic link is:

> Write -> Primary -> Replication -> Read Replica -> Query Service

Normally, write requests only go to the Primary, allowing stale reads to go to the Replica. It is suitable for scenarios where "the same Schema, the same query semantics, but more read capacity is required".

### Success Semantics

- Writing API successfully: the fact has reached the agreed commit boundary in Primary;
- Replica readable: changes have been propagated to this Replica;
- There is a replication delay between the two, and successful writing does not mean that any Replica is immediately visible.

### Read-your-writes

When users finish writing and read immediately, they can choose according to their needs:

- Route the user's reads to the Primary for a short time;
- The write response returns Version or Replication Position, and Replica will read after it reaches the Position;
- When Replica has not caught up to write the Version/Position returned by the response, Fallback to Primary;
- The product explicitly allows temporary unavailability of new content.

You cannot just say "eventually consistent" without defining how long the user can wait at most, nor can you permanently route all reads to the Primary, otherwise read expansion will be meaningless.

## 4. Path B: Derived Read Model

The basic link is:

> Primary -> Change/Event Pipeline -> Projector -> Read Model -> Query Service

Examples include:

- Post and Follow facts are derived as FeedItem;
- Item Catalog is derived from Search Index;
- The Order fact is derived as a list of orders organized by user and month;
- Transaction details are derived as report summaries.

Derived Read Model typically saves only the fields required for the query, the stable sort key, the source object ID, and the source version. The more fields are copied, the faster the query, but edits, deletions, and permission changes need to be propagated to more locations.

### What is minimum CQRS?

The minimal meaning of CQRS is just "separate Write Model and Read Model". It does not require each model to be an independent microservice, nor does it require Event Sourcing. An application that writes a relational database and asynchronously maintains query tables in the same database also embodies the minimal form of CQRS.

Continue splitting into independent services and storage only when required for independent scaling, fault isolation, or team ownership.

## 5. How to select the path for Query Service

A read must first declare freshness requirements:

| Request type | Common paths | Fallback |
|---|---|---|
| Normal list, search | Read Model or Replica | Return old results, simplified results, or fail briefly |
| Read immediately after writing | Replica that has been caught up to target version/offset, otherwise Primary | Explicit wait or retry prompt |
| Permissions and deletion confirmation | Source of Truth path, or a model that has been proven to reach the target version/offset | Fail-closed |
| Manage auditing | Primary/Audit fact source | Substitute facts without caching results |

Fallback to Primary must have concurrency and QPS caps. When a storage failure occurs, all traffic is transferred to the primary without bounds, which may expand a local failure into a full-site failure.

## 6. How Failure behaves

| Failure | What the user may see | Processing points |
|---|---|---|
| Replica Lag | The data just written is temporarily invisible | Replication Position, routing by user, or Fallback to Primary |
| Replica is unavailable | Some reads failed or traffic returned to Primary | Bounded Fallback, capacity protection |
| Pipeline stopped | Read Model getting older | Freshness warning, suspension of functions that rely on new data |
| A certain event is missed to be processed | Partial objects are permanently missing | Business reconciliation, not just looking at Lag |
| Duplicate or out-of-order | Old version overwrites new version, duplicate list items | Source version, unique constraints and idempotent updates |
| Schema incompatibility | Projector failure or field semantic error | Compatible evolution, isolation failed version |
| Slow propagation of permissions or deletions | Revoked content continues to be visible | Authoritative filtering, strict invisibility SLO |

Returning Lag to zero only means that the consumer has caught up to the latest Checkpoint, but does not prove that the query result is correct. A code bug may still write incorrect results even on "successful consumption".

## 7. Rebuild and Validation

Derived Read Model must have reconstructed inputs that do not rely on existing results. Common processes are:

1. Create a new empty Read Model version;
2. Execute Backfill from Source Snapshot (complete historical data);
3. Continue processing incremental changes from Snapshot Checkpoint;
4. Compare counts, versions and business sampling results;
5. Grayscale switches the query to the new version;
6. Keep the rollback window and delete the old version.

When backfill and online increments are run at the same time, avoid older Snapshots from overwriting newer online results. The minimum contract is: each result carries the Source Version, only accepts higher versions, or switches stages after an explicit Checkpoint.

For complete links for reliable release, Consumer Replay and Schema compatibility, see [Reliable Event Release Link](../03-reliable-event-publishing-path/) and [Core Concept](../../02-core-concepts/) respectively.

## 8. Capacity and Cost

When designing, estimate at least:

- Primary writes QPS and Replica reads QPS;
- Storage Amplification and Update Amplification for each Read Model;
- P95/P99 delay in fact submission to query visibility;
- Backfill throughput, full rebuild time and impact on online traffic;
- QPS that allows Fallback to Primary when derived storage is unavailable;
- Caps on hot tenants, hot queries and individual partitions.

Read Model reduces query time work but moves the cost to writes, storage, pipelines, and repairs.

## 9. When not to use it

- The single database index has met the capacity and latency;
- All reads must see the latest facts synchronously;
- The team cannot maintain reconstruction and reconciliation;
- The derived model does not serve new query directions, but only copies the same data;
- The business cannot account for the user impact of stale results.

This mode can be read and reused by search, News Feed, product lists, rankings and reports. The case only needs to describe the Source of Truth, the target query, the allowed Lag, Fallback and Rebuild methods.

## Checklist

- [ ] explains the choice between Replica and Derived Read Model and why;
- [ ] Writing success and Read Model can be seen as two clear boundaries;
- [ ] Read-after-write, permissions and deletion adopt appropriate read paths;
- [ ] Fallback to Primary has a capacity limit;
- [ ] Derive records with stable ID, sort key and source version;
- [ ] Able to reconstruct from authoritative snapshots and incremental changes;
- [ ] There is business-level verification, not just monitoring replication or consumption Lag.
