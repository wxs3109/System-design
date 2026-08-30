# Distributed Cache

A distributed cache stores reusable in-memory data on a set of independent nodes, allowing multiple application instances to share low-latency read results. It usually sits between a service and a slower authoritative data source.

```text
Client -> Service -> Distributed Cache
                     | miss / bypass
                     v
                Authoritative Store
```

This section treats a cache as a component that can be purchased, deployed, and called, and discusses only its external contract. Complete read/write flows such as Cache-Aside belong in [General Design Patterns](../../05-general-design-patterns/). The principles behind staleness, hot spots, and failure tradeoffs belong in [Core Concepts](../../02-core-concepts/).

## The Immediate Problem It Solves

Signals that a distributed cache may be appropriate include:

- multiple service instances repeatedly read the same results;
- the source database's read QPS, computation, or connection count is near a safe threshold;
- generating a read result costs substantially more than one cache access;
- the business tolerates a defined amount of staleness or can perform an authoritative read after a miss;
- per-process local caches duplicate storage, or multiple instances need to share state.

A cache is not a default component. If data is rarely reused, reads are already cheap, every access must return the latest fact, or the database cannot sustain any fallback traffic during a failure, adding a cache may merely add another failure point.

## Minimal External Contract

From the caller's perspective, a regular cache provides at least these outcomes:

| Operation or result | What the caller can rely on | What it must not assume |
|---|---|---|
| GET key hit | Returns the bytes or value associated with the key | The value is the latest business fact |
| GET key miss | The key is absent, expired, or evicted | The reason for the miss is distinguishable |
| SET key value TTL | Stores the value and sets an expiration within product limits | The value will necessarily remain until the TTL ends |
| DELETE key | The component accepted the deletion request | Every local cache and concurrent request immediately stops seeing the old value |
| Conditional write or atomic command | One command executes atomically within its documented scope | Arbitrary multi-key or cross-shard operations are atomic |

A call timeout differs from an explicit miss. A timeout means that the outcome is unknown. The application must not interpret it as “the key does not exist,” especially to skip a permission check or repeat a non-idempotent operation.

## First Decide Whether It Is a Cache or Authoritative State

Redis is used not only as a cache but also for sessions, rate-limit counters, locks, and short-lived work state. Using the same product does not make the data contracts identical.

| Use | Meaning of loss | Design requirement |
|---|---|---|
| Product-detail cache | Can be rebuilt from the database | Allow misses and bound database fallback |
| Session | A user may be signed out | Define durability, failover, and safe degradation |
| Rate-limit counter | The system may under-limit or over-limit | Define fail-open or fail-closed behavior during failures |
| Business balance or inventory | Facts may become permanently wrong | Usually should not be stored solely as ordinary cache data |

Enabling persistence alone cannot determine whether the component can serve as an authoritative store. Also examine the meaning of an acknowledged write, possible data loss during replica failover, backup and recovery, concurrency constraints, and audit requirements. For authoritative-data boundaries, see [Authoritative Data and Derived Views](../../03-data-and-storage/05-source-of-truth-and-derived-view/).

## Key and Value Contract

A maintainable key usually contains a business namespace, tenant or principal, object ID, and, when needed, a schema version.

```text
profile:v2:tenant-42:user-9001
feed-head:v3:user-9001
```

Decide in advance:

- whether the key includes tenant_id to prevent tenants from overwriting one another;
- how case, null values, and special characters are normalized;
- the value's serialization format, version, and maximum size;
- whether “not found” may be negatively cached briefly and how short that TTL should be;
- whether a new schema deployment reads old values compatibly or switches the key version;
- whether a business object is stored as a complete object, a field projection, or only a list of IDs.

Do not depend on scanning every key for online business queries. A cache is generally suited to point lookups of known keys; design complex access patterns in [Data and Storage](../../03-data-and-storage/) first.

## TTL, Eviction, and Memory Limits

TTL specifies when a value should no longer be returned normally. Eviction means the component removes values early under memory pressure. They are not the same.

- A TTL that is too long may improve hit rate but lengthens the staleness window and deletion propagation.
- A TTL that is too short refreshes data sooner but increases misses, database reads, and writes.
- Many keys expiring together can create a concentrated database-fallback spike.
- At the memory limit, the product may evict values, reject writes, or behave differently according to configuration.
- “No expiration” does not mean “never lost”; eviction, restarts, and failover still apply.

Define TTL from acceptable business staleness, then tune it using hit rate and database-fallback capacity instead of treating TTL as a purely performance setting. Combining TTL jitter—adding a small random amount to expiration—with request coalescing and Cache-Aside belongs in [Cache Read Flows](../../05-general-design-patterns/01-cache-read-path/).

## Limits Exposed by Clusters and Replicas

A cache cluster typically distributes keys among nodes and uses replicas for availability. The application need not understand hash-slot migration or replication protocols, but it must know these external behaviors:

- which logical partition owns a single-key operation;
- whether multi-key operations, transactions, or scripts require co-located keys;
- whether scaling and failover can produce timeouts, reconnections, or brief misses;
- whether replica reads can return stale values;
- whether a write acknowledged by the primary but not yet replicated can be lost after failover;
- whether clients cache topology and how they refresh stale routes;
- whether one hot key still concentrates load on one node.

“The cluster scales horizontally” means total capacity or throughput can grow; it does not remove limits on a single key's capacity and QPS. For hot-spot principles, see [Partitioning, Sharding, and Hot-Spot Management](../../02-core-concepts/08-partition-sharding-and-hotspot/).

## Capacity and Cost Considerations

Selection must estimate more than the raw bytes of cached data:

- peak GET/SET QPS and the read/write ratio;
- active working set and the distributions of key and value sizes;
- memory overhead from serialization, keys, data structures, and product metadata;
- network throughput, cross-availability-zone traffic, and request charges;
- client connection count, connection pools, and TLS cost;
- per-key QPS for the top-K keys;
- remaining safe capacity after one node or availability zone fails;
- cache pre-warming speed after total loss or a deployment.

Hit rate must be evaluated with source load. Even with a 99% hit rate, the 1% of misses can still create a cache stampede and overwhelm the downstream system if they concentrate on expensive queries or one hot key.

## What Callers Observe During Failures

| Failure | External behavior | What the application must decide in advance |
|---|---|---|
| Node or network unavailable | Timeout, connection failure, or some keys unavailable | Fail fast, use database fallback, or return a degraded value |
| Failover | Reconnection, brief errors, recent-write loss, or stale reads | Acceptable data window and retry boundary |
| Heavy eviction or expiration | Hit rate drops sharply and database QPS rises | Database-fallback concurrency limit and overload protection |
| Hot key | Single-node latency and bandwidth rise | Request coalescing, local cache, or hot-key replication |
| Memory exhausted | Writes fail or eviction surges | Alert threshold, scale-out, and degradation of noncritical data |
| Stale client topology | Redirects, errors, or repeated retries | Client version, topology refresh, and retry budget |

A cache failure must not trigger unbounded retries. Otherwise, a small number of failures amplifies both cache connections and database-fallback traffic.

## Common Product Forms

| Form | Typical products | Differences to examine |
|---|---|---|
| Simple distributed key-value cache | Memcached | Simple GET/SET, multithreaded throughput, and fewer advanced data capabilities |
| In-memory data-structure service | Redis / Valkey | Conditional commands, data structures, TTL, persistence, and cluster modes |
| Cloud-managed cache | ElastiCache, Azure Managed Redis, Memorystore, and others | SLA, availability zones, upgrades, backups, quotas, networking, and cost |

Specific guarantees depend on the product, version, and deployment mode. In an interview, “use managed Redis” should be followed by the exact contract relied upon, for example: “Here it is only a disposable cache; a timeout permits only bounded database fallback; 60 seconds of staleness is acceptable; and the design does not depend on cross-key atomicity.”

## Minimum Observability Metrics

- hit rate, broken down by business and tenant, with separate hit and miss latency;
- GET/SET QPS, error rate, timeout rate, and P95/P99;
- used memory, fragmentation, or the product's effective capacity threshold;
- evictions, expired keys, and rejected writes;
- connection count, network bandwidth, and server CPU;
- top-K hot keys;
- failover count and client reconnections;
- downstream QPS and latency caused by misses.

## Remaining Application Responsibilities

- Select which data can be cached and declare the allowed staleness window.
- Design keys, value schemas, TTLs, and invalidation triggers.
- Distinguish misses, timeouts, and explicit errors.
- Limit source-fetch concurrency so a cache failure cannot overwhelm the source of truth.
- Prevent cross-tenant key collisions and sensitive-data leaks.
- Design safe paths for deletion, permission revocation, and schema upgrades.
- Verify that cache loss can be recovered from the source of truth.

## Interview Checklist

- [ ] Explained why a shared cache is needed instead of only a database or local cache.
- [ ] Stated whether cached values may be lost and where authoritative data resides.
- [ ] Defined the key, value, TTL, and maximum object size.
- [ ] Distinguished expiration, eviction, miss, timeout, and failure.
- [ ] Estimated the working set, peak QPS, hot keys, and post-failure capacity.
- [ ] Explained cluster-mode limits on multiple keys, stale reads, and failover.
- [ ] Set an explicit limit and degradation policy for database fallback after total cache loss.

## Not Covered in Depth Here

- complete flows for Cache-Aside, Read-Through, double deletion, and request coalescing;
- underlying algorithms for cache staleness, sharding, replication, and hot keys;
- exhaustive Redis data-structure commands, persistence files, and cluster protocols;
- designing Redis itself as a distributed system.
