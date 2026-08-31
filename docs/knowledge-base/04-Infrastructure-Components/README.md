# Infrastructure Components

This chapter treats each infrastructure component as a black box and answers: **Where does it sit in the system? What external contract does it provide? What are its key configurations and limits? What does the caller observe when it fails? What responsibilities remain with the application?**

It neither implements these components nor prematurely combines multiple components into a complete architecture.

## Where This Chapter Fits in the Notes

| Chapter | Questions it addresses | Relationship to this chapter |
|---|---|---|
| 02-Core Concepts | Consistency, idempotency, retry, ordering, leases, and disaster-recovery principles | Provides the concepts needed to evaluate product guarantees |
| 03-Data and Storage | Data models, indexes, authoritative data, and storage selection | Determines what data a component handles |
| 04-Infrastructure Components | External contracts and failure behavior of individual off-the-shelf components | The responsibility of this chapter |
| 05-General Design Patterns | How multiple components form reusable flows | Uses the component capabilities described in this chapter |
| 06-Case Studies | How complete systems select and combine components | Validates concrete architectures |

For example, why at-least-once delivery causes duplicates belongs in chapter 02; the contract provided by a queue or Kafka belongs in chapter 04; how a database, outbox, broker, and consumer collaborate belongs in chapter 05; and how a news feed uses that flow belongs in chapter 06.

## Common Scope of This Chapter

### External Contract Every Article Must Explain

- the immediate problem the component solves and its position in the system;
- the exact meaning of its inputs, outputs, and success;
- the scope of its guarantees and the configuration conditions for those guarantees;
- request sizes, throughput, connections, retention periods, and quotas;
- externally visible behavior when it slows down, is overloaded or unavailable, or serves stale data;
- common product forms and the differences between managed and self-hosted deployments;
- what the product solves and what the application must still handle;
- when the component should not yet be introduced.

### Topics Not Covered in Depth Here

- DNS messages, load-balancing algorithms, and internal cache data structures;
- Kafka controllers, log segments, and replication protocols;
- Raft, Paxos, distributed-lock, and lease algorithms;
- complete multi-component flows such as Cache-Aside, Outbox, and Saga;
- selection among databases, search engines, object stores, and analytical stores;
- the internal system design of components such as API gateways, load balancers, and caches.

The last category belongs in the [general infrastructure system case studies](../06-case-design/01-common-basic-system/).

## Contents and Learning Order

| Order | Topic | Question it addresses |
|---|---|---|
| 00 | [Component Selection](00-component-selection/) | How to determine from the immediate problem whether a component is worth introducing |
| 01 | [DNS and Global Traffic Entry](01-dns-and-global-traffic-entry/) | How domain names are resolved and how global traffic selects an entry point |
| 02 | [Load Balancers and Reverse Proxies](02-load-balancers-and-reverse-proxies/) | How requests within a region are distributed among healthy instances |
| 03 | [API Gateway](03-api-gateway/) | How common API access policies are enforced centrally |
| 04 | [Distributed Cache](04-distributed-cache/) | How hot data is read repeatedly with lower latency |
| 05 | [CDN and Edge Delivery](05-cdn-and-edge-delivery/) | How static content and large objects are delivered near users worldwide |
| 06 | [Task Queues and Pub/Sub](06-task-queues-and-pub-sub/) | How work queues and event broadcast decouple producers from consumers |
| 07 | [Event Streaming Platforms](07-event-streaming-platforms/) | How events are retained, consumed, and replayed by partition |
| 08 | [Workflow and Long-Running Task Platforms](08-workflow-and-long-running-task-platforms/) | How execution state survives across steps, timers, and process restarts |
| 09 | [Service Discovery, Configuration, and Coordination](09-service-discovery-configuration-and-coordination/) | How endpoints, dynamic configuration, and small amounts of control state are managed |
| 10 | [Service-to-Service Communication Infrastructure](10-service-to-service-communication-infrastructure/) | How HTTP/gRPC, connection pools, proxies, and meshes are used |

Read 00 first, then select components according to the needs of the current case study; there is no need to read mechanically from 01 through 10.

## Three Groups of Easily Confused Components

| Requirement | Closest component | Different problem |
|---|---|---|
| Deliver a task to exactly one worker | Task queue | Not a long-term event history |
| Let multiple independent consumers read and replay events | Event streaming platform | Not a regular work queue |
| Support multiple steps, long waits, timers, and status queries | Workflow platform | Not a single message delivery |
| Distribute network connections or HTTP requests within a region | Load balancer | Does not provide complete API governance |
| Enforce authentication, quotas, routing, and protocol policies at the entry point | API gateway | Should not host domain business logic |
| Cache and deliver static content worldwide | CDN | Does not replace authorization for business objects |

These are only starting points for producing candidates. The contract of the specific product, SKU, region, and configuration must ultimately be verified.

## Required Output for Every Component

After analyzing a component, record:

1. the current immediate problem and the conditions under which the component should not yet be introduced;
2. the component's position in the request, data, or control path;
3. its inputs, outputs, success semantics, and scope of guarantees;
4. key configurations, capacity, quotas, and cost;
5. its behavior during unavailability, overload, staleness, and recovery;
6. the boundaries among product capabilities, configured guarantees, and application responsibilities;
7. links to the concepts in chapter 02, patterns in chapter 05, and case studies in chapter 06.

## Storage Products Not Repeated in This Chapter

The core value of products such as PostgreSQL, DynamoDB, Cassandra, Elasticsearch, S3, warehouses, and lakehouses is storing and querying data. They are compared together in [Data and Storage](../03-data-and-storage/).

## Questions You Should Be Able to Answer

- Why is this component needed instead of calling the downstream system directly?
- Which guarantee does the design depend on, and what is its scope?
- Which configurations change ordering, latency, durability, or data safety?
- What does the caller observe when the component is down, slow, stale, or backlogged?
- Does the current load truly require it?
- What does the product solve, and what must the application still supply?

If an answer starts implementing the component's internal algorithms or orchestrating a complete flow across multiple components, stop and move to the chapter responsible for that topic.

## Terminology Conventions

Infrastructure product documentation commonly uses English names for behaviors and configurations. This chapter preserves terms such as `Retry`, `Replay`, `Lease`, `Circuit Breaker`, `Jitter`, `DLQ`, and `Backpressure`. The first use explains the problem each term addresses instead of inventing awkward translated abbreviations.
