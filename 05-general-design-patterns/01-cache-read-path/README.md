# Cache Read Path

The cached read link combines the Service, Cache, and authoritative database to trade acceptable staleness for lower read latency and less database load. This section discusses how components work together; see [Distributed Cache](../../04-Infrastructure-Components/04-distributed-cache/) for the capabilities of the cache product itself.

## 1. Problem to be solved

Let’s start with the simplest link:

> Client -> Service -> Database

The Cache will only be added if the following signal occurs:

- The same data is read repeatedly, and the database read QPS, number of connections, or expensive queries are close to the capacity limit;
- The target latency is significantly lower than the latency provided stably by the database;
- Data is allowed to be stale within an explicit range, or Authoritative Read can be safely performed on a miss;
- When the cache is completely unavailable, the system still has an executable Database Fallback or downgrade scenario.

If the database with indexes, query projections, or read-only replicas already meets the goals, there is no need to add caching for "architectural integrity."

## 2. Invariants and roles

| Role | Responsibilities | Do you have business facts |
|---|---|---:|
| Service | Select Key, Determine Hit, Perform Authoritative Read, Fill and Degrade | No |
| Cache | Saves read results that can be lost | No |
| Database | Stores business facts and enforces authority constraints | Yes |

The three invariants of this pattern are:

1. After the Cache is lost, it can be restored from the Database or other authoritative sources;
2. Values ​​in Cache cannot bypass permission, deletion and business status checks;
3. Cache failure cannot bring down the Database through infinite Database Fallback or retries.

## 3. Cache-Aside: Default starting point

### Cache Hit

1. Service calculates the Key based on the complete business context;
2. Cache return value;
3. Service verifies the necessary tenant, permission or version information and returns.

### Cache Miss

1. Service reads Database;
2. Database returns authoritative results;
3. Service tries to write the result to Cache and set TTL;
4. Service returns authoritative results.

Success Semantics here is important: when the Database has returned successfully, a Cache Fill failure usually should not cause this read to fail. Cache is Optimization and is not part of the actual commit.

### Write and Invalidation

A common order is:

1. Service submits Database;
2. Delete or update the relevant Cache Key after successful submission;
3. Subsequent reads miss and then fill from Database.

The API returning "write successful" means that the authoritative fact has been submitted, not that all caches have been flushed. The system needs to additionally define: how long old values ​​can be read at most.

## 4. The difference between Read-Through and Cache-Aside

| Schema | Who is responsible for loading | Advantages | Costs |
|---|---|---|---|
| Cache-Aside | Application code | Clear data source, key and degradation logic | Each application must correctly implement Authoritative Read and Cache Fill |
| Read-Through | Cache layer or unified library | The caller only initiates a logical read | Load failure, permission context and timeout boundaries are more hidden |

The core data contract of both is the same: the authoritative facts are still in the Database, and Cache misses may still transfer traffic to the Database. Selecting Read-Through does not automatically resolve hot spots, failures, or staleness.

## 5. What happens under concurrency?

### Concurrent Cache Miss

When a hotspot key expires, many instances may execute Authoritative Read at the same time. Common combinations are:

- Merge In-flight Requests for the same Key, allowing only a small number of requests to read the Database;
- TTL adds a small amount of Jitter (random offset) to avoid a large number of Keys from expiring at the same time;
- Limit global and single-tenant Database Fallback concurrency;
- When necessary, briefly return an old value that is still acceptable.

The goal of these measures is not to prevent the Cache from ever missing, but to ensure that the peak number of misses does not exceed the safe capacity of the Database.

### Stale Write overwrites the new value

Request A pauses after reading the old version; request B completes the write and updates the cache; then A fills the old value back into the cache. Optional processing includes:

- Only delete the write path and refill the read path to shorten the competition window;
- Value carries the source data version and only allows newer versions to be overwritten;
- Correctness-sensitive data is not cached or verified every time back to the authoritative source.

Don't just rely on complex deletion timing to claim "never read old". If there are no provable sequence guarantees, a stale window should still be built into the contract.

## 6. Failure, Fallback and Recovery

| Points of failure | External manifestations | Safe handling |
|---|---|---|
| Cache timeout | Unknown result, not an explicit miss | Fast-fail cache call; bounded Database Fallback or downgrade |
| A large number of Key failures | Miss and database QPS increase at the same time | Request Coalescing, Database Fallback Rate Limiting, returning old values ​​or non-critical data degradation |
| Database slows down | Authoritative Read requests pile up | Limit concurrency; cannot be masked with infinite cache retries |
| The invalidation action fails | The old value may still be read after the write is successful | TTL is used as an upper bound; reliable asynchronous invalidation or version verification is only introduced when really necessary |
| All Cache is lost | Cold start, hit rate is close to zero | Step by step Cache Pre-warming, prioritize hot spots, protect the database |
| Permissions or deletion have changed | Old objects are still cached | Shorten the TTL of sensitive data, do authority checks when reading, and clarify the upper limit of invisibility |

Failure messages are more sensitive than plain display data, but the entire chain of events should not be immediately taken as the default answer. First determine whether the TTL has met the business invisibility requirements; if not, introduce [reliable event publishing link](../03-reliable-event-publishing-path/).

## 7. Latency, consistency and cost trade-offs

| Choice | What to get | What to pay |
|---|---|---|
| Longer TTL | Higher hit rate, fewer Database Reads | Longer stale window |
| Shorter TTL | Faster natural convergence | Higher misses and database load |
| Cache complete objects | No catch-up after hit | Updates and permission changes involve more invalidations |
| Cache only IDs or projections | Easier to maintain fact boundaries | May require a second read |
| Return old values ​​on failure | Improve availability | Users see old data |
| Fail directly on failure | Avoid returning old values ​​| Reduced availability |

Whether staleness is acceptable must be determined by field and operation. A minute old user profile and a minute old revoked permission are not the same risk.

## 8. Verify instead of just looking at hit rate

At least observe:

- The separation ratio and delay of hit, miss, timeout and error;
- Database QPS, number of connections and tail latency caused by miss;
- Top-K Hot Key and single Key Database Fallback concurrency;
- The time from the authoritative write until the old cache is no longer visible;
- Recovery time after cold start or total failure;
- Cache costs split by business and tenant.

It is recommended to practice all cache invalidation, hotspot key expiration and invalidation action loss. The verification goals are that the database is still protected, permissions are not bypassed, and the system can recover hits within a limited time.

## 9. Applicable boundaries

Good for: product details, public profiles, configuration projections, popular content, and rebuildable list headers.

Use with caution: permission conclusions, inventory deductions, balances, and deletions that require immediate effect. If such data is cached, additional authority verification and maximum staleness windows must be specified.

This mode can be reused by News Feed home page, object metadata reading, product details and configuration reading; in specific cases, you only need to declare Key, TTL, allowed stale time and fault degradation, and there is no need to reinterpret Cache-Aside.

## Checklist

- [ ] The authoritative data source is clear and the Cache can be cleared;
- [ ] Key contains necessary tenant, object and Schema version;
- [ ] Hits, misses, timeouts and errors are handled differently;
- [ ] There are two boundaries between successful writing and successful cache invalidation;
- [ ] defines the respective staleness upper limits of normal data and permission data;
- [ ] When all caches are invalidated, the database still has Database Fallback upper limit and downgrade plan;
- [ ] Complexity upgrades are triggered by actual capacity or correctness signals.
