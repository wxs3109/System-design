# Service Discovery, Configuration, and Coordination

Service instances come and go, runtime configuration changes, and small amounts of control state require coordination among processes. Service registries, configuration stores, and coordination stores provide external contracts for these problems, but they are neither business databases nor task queues.

This article discusses application-visible capabilities such as registration, reads, watches, compare-and-set, and leases. For the correctness principles behind consensus, distributed locks, and leases, see [Core Concepts](../../02-core-concepts/). A lease is temporary ownership with an expiration that must be renewed.

## 1. Three Immediate Problems

| Capability | Question it answers | Typical data |
|---|---|---|
| Service discovery | Which addresses are currently available for a logical service? | Service-to-endpoint lists |
| Dynamic configuration | Which configuration version should be used now? | Flags, thresholds, and routing rules |
| Coordination | Who temporarily has control, and is the version still valid? | Lease, leader, epoch, and CAS values |

One product may provide all three, but the application must distinguish their semantics. Putting service addresses, orders, and large files into one coordination store makes capacity and failure responsibility unmanageable.

## 2. Black-Box Contract of Service Discovery

A typical process registers an instance endpoint, lets callers or proxies query healthy endpoints, and removes an endpoint after the instance exits or its lease expires.

The design must verify:

- whether the instance, deployment platform, or control plane performs registration;
- which address, port, protocol, region, and version fields an endpoint contains;
- whether health comes from process liveness, readiness, or an external probe;
- whether callers poll, watch, or use a local proxy that maintains the address table;
- how soon a new instance becomes visible and the latest time a failed instance is removed;
- whether the last address table can be used while the registry is unavailable.

“Registered” does not mean “able to process requests correctly.” Readiness should mean that the instance has everything needed to accept traffic.

## 3. Black-Box Contract of a Configuration Service

A configuration service commonly provides reads by key or namespace, versions, and watch or polling updates. The application must define:

- configuration schema, types, defaults, and ownership;
- which settings can update live and which require a restart;
- propagation time from publication to use by instances;
- whether multiple fields must switch atomically as one version;
- how invalid values are rejected before publication;
- how a failed new configuration rolls back to the previous version;
- whether to use the last known value or stop serving when the control plane is unavailable.

Dynamic configuration does not mean “the change takes effect everywhere simultaneously.” Old and new versions may coexist during propagation, and the business must decide whether that is allowed.

Passwords, keys, and certificates should use dedicated secret- or key-management capabilities. The ability of a regular configuration service to store strings does not make it a suitable secret store.

## 4. What a Coordination Store Provides

| Capability | Application use | Scope that must be verified |
|---|---|---|
| Compare-and-set | Update only if the version has not changed | Compared object, atomic scope, and failure result |
| Lease / session | Temporary ownership expires with the session | Expiration determination, renewal, and maximum staleness |
| Watch | Subscribe to changes for a key or prefix | Starting version, reconnection recovery, and history retention |
| Revision / version | Determine the version of observed data | Whether versioning is global, per key, or within a transaction |
| Ephemeral entry | Remove a temporary node after its session ends | Deletion timing and reconnection semantics |

These capabilities help with leader election, membership, and control-plane coordination, but the application must still handle unknown timeout outcomes, client pauses, and an old lease holder that continues running after expiration. Protecting external resources usually also requires a fencing token. See [Concurrency Control and Distributed Transactions](../../02-core-concepts/09-concurrency-control-and-distributed-transactions/) for the principles.

## 5. Suitable and Unsuitable Data

Suitable data includes:

- service endpoints and health metadata;
- small, infrequently changed runtime configuration;
- control state such as leader, epoch, and assignment;
- small lease and membership records.

Unsuitable data includes:

- large volumes of business entities or large objects;
- high-frequency telemetry, logs, and user events;
- unbounded task queues;
- large configuration and model files;
- all business data migrated merely because strong consistency is needed.

Coordination systems are usually optimized for small control state. Object size, total key count, write QPS, and watch fan-out should all be bounded.

## 6. A Watch Is Not an Infallible Callback

A client may disconnect, fall behind, or restart, and a server may compact old history. A watch requires answers to:

1. Which revision does the initial read return?
2. How are changes after that revision subscribed to?
3. Can the client resume from the last revision after disconnecting?
4. How does it perform a new full read after history is unavailable?
5. Are duplicate or coalesced notifications allowed?
6. Does it revalidate the current value after an event arrives?

A watch tells the application that “something may have changed”; it does not replace validation of business state.

## 7. Key Configuration and Capacity

| Dimension | What to examine |
|---|---|
| Namespace | Isolation among environments, regions, tenants, and services |
| Lease TTL | Endpoint-removal speed and false-expiration risk |
| Watch count | Long-lived connections, broadcast amplification, and slow clients |
| Object size | Control records should remain small and bounded |
| Write rate | Whether frequent heartbeats or configuration churn overwhelm the control plane |
| History retention | Catch-up window after a watch disconnects |
| Identity permissions | Who can read or write which prefixes and configurations |
| Backup and recovery | Revisions, leases, and client behavior after recovery |

Specific limits must be taken from the selected product and deployment mode; they cannot be inferred as universal numbers from the underlying consensus protocol.

## 8. What Callers Observe During Failures

### Registry or Configuration Service Unavailable

A data plane can often keep operating temporarily with the last known endpoints or configuration, but cannot promptly discover scaling changes or new configuration. Set a limit on stale state.

### Network Flapping or a Client Pause

A lease may expire while its former holder still believes it has ownership. External writes must validate the current epoch or fencing token, not merely a local Boolean.

### Watch Backlog

The client observes changes late, or must list all state again after old history is compacted. Monitoring should include revision lag, reconnections, and full-sync count.

### Incorrect Configuration Published

The system may degrade broadly and simultaneously. It needs schema validation, canaries, pinned versions, rapid rollback, and change auditing.

## 9. Product Forms as Navigation Only

| Product or platform | Common role | Verify first |
|---|---|---|
| etcd | Control-plane key-value store, watch, and lease | Object scale, revisions, and operational responsibility |
| ZooKeeper | Membership, leader election, and coordination | Sessions, ephemeral nodes, and watch semantics |
| Consul | Service discovery, health checks, and key-value data | Catalog, DNS/API, multiregion behavior, and ACLs |
| Kubernetes API | Services, endpoints, and configuration objects | Watches, objects, permissions, and control-plane boundaries |
| Cloud configuration service | Dynamic configuration and feature flags | Push, versions, canaries, quotas, and cost |

They are not interchangeable. Select from the required contract, existing platform, and team responsibilities.

## 10. Case Study: Scheduler Worker Ownership

Multiple scheduler instances need to decide which one owns a partition. A coordination store can hold the assignment, owner, lease, and epoch. A worker validates the epoch when receiving a task and rejects commands from a stale scheduler.

The coordination system does not prove that a job completed successfully and does not store the entire job payload. Task state, idempotency, and recovery belong to the application and to [Long-Running Task Submission and Execution in General Design Patterns](../../05-general-design-patterns/04-long-running-task-submission-and-execution/).

## 11. Remaining Application Responsibilities

- Define configuration schemas, defaults, and version-coexistence rules.
- Distinguish liveness, readiness, and business health.
- Design data-plane behavior for stale or unavailable control-plane data.
- Handle watch reconnection, full synchronization, and duplicate notifications.
- Use an epoch or fencing token for external side effects.
- Restrict write permissions and audit changes.
- Do not expand the coordination system into a database, queue, or file store.

## 12. Checklist

- [ ] Separated service discovery, dynamic configuration, and coordination use cases.
- [ ] Defined upper bounds for propagation of new values and removal of failed endpoints.
- [ ] Designed watch versioning, resumption after disconnection, and full resynchronization.
- [ ] Prevented an old holder from damaging external resources after its lease expires.
- [ ] Bounded key count, object size, write rate, and watch count.
- [ ] Defined data-plane behavior while the control plane is unavailable.
- [ ] Did not carelessly substitute ordinary configuration capabilities for secret storage.
- [ ] Did not expand into implementation of consensus, lock, or lease algorithms.

[Back to this chapter's contents](../README.md)
