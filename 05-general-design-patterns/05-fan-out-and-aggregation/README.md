#Fan-out and Aggregation

Fan-out distributes one input to multiple independent targets; Aggregation combines results from multiple sources into one output. The two often appear together, but not necessarily at the same time: notification broadcast only has Fan-out, and searching multiple data sources and merging the results contains both Fan-out and Aggregation.

It is not a "two-way query index" for Follow data. `(follower_id, followee_id)` and the inverted index just allow the same relationship to support "who I follow" and "who follows me"; it only enters Fan-out when a Post, notification or query needs to be split among many recipients or sources.

This article discusses reusable cross-component links. Why Wide Fan-out amplifies Tail Latency, see [Tail Latency and Fan-out Amplification](../../02-core-concepts/02-latency-throughput-and-tail-latency/04-tail-latency-and-fan-out.md); for the delivery contract of Queue, see [Task Queue and Publish and Subscribe](../../04-Infrastructure-Components/06-task-queues-and-pub-sub/); the complete data model and API of News Feed belong to [Case Design](../../06-case-design/02-specific-application-system/03-news-feed/).

## Problem to be solved

There are two types of common requirements:

- **One-to-many distribution**: One Post, notification or configuration change affects many recipients;
- **Many-to-one read**: One request requires candidates to be fetched from multiple sources, followed by deduplication, sorting and paging.

The design goal is not to eliminate Amplification, but to decide whether to do the work at write time or read time, and set boundaries for Amplification. The Source of Truth, the Receiver relationship, and the Derived Result must be separated: the Derived Copy should be able to be reconstructed from the Source of Truth if it is lost.

## Start with the simplest solution

If there are few receivers, it is usually enough to directly call several downstreams synchronously; if there are few sources, one request for parallel reading and then merging is also enough. Full mode is introduced when the following signals occur:

- The number of recipients of a single write may reach thousands or more, and the API cannot be made to wait for all branches;
- Reading accesses a large number of sources, and P99 is dominated by the slowest branch;
- Some objects have a much higher than average number of recipients, forming Celebrity Author or Hot Tenant;
- Branches will fail partially and need to be retried, completed and checked independently;
- The derived results must be completed within a certain freshness and can be reconstructed in batches.

## Three stable topologies

### Fan-out on Write

```text
Writer -> Authority Store -> Distribution Job -> Queue -> Workers -> Recipient Views
```

After the Source Object is submitted, the Distribution Job enumerates the receivers and writes the object reference to the Derived View of each receiver. Reads only need to access their own View, so they are fast and stable; the cost is Write Amplification, extra storage and distribution latency.

Suitable for: There are far more reads than writes, the receiving relationship is relatively stable, and the number of receivers for most objects has an upper bound.

Not suitable: A single object may reach tens of millions of recipients in an instant, or the recipient relationship changes quickly and must be reflected immediately.

### Fan-out on Read

```text
Reader -> Aggregator -> Source A
                     -> Source B
                     -> Source C
                <- sorted candidates
          <- deduplicate + rank + page
```

When reading, find relevant sources, read candidates from each source in parallel, and then merge them. Writes are cheap, and relationship changes are reflected faster; the cost is Read Amplification, Tail Latency, and Aggregation CPU.

Good for when each query involves a small number of sources, there are many writes but few reads, or the results must be calculated in real time based on the latest relationships.

Not suitable for: A read needs to query hundreds or thousands of sources, or all sources must succeed before returning.

### Hybrid

Ordinary objects use Fan-out on Write, extremely large objects are kept in the source view, and a small number of special sources are merged through Fan-out on Read when reading:

```text
read result = materialized recipient view + a small set of large-source candidates
```

Hybrid is not about simply “doing both.” It must be clear how objects are classified, when they are switched, how omissions and duplications are avoided during the switch, and when old derived data is cleaned up. Classification thresholds should be derived from the expected effort of a distribution, freshness SLO, number of read sources, and cost, rather than reciting a fixed number of followers.

## Participating components and state owners

| State or component | What is responsible for | What is not responsible for |
|---|---|---|
| Authority Store | Saves a Post, Notice, or other original fact | No guarantee that all derived copies have been updated |
| Relationship/Target Store | Answers to whom it should be distributed to or read from currently | Does not save the business object body |
| Distribution Job | Records the objects, scopes, cursors, and status of a distribution | Does not become an authoritative business fact |
| Queue / Dispatcher | Batching (breaking large tasks into multiple bounded batches), Rate Limiting and scheduling retries | There is no guarantee that receiver side effects will only occur once |
| Worker | Idempotently writes a batch of derived items | Does not determine whether the business object is valid |
| Recipient/Source View | Saves a reconstructable read view | Should not be the only fact copy |
| Aggregator | Limit parallelism, candidate selection, deduplication, sorting and paging | Do not own raw facts long term |

Fan-out on Write usually only passes the object ID, target range and version in the queue, and does not copy the main text. Derived views can save the smallest snapshot required for rendering, or they can save only object references; the former is faster to read but more complex to update and delete, and the latter relies more on Authoritative Read.

## Success Semantics

Fan-out on Write has at least three different "successes":

1. The authoritative object has been submitted;
2. The distribution task has been reliably accepted;
3. The target recipient's derived view has reached the required freshness.

APIs that create objects typically only need to commit the first two items and should not wait for all recipients to finish writing. If the product promises "visible to 99.9% of recipients within 30 seconds of release", this is an independent SLO for the distribution link and needs to be verified with target coverage and oldest task age.

The aggregation of Fan-out on Read also needs to define completion conditions first:

- Must wait for all sources, otherwise the entire request fails;
- Reach the minimum number of successful sources to return partial results;
- Return existing results when the overall deadline is reached, and mark the results as possibly incomplete.

Different queries cannot share an ambiguous "best effort". Billing summaries may be required to be complete, and testimonials often accept partial results.

## Batching, Rate Limiting and Hotspot

Don't create an indivisible task for an object with millions of recipients. Distribution Job saves a stable range or Cursor and divides the receiver into Batch with an upper limit of size; the Worker only processes one Batch at a time. This action is called **Batching**. In this way, only a small range of failures can be redone, and fair scheduling can be done between Hotspot (a single object or tenant traffic concentration) and ordinary traffic.

The rough amplification relationship is:

$$
\text{Derived write rate} \approx \text{Object write rate} \times \text{Average number of targets}
$$

$$
\text{Source read rate} \approx \text{Aggregation request rate} \times \text{Number of sources per query}
$$

The average value is not enough for capacity design. It also depends on the P95/P99 and maximum value of the target number distribution. You should limit respectively: Batch Size, single-object concurrency, single-tenant concurrency, global Worker concurrency, and the number of sources that Aggregator can access simultaneously.

## Aggregation, Sort and Pagination Contract

The aggregator requests candidates from each source in the same stable order, such as `(event_time, item_id)`. `item_id` is responsible for breaking ties with equal times. After aggregation, deduplicate by business object ID or determined deduplication key, and then get the results of this page.

The next page cursor must at least express the stable sorting boundary of the previous page; if the progress of each source is different, it is also necessary to save the continuation position of each source, or use a server-side query snapshot. Don't use page numbers plus offset to pretend that cross-source results are stable: new data insertions, source timeouts, and retries can all cause duplicates or skipped items.

The specific sorting algorithm is not specified here. For the design of data primary keys, cursors and query paths, see [Data Model, Primary Keys and Schema](../../03-data-and-storage/02-data-model-primary-key-and-schema/) and [Index and Query Path](../../03-data-and-storage/04-index-and-query-path/).

## Partial failure and recovery

| Failure Scenario | Visible Performance | Recovery Method |
|---|---|---|
| The distribution task is repeated | The same derived item is written multiple times | Use "receiver + object + version" as idempotent identity |
| Worker crashes midway | A batch of receivers is partially completed | Rerun the batch; completed items are safely overwritten or ignored |
| A single target continues to fail | The overall task cannot be cleared | Isolate the bad target, record the failure range, and make up for it later |
| Queue Backlog continues to grow | Derived View is getting older and older | Limit entry, expand the parallel part, catch up by priority |
| Relationships change during distribution | New follows or unfollows are interleaved with old tasks | Define filtering by event time, task snapshot, or on read |
| A read source times out | Aggregation results are slow or incomplete | Branch deadlines, partial results, caching or rollbacks |
| Aggregation request retry | Source is read again | Use stable cursors and deterministic deduplication |
| Derived View corrupted | Individual users are missing one or more items | Rebuilt and verified from Source of Truth and relationship snapshots |

Unfollows, withdrawals, and permission changes cannot be fixed naturally by future distribution alone. If the old derived items are still there, necessary visibility verification should be done when reading; high-risk content also needs to be actively deleted. The business rules should clarify whether "only future objects will be affected after the relationship is changed", or whether "historical content will also be immediately invisible".

## Rebuild and verify

Recoverable links preserve at least: authoritative objects, interpretable receiving relationships or event history, distribution task status, and the origin identity of derived items. Common verification methods include:

- Sampling comparisons of target sets calculated from authoritative inputs with actual derivatives;
- Count the distribution target number, success number, failure number and pending number to see if they are closed;
- Monitor the age of the oldest task, number of goals completed per minute and progress of hot objects;
- Provide controlled reconstruction of individual objects, recipients or time ranges;
- Write a new version or Shadow View of the reconstruction result first, and then execute read cutover after verification.

If a derived view cannot be regenerated from authoritative facts, it is not a normal cache but another data asset that must be protected independently.

## Trade-off and selection table

| Dimensions | Fan-out on Write | Fan-out on Read | Hybrid |
|---|---|---|---|
| Writing cost | High, amplified with the number of targets | Low | High for ordinary objects, low for extreme objects |
| Read latency | Low and relatively stable | Rise with number of sources and slowest branch | Medium |
| Storage | Multiple derived copies | Source view is the main | Both coexist |
| Relationship changes | Need to compensate or filter when reading | Easily reflect the latest relationships | Rules are more complex |
| Hotspot | Celebrity Author leads to extreme Write Amplification | Highly focused users lead to extreme Read Amplification | Limit two extreme loads respectively |
| Operation and maintenance complexity | Distribution, completion, reconstruction | Aggregation, deadline, paging | At the highest level, switching semantics must be maintained |

## When not to use it

- With only a few fixed downstream, synchronous calls already meet latency and reliability goals;
- The receiver can be retrieved with an indexed database query at request time, without forking a copy;
- The business must update a small number of records in the same database in an atomic transaction;
- Derived data cannot define reconstruction sources and consistency verification;
- In order to pursue "real-time", put infinite wide fan-out into the user synchronization path.

## Which cases are reused?

- [News Feed](../../06-case-design/02-specific-application-system/03-news-feed/): Normal author uses Fan-out on Write, Celebrity Author merges when reading;
- Chat/Notifications: One event is distributed to multiple inboxes or devices;
- Search and federated query: select candidates from multiple indexes or partitions and then aggregate;
- Batch configuration release: Push to a large number of targets through multiple batches and track coverage.

## Interview Checklist

1. Where are the authoritative facts, receiving relationships, and derived views?
2. Why choose Fan-out on Write, Fan-out on Read or Hybrid?
3. What is the upper bound of fan-out for a single object or request, and how to deal with extreme distributions?
4. When the API returns success, to what stage has the distribution been completed?
5. How to recover from local branch failures, duplications, relationship changes and backlogs?
6. Does aggregation allow partial results? How are deadline and stable paging defined?
7. How to reconstruct the derived results and prove that there are no missing items or duplications?
