# Stateless and Stateful Service

**Stateless** does not mean that the service has no data, but asks a specific question: Can any Healthy Instance complete its work by relying only on this Request and shared dependencies? The answer determines the difficulty of Scaling, Load Balancing, Deployment, Failover, and Recovery.

Answers in this chapter:

- Which states must be saved by the service itself as Source of Truth, and which ones can be externalized, copied, or simply discarded;
- When should stateless instances be used first, and when statefulness is a requirement of the business itself;
-Why Session, long connection, Local Cache and background tasks are in hidden state;
- What problems do Sticky Routing, Lease, Partition, Connection Draining and Failure Recovery solve respectively?
- How to apply these judgments to API Gateway, Chat, Job Scheduler and multi-tenant data platform.

## Chapter Navigation

1. [Identify the State and its Owner first](01-first-identify-the-state-and-its-owner.md)
2. [Stateless Scaling and Session external](02-stateless-scaling-and-session-external.md)
3. [Long connection, Sticky Routing and Connection Draining](03-long-connection-sticky-routing-and-connection-draining.md)
4. [Stateful Service: Partition, Replica, Lease and Recovery](04-scaling-and-recovery-of-stateful-service.md)
5. [Case Deduction and Design Checklist](05-case-study-and-design-checklist.md)

## One minute judgment method

Questions one by one:

1. This Instance disappears immediately. What information will be permanently lost?
2. Can a new Instance be processed solely by requests, authoritative storage, or logs?
3. Does the request have to go back to a specific Instance? If so, what to do after Sticky Routing fails?
4. Is this state a business fact, a temporary coordination state, or a rebuildable cache?
5. Is the scope of the state a request, a user, a connection, a Partition, or the entire cluster?
6. How is the status migrated or reconstructed during capacity expansion, reduction, rolling release, and cross-region failure?

If the answer to question 3 is just "Maintain Sticky Session through Load Balancer", then the design is incomplete. Sticky Routing can reduce state relocation, but it cannot be used as the only recovery mechanism - it just keeps the state in place without making the state recoverable.

## Core trade-offs

| Choice | Main Benefits | Main Costs | Common Scenarios |
|---|---|---|---|
| Stateless Instance | Arbitrary routing, fast horizontal expansion, simple release | One more shared storage/Cache access, external dependencies become more critical | REST API, Gateway, query service |
| The connection is stateful and the business status is external | The connection locality is good and the business facts are recoverable | Reconnection, Presence obsolescence, and Connection Draining all become complicated | Chat Gateway, WebSocket |
| Partitioned Stateful | Good data locality, order within a single Partition | Shard routing, hotspots, migration and Failover are complex | Database, Scheduler, Stream Processor |
| Single-machine memory status | The lowest latency and the simplest implementation | The instance is gone as soon as it hangs up, making expansion difficult | Disposable Cache, development environment, and recalculated intermediate values ​​|

## A principle

"Prioritize making calculations replaceable" is not the same as "stuffing all data into a remote database". The state should be placed in the component that is responsible for its correctness, can be copied or reconstructed, and has clear fault semantics; those states that really require locality should be managed by Partition, and a recovery protocol should be designed for "reassigning the owner".
