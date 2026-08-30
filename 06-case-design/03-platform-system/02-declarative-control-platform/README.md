# Design a declarative resource control platform

## Case positioning

This case designs a Kubernetes-like declarative resource control platform. The user submits the Desired State, and the platform allows the Observed State to converge through continuous Reconciliation, instead of directly equating an API request with the success of the underlying operation.

The training focuses on resource contracts, control loops, concurrent updates, placement and expansion mechanisms; it is not a copy of all Kubernetes APIs, nor is it a redesign of the container runtime.

## Case portrait

| Dimensions | Focus |
|---|---|
| Primary Archetype | Declarative Desired-state Reconciliation |
| Core invariants | Resource identity is stable; Spec updates are not overwritten by old Controllers; the same resource will eventually only take effect in a state that conforms to the current Version/Generation; deletion will eventually converge |
| Design Drivers | Control-plane Correctness、Convergence、Availability、Extensibility、Tenant Isolation |
| Traffic / Data Shape | Metadata-heavy, Watch Fan-out, a large number of small resources, burst batch updates, long-running control loops |
| Failure strategy | API acceptance only indicates that the desired state has been persisted; brief deviation is allowed after Controller / Node failure, and convergence is achieved through retries and Fencing |
| Security Boundary | Tenant / Namespace, RBAC, Admission, Secret, Node Identity, Extended Controller Permissions |

## Core resources and status contract

Future expansion tense defines at least:

- `Resource`: immutable identity, `metadata`, `spec`, `status`, `generation`, `resourceVersion`.
- `Spec`: Desired State declared by the user or upper controller; who has the right to modify which fields?
- `Status`: The Observed State, Condition, Reason and the last processed Generation observed and written back by the Controller.
- `Operation / Event`: Used for auditing and debugging, not as a substitute authoritative fact for the Resource Store.
- `Node / Capacity / Placement`: Scheduling resources, constraints, leases, health and allocation results.

It must be explained which one is the authoritative fact when Spec, Status and actual running status are not synchronized, and how users can judge "accepted", "converging", "ready" and "unrecoverable".

## Required control link

1. **API and Resource Store**: Idempotence, CAS, paging, versioning and consistency semantics of Create / Get / List / Watch / Patch / Delete.
2. **Watch**: How to connect from Snapshot to incremental events; how to recover from disconnection, event compression, slow watcher and relist.
3. **Controller / Reconciliation**: Work Queue, idempotent Reconcile, backoff, deduplication, Level-based Trigger and final convergence conditions.
4. **Admission**: The order, timeout and Fail-open/Fail-closed of Authentication, Authorization, Defaulting, Validation, Policy and Mutation.
5. **Scheduling/Placement**: Submission points for resource requests, constraints, Affinity, Taint, priority, Preemption, fairness and binding.
6. **Execution / Node Control**: How to deliver the expected status; Node heartbeat, Lease, old Agent Fencing and actual status reporting.
7. **Deletion**: Deletion Timestamp, Finalizer, cascade deletion, Garbage Collection, and how to unblock the Controller when it is permanently disconnected.
8. **Extensibility**: API Version, Schema Evolution, Conversion, CRD/new resource type, Custom Controller, Webhook and permission minimization.

## Faults and acceptance that must be covered

- API Server times out before and after writing, client retries do not create duplicate identities or overwrite new versions.
- When the Controller crashes, duplicates processing, or holds an old cache, the results of the old Spec will not be overwritten by the new Generation.
- Controller can re-establish a complete view after Watch flow is interrupted, events are compressed or out of order.
- When a failure occurs between Scheduler binding and Node execution, no two instances will have exclusive resources at the same time.
- There is a clear strategy and explosion radius when Admission Extension times out, returns conflicting Mutation, or has incompatible versions.
- When the Controller corresponding to the Finalizer is permanently unavailable, the platform will neither silently leak resources nor forcefully delete them without auditing.
- There are Quota, Priority, Backpressure and recovery strategies when the Resource Store, control plane Cell or a Tenant is overloaded.

## Extension and version requirements

- New resource types can be accessed through Schema, API Discovery, Controller and permission contracts without requiring modification of all core components.
- The API must define N/N-1 Compatibility, Default Values, Field Ownership, Unknown Fields, Obsolescence, and Conversion.
- Account for version drift, canary, drain, rollback and legacy object behavior when upgrading Controller, Admission and Agent independently.
- Limit the number of objects, Watch bandwidth, Reconcile rate, Placement resources and Extension CPU/Memory under multi-tenancy.

## Observability and security

At a minimum, monitor API Latency / Error, Resource Store Capacity, Watch Lag, Queue Depth, Reconcile Error / Duration, Desired-vs-Observed Drift, Unschedulable Age, Node Lease, Admission Latency and Finalizer Age. The audit must be able to answer who modified the Spec when and in which version, who approved or rejected it, and which Controller wrote the Status.

## Differences from adjacent platform cases

- The core of [Multi-tenant Data Platform](../01-multi-tenant-data-platform/) is Tenant / Workspace / Item / Capacity and data Workload; the core of this case is the universal Resource API and continuous convergence.
- [Serverless / Developer Platform](../03-serverless-developer-platform/) can be built on this platform, but the commitment to developers is Build / Deploy / Runtime and version traffic, and does not require the exposure of common resource control contracts.

## Review Question

- What exactly can users trust when an API returns success?
- Why should Reconciliation try to work according to the current Level instead of just relying on each edge event to be delivered exactly?
- How to re-establish an authoritative view when Spec, Status and underlying facts are each distorted?
- How much authority does the new resource type have? How is the explosion radius of a bug Controller limited?
- What external state will be leaked by forcibly deleting resources with Finalizer, and how to audit and fix it?
