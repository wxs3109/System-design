# Common basic system

This part treats common basic components as complete system design issues. They usually do not have a single product interface, are mainly called by other services, and are reused by multiple specific applications.

## Case Map

| Case | Externally provided capabilities | Main in-depth points | Common users |
|---|---|---|---|
| [Load Balancer](01-load-balancer/) | Distribute requests to healthy instances | L4/L7, Health Check, Algorithm, Session and Failover | All online services |
| [API Gateway](02-api-gateway/) | Provides a unified policy entrance for business APIs | Routing, authentication, Rate Limiting, Control Plane, timeout and Canary Release | Almost all external business APIs |
| [Distributed Cache](03-distributed-cache/) | Provides low-latency temporary data access | Sharding, replication, eviction, consistency and hotspots | Feed, search, items, sessions |
| [Rate Limiter](04-rate-limiter/) | Limit request rate by rules | Algorithm, distributed counting, rule publishing and failure strategy | API Gateway, login, payment |
| [Object Storage](05-object-storage/) | Persistently save and read large-scale objects | Metadata, object data, replication, erasure coding and life cycle | Video, network disk, backup |
| [Job Scheduler](06-job-scheduler/) | Execute tasks under specified time and constraints | Lease, Retry, DAG, fairness and scheduling accuracy | Transcoding, billing, cleanup, workflow |
| [Notification System](07-notification-system/) | Reliable delivery of notifications through multiple channels | Preferences, priorities, vendors, retries and unsubscribes | Social, transactional, security alerts |
| [Search Autocomplete](08-search-autocomplete/) | Return low-latency Top-K suggestions based on prefix | Trie, offline build, incremental update and personalization | Search, e-commerce, map |
| [Web Crawler](09-web-crawler/) | Discover, schedule and crawl web content | URL Frontier, courtesy strategy, deduplication and incremental crawling | Search, archiving, data platform |
| [Metrics Monitoring](10-metrics-monitoring/) | Collect, query indicators and trigger alarms | Time series storage, High Cardinality, Downsampling (downsampling) and alarm calculation | All production systems |
| [Message Queue / Event Stream](11-message-queue-event-stream/) | Reliable delivery of tasks, broadcasting events to subscribers, or retaining replayable partition logs | Contract boundaries of Work Queue, Pub/Sub, Partitioned Log; Ack, subscription progress, Ordering, Replay and Backpressure | Asynchronous tasks, notifications, Feeds, payments, searches, flow analysis |

## Learning requirements

Each case should not only talk about algorithms or individual nodes, but also cover:

- External API or protocol;
- Control Plane and Data Plane;
- Where the status exists;
- How to expand, shard and handle hotspots;
- Whether data is lost, executed repeatedly, or temporarily unavailable when a node fails;
- Which specific applications will reuse it.

The common base system is the contract boundary that other cases rely on, not just algorithmic problems. Each article should also clarify:

- Semantics that clients can rely on: Ordering, Durability, Consistency, Delivery, Freshness, TTL or Fairness;
- How to publish, version, and rollback the control plane configuration, and what data plane behavior is maintained when the control plane fails;
- Whether the client may see duplicate, out-of-order, old values ​​or Unknown Outcome after timeout, retry or disconnection and reconnection;
- Per-tenant / Per-key / Per-partition isolation, quotas, hotspots and backpressure;
- Which states are authoritative facts and which can be reconstructed from Log, Replica or Snapshot;
- The client must still bear its own responsibilities after accessing it, such as Idempotency, Reconciliation, permission judgment or service degradation.

When writing a specific application, you can link to the principles in this directory, but you must still explain the specific semantics, failure impact, and recovery responsibilities that the application relies on; just writing "use Cache / Queue / Scheduler" does not complete the reuse design.
