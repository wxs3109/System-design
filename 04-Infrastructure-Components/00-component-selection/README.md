# Component Selection

Introducing a gateway, cache, broker, or workflow platform adds a runtime dependency, a set of quotas, and a new failure mode to the system. Selection should follow one guiding sequence: **first state the immediate problem, then verify the component's external contract, and finally identify the responsibilities that remain with the application.**

## 1. First Determine Which Chapter Owns the Question

| Question | Where it should be answered |
|---|---|
| Why retries cause duplicates and how idempotency is defined | [02-Core Concepts](../../02-core-concepts/) |
| How posts, blobs, and search documents should be stored | [03-Data and Storage](../../03-data-and-storage/) |
| What black-box capabilities Kafka, Redis, and CDNs provide | 04-Infrastructure Components |
| How a database, outbox, broker, and consumer collaborate | [05-General Design Patterns](../../05-general-design-patterns/) |
| How a news feed combines an entire architecture | [06-Case Studies](../../06-case-design/) |

A topic belongs in this chapter only if it can be independently deployed, purchased, or invoked and the application depends on its external contract.

## 2. Start with the Immediate Problem

Begin by describing the current bottleneck or requirement in one sentence:

- multiple service instances need to share incoming traffic;
- popular objects repeatedly trigger database reads, driving database QPS too high;
- user requests should not wait synchronously for time-consuming tasks;
- users around the world are too far from the origin when downloading large files;
- long-running tasks need to preserve timers and execution state across processes.

Then describe the simplest solution without the component and explain its shortcomings. A new component has verifiable value only when those shortcomings are explicit.

Do not start with “we should use Kafka.” That does not say whether the need is a work queue, event broadcast, historical replay, or merely changing a synchronous call to an asynchronous one.

## 3. Component Contract Card

Complete the same contract card for every candidate component:

| Item | Required question |
|---|---|
| Position | Is it in the request path, data path, or control path? |
| Input | Through what key do requests, messages, objects, or configurations enter? |
| Output | Does the caller receive a response, acknowledgment, offset, or status? |
| Success semantics | What exactly does a successful response prove? |
| Guarantee scope | Does the guarantee apply to one request, key, partition, or workflow? |
| Freshness | How stale may the data, route, or configuration be? |
| Limits | What are the request-size, throughput, connection, retention, and quota limits? |
| Overload behavior | Does it queue, throttle, reject, drop, or increase latency? |
| Failure behavior | Does it time out, duplicate, become briefly invisible, fall back, or become entirely unavailable? |
| Recovery behavior | Does recovery require replay, rebuilding, or manual reconciliation? |
| Application responsibility | Who handles idempotency, authorization, degradation, and business invariants? |

For example, “the broker accepted the message successfully” may mean only that the message entered some durability scope; it does not automatically mean that a consumer processed it successfully. Interpret the result according to the specific product, configuration, and API contract.

## 4. Distinguish Three Layers of Guarantees

### Product Capability

What the product documentation says it supports, such as topics, TTL, dead-letter queues, purging, leases, or conditional updates.

### Configured Guarantee

For the same product, durability, ordering, expiration, and failover behavior may depend on configuration such as region, SKU, acknowledgment mode, batching, and cache rules. A product name alone is not enough.

### Application End-to-End Outcome

At-least-once delivery from a messaging system does not automatically make a charge idempotent. A gateway may validate a token without determining whether the user owns a particular item. Selection documents must record these three layers separately and must not exaggerate a product capability into a business outcome.

## 5. What to Compare Among Candidates

| Dimension | What to verify |
|---|---|
| Functional fit | Whether the core access model and guarantees are supported natively |
| Scale limits | Peak throughput, concurrency, connections, object size, and retained volume |
| Latency | Tail latency during normal operation, overload, cross-zone access, and failover |
| Isolation | Boundaries such as tenant, namespace, topic, and cluster |
| Security | Identity, networking, encryption, auditing, and key integration |
| Operability | Scaling, upgrades, backups, monitoring, and troubleshooting |
| Geography | Available regions, data residency, and cross-region capabilities |
| Cost | Requests, capacity, networking, retention, and operational labor |
| Team fit | Existing experience, SDKs, automation, and on-call capability |
| Exit cost | Whether data and configuration can be exported and whether application coupling is controlled |

Do not invent universal performance figures divorced from workload and configuration. Filter candidates using published limits, then validate them with representative traffic.

## 6. Managed Service or Self-Hosted

Managed services usually reduce the burden of installation, upgrades, backups, and basic monitoring, and they integrate more easily with cloud identity and networking. The tradeoff is that quotas, versions, plug-ins, and low-level configuration are constrained by the vendor, and migration costs arise.

For self-hosting, account for more than node cost: capacity planning, upgrades, certificates, data repair, monitoring, on-call work, and failure exercises also matter. Self-hosting is more reasonable only when the system truly requires control or a deployment boundary that managed products cannot provide and the team can accept long-term operational responsibility.

## 7. Calculate Only the Capacity Numbers That Affect Selection

At minimum, estimate:

- peak request or message rate;
- size of each request, message, or object;
- number of concurrent and long-lived connections;
- total capacity over the retention period;
- read/write volume, database fallback or origin-fetch traffic, and cross-zone network volume;
- number of tenants, topics, keys, or workflows;
- normal consumption speed and catch-up speed after a failure.

For estimation methods, see [01-Back-of-the-Envelope](../../01-Back-of-the-Envelope/). This chapter only maps orders of magnitude to product limits and cost models.

Passing at average throughput does not prove availability. Also validate peaks, bursts, hot keys, large messages, slow consumers, and behavior during dependency failures.

## 8. Design for Failure Before Approving the Dependency

For every candidate, walk through at least these cases:

1. the component is completely unavailable;
2. it remains available but latency rises;
3. returned data or configuration is stale;
4. capacity or quotas are exhausted;
5. one tenant, key, topic, or consumer becomes hot;
6. accumulated work replays in a burst after recovery.

Record whether the caller observes a timeout, rejection, stale value, duplicate, missing value, origin fetch, or fallback. For the principles behind deadlines, backpressure, isolation, and recovery, see [Core Concepts](../../02-core-concepts/).

## 9. State When Not to Introduce the Component

Keeping the simple solution is often better when:

- the current database indexes already meet query and capacity needs;
- synchronous-call latency and availability meet their targets;
- a single-region entry point has no global-routing requirement;
- a database state table and simple workers can already handle the small task volume;
- the team cannot yet monitor and recover the new component;
- the new component creates a larger failure surface than the bottleneck it removes.

Also state the upgrade signal, such as the database-fallback QPS, backlog duration, or global latency at which the component should be introduced.

## 10. Two Short Examples

### Does the Home-Page Detail View Need a Cache?

The immediate problem is that popular posts drive peak database QPS close to safe capacity. A candidate cache must support point lookups by post ID, the target TTL, capacity eviction, and acceptable database fallback. The application remains responsible for deletion and permission checks; the complete Cache-Aside flow belongs in [General Design Patterns](../../05-general-design-patterns/).

If the database still has enough headroom, optimize queries and indexes first. Do not add Redis merely to conform to a “standard architecture.”

### What Should Transcoding Tasks Use?

If each task only needs to be claimed and run by one worker, a work queue is a closer fit. If the system requires multiple independent consumers, long-term retention, and replay by offset, evaluate an event streaming platform. Execution lasting hours and containing timers and multi-step state may require a workflow platform.

All three product forms can appear together, but they are not synonyms.

## 11. Minimal ADR (Architecture Decision Record)

At minimum, every component-selection decision should record:

1. the current immediate problem and quantified upgrade signal;
2. the simplest solution without the component;
3. a contract card for each candidate component;
4. the specific guarantees relied upon and their configuration conditions;
5. capacity, quotas, and primary costs;
6. externally visible behavior during unavailability, overload, staleness, and recovery;
7. the correctness and degradation logic that remain the application's responsibility;
8. the reasons candidates were selected, rejected, or deferred.

The learning goal is not to memorize the most product names, but to judge whether a component genuinely improves the current system.

[Back to this chapter's contents](../README.md)
